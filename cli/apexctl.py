#!/usr/bin/env python3
"""apexctl — Linux CLI for the ANT ESPORTS APEX 200.

Speaks the same HID framing as the web app (see PROTOCOL.md). Uses hidraw so it
works without any Python HID dependency; falls back to the `hidapi` shared
library if present.

    ./apexctl.py list
    ./apexctl.py descriptor
    ./apexctl.py send 0x62
    ./apexctl.py raw --cmd 0x13 --data "ff,00,00,00,00,00,00,00" --p1 0 --p2 0
    ./apexctl.py monitor
"""

from __future__ import annotations

import argparse
import os
import re
import struct
import sys
import time

VID = 0x314B
PID = 0x1026

# Confirmed from the live report descriptor on /sys/class/hidraw/hidraw0:
#   UsagePage 0xFF02 (vendor), Usage 0x0002, INPUT 8bit x64, OUTPUT 8bit x64
# No ReportID items, so MAGIC is a payload byte and the implicit report ID is 0.
MAGIC = 0xFA
REPORT_SIZE = 64
TRANSFER_LEN = REPORT_SIZE
MAX_PAYLOAD = REPORT_SIZE - 6  # 6-byte header

OFF_MAGIC, OFF_CMD, OFF_PARAM1, OFF_PARAM2, OFF_RESERVED, OFF_LENGTH, OFF_DATA = 0, 1, 2, 3, 4, 5, 6
RESPONSE_FLAG = 0x80

OPCODES = {
    0x10: "set_custom_light", 0x11: "set_custom_light_all", 0x13: "set_effect_light",
    0x14: "set_effect_light_all", 0x16: "get_custom_light", 0x17: "get_effect_light",
    0x18: "get_effect_light_name", 0x19: "select_effect_light",
    0x20: "set_keyboard_config_a", 0x22: "add_high_key", 0x23: "set_high_key",
    0x24: "set_keyboard_config_b", 0x25: "del_high_key", 0x26: "set_trigger_config",
    0x27: "set_quick_trigger_config", 0x28: "set_trigger_config_all",
    0x2A: "get_keyboard_config", 0x2B: "get_high_key", 0x2C: "get_trigger_config",
    0x40: "set_macro_config", 0x41: "del_macro_config", 0x42: "get_macro_config",
    0x50: "set_whole_param", 0x52: "get_calibration_state", 0x53: "set_report_calibration",
    0x54: "save_calibration", 0x55: "switch_config_table", 0x56: "set_config_info",
    0x57: "get_config_info", 0x58: "add_config_table", 0x59: "del_config_table",
    0x5B: "get_calibration_adc", 0x5E: "get_whole_param",
    0x60: "download_firmware_keyboard", 0x61: "reset_keyboard", 0x62: "get_product_info",
    0x63: "firmware_keyboard_end", 0x65: "download_firmware_data",
    0x66: "download_firmware_data_end",
}

# Read/write classification, taken from the Windows app's own method names after
# locating all 39 frame builders (PROTOCOL.md section 3). 13 read, 26 write.
# `send` refuses a WRITE opcode unless --write is given.
READ_OPCODES = frozenset({
    0x16, 0x17, 0x18, 0x2A, 0x2B, 0x2C, 0x42, 0x52, 0x57, 0x5B, 0x5E, 0x62, 0x63,
})

# Factory-reset and firmware commands. These are reachable from the CLI on
# purpose, because a human may need them, but they are never issued implicitly.
FORBIDDEN_OPCODES = frozenset({0x60, 0x61, 0x65, 0x66})

# 0x13 set effect light payload layout, solved in PROTOCOL.md section 6.
#   [0] effect index 0..11   [1] brightness 0..100 (raw percentage)
#   [2] speed 1..100         [3..7] device-owned, pass through
EFFECT_MIN, EFFECT_MAX = 0, 11
BRIGHTNESS_MIN, BRIGHTNESS_MAX = 0, 100
SPEED_MIN, SPEED_MAX = 1, 100


def opcode_class(op: int) -> str:
    """'read', 'write', or 'unknown'. Unknown opcodes are refused by `send`."""
    if op in READ_OPCODES:
        return "read"
    if op in OPCODES:
        return "write"
    return "unknown"

RESPONSES = {
    0x90: "set_custom_light", 0x91: "set_custom_light_all", 0x93: "set_effect_light",
    0x94: "set_effect_light_all", 0x96: "get_custom_light_all", 0x97: "get_effect_light",
    0x98: "get_effect_light_name", 0x99: "select_effect_light", 0xA0: "set_key",
    0xA1: "set_key_function", 0xA2: "set_high_key", 0xA3: "set_high_key_more",
    0xA4: "set_key_default", 0xA5: "del_high_key", 0xA6: "set_trigger",
    0xA7: "set_quick_trigger", 0xA8: "set_trigger_all", 0xAA: "get_key_config",
    0xAB: "get_high_key_config", 0xAC: "get_trigger_config", 0xC0: "set_macro",
    0xC1: "del_macro", 0xC2: "get_macro_all", 0xD0: "set_whole_config",
    0xD1: "start_calibration", 0xD2: "start_calibration_config",
    0xD3: "open_calibration_time", 0xD4: "save_calibration",
    0xD5: "set_current_config_table", 0xD6: "set_config_table_info",
    0xD7: "get_config_table", 0xD8: "add_config_table", 0xD9: "del_configure_table",
    0xDB: "get_calibration_adc", 0xDE: "get_whole_config", 0xE0: "fireware_download",
    0xE1: "reset", 0xE2: "get_product_info", 0xE3: "fireware_download_end",
    0xF1: "config_change",
}

# /sys/class/hidraw/hidrawN/device/uevent contains:
#   HID_ID=0003:0000314B:00001026      -> bus : vendor : product
#   HID_PHYS=usb-0000:00:14.0-1/inputN -> gives the interface index
HID_ID_RE = re.compile(r"HID_ID=([0-9A-Fa-f]+):([0-9A-Fa-f]+):([0-9A-Fa-f]+)")
HID_PHYS_RE = re.compile(r"HID_PHYS=(\S+)")
IFACE_RE = re.compile(r"input(\d+)")


def opcode_name(op: int) -> str:
    if op in OPCODES:
        return OPCODES[op]
    if op in RESPONSES:
        return RESPONSES[op]
    return f"unknown_0x{op:02x}"


def enumerate_hidraw() -> list[dict]:
    """Map /dev/hidrawN to (vid, pid, interface) using sysfs. Needs no privileges."""
    found: list[dict] = []
    base = "/sys/class/hidraw"
    if not os.path.isdir(base):
        return found
    for name in sorted(os.listdir(base)):
        devdir = os.path.join(base, name, "device")
        try:
            with open(os.path.join(devdir, "uevent"), "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        m = HID_ID_RE.search(text)
        if not m:
            continue
        vid, pid = int(m.group(2), 16), int(m.group(3), 16)
        phys = HID_PHYS_RE.search(text)
        iface = None
        if phys:
            mi = IFACE_RE.search(phys.group(1))
            if mi:
                iface = int(mi.group(1))
        entry = {
            "node": f"/dev/{name}",
            "vid": vid,
            "pid": pid,
            "iface": iface,
            "phys": phys.group(1) if phys else "",
            "match": vid == VID and pid == PID,
            "desc_len": 0,
        }
        try:
            with open(os.path.join(devdir, "report_descriptor"), "rb") as fh:
                entry["desc_len"] = len(fh.read())
        except OSError:
            pass
        found.append(entry)
    return found


def read_raw_descriptor(node: str) -> bytes:
    """Read a hidraw report descriptor from sysfs — no root required."""
    name = os.path.basename(node)
    with open(f"/sys/class/hidraw/{name}/device/report_descriptor", "rb") as fh:
        return fh.read()


def classify(desc_len: int) -> str:
    """Label a descriptor by size. The APPEX200 vendor collection is 34 bytes."""
    return {
        34: "VENDOR config interface (usage page 0xFF02, 64B in/out, no report IDs)",
        71: "Boot keyboard + LEDs (usage 0x06)",
        73: "Pointer/mouse (usage 0x02)",
        153: "Keyboard (report IDs 1,2) + digitizer (report ID 3)",
    }.get(desc_len, "unknown")


def find_target() -> dict | None:
    """Pick the vendor config interface of a matching device."""
    entries = enumerate_hidraw()
    for e in entries:
        if e["match"] and classify(e["desc_len"]).startswith("VENDOR"):
            return e
    for e in entries:
        if e["match"]:
            return e
    return None


def build_frame(cmd: int, payload: bytes = b"", param1: int = 0, param2: int = 0) -> bytes:
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(
            f"payload too long: {len(payload)} > {MAX_PAYLOAD} "
            f"({REPORT_SIZE}-byte report); page the request"
        )
    buf = bytearray(TRANSFER_LEN)
    buf[OFF_MAGIC] = MAGIC
    buf[OFF_CMD] = cmd & 0xFF
    buf[OFF_PARAM1] = param1 & 0xFF
    buf[OFF_PARAM2] = param2 & 0xFF
    buf[OFF_RESERVED] = 0
    buf[OFF_LENGTH] = len(payload)
    buf[OFF_DATA:OFF_DATA + len(payload)] = payload
    return bytes(buf)


def parse_response(buf: bytes) -> tuple[int, int, int, bytes]:
    """Return (opcode, frame, total, payload). Caller should check buf[0] == MAGIC."""
    op = buf[OFF_CMD]
    frame = buf[OFF_PARAM1]
    total = buf[OFF_PARAM2]
    length = buf[OFF_LENGTH]
    return op, frame, total, buf[OFF_DATA:OFF_DATA + length]


def describe_report_descriptor(data: bytes) -> list[str]:
    """HID report descriptor walker.

    Item byte layout: bits 7-4 = tag, bits 3-2 = type (0 Main, 1 Global,
    2 Local, 3 Reserved), bits 1-0 = size index (0,1,2 -> 0,1,2 bytes; 3 -> 4).
    """
    GLOBAL = {
        0x00: "UsagePage", 0x10: "LogicalMin", 0x20: "LogicalMax",
        0x30: "PhysMin", 0x40: "PhysMax", 0x70: "ReportSize",
        0x80: "ReportID", 0x90: "ReportCount",
    }
    USAGE_PAGES = {
        0x0001: "Generic Desktop", 0x0002: "Simulation", 0x0006: "Keyboard",
        0x0007: "LED", 0x0008: "Consumer", 0x0009: "Button",
        0x000B: "Consumer", 0x000C: "Digitizer", 0x000D: "Digitizer",
        0xFF00: "Vendor FF00", 0xFF01: "Vendor FF01", 0xFF02: "Vendor FF02",
    }
    USAGE_NAMES = {
        (0x0001 << 16) | 0x01: "Pointer", (0x0001 << 16) | 0x02: "Mouse",
        (0x0001 << 16) | 0x06: "Keyboard", (0x0001 << 16) | 0x30: "X",
        (0x0001 << 16) | 0x31: "Y", (0x0001 << 16) | 0x38: "Wheel",
        (0x000C << 16) | 0x01: "Digitizer", (0x000C << 16) | 0x380: "Pressure",
        (0x0007 << 16) | 0x00: "NumLock", (0x0007 << 16) | 0x01: "CapsLock",
        (0x0007 << 16) | 0x02: "ScrollLock", (0x0007 << 16) | 0x04: "Power",
        (0x0007 << 16) | 0x65: "Generic Indicator", (0x0007 << 16) | 0xFF: "Vendor LED",
        (0xFF02 << 16) | 0x02: "Config In", (0xFF02 << 16) | 0x03: "Config Data",
        (0xFF02 << 16) | 0x04: "Config Out",
    }
    out: list[str] = []
    i = depth = 0
    upage = 0
    rid = None
    rsize = rcount = 0
    lens: dict = {}
    while i < len(data):
        b = data[i]
        if b == 0xFE:
            out.append("  " * depth + f"(long item {data[i+1]} bytes)")
            i += 3 + data[i + 1]
            continue
        size_idx = b & 0x03
        ln = 4 if size_idx == 3 else size_idx + 1
        val = int.from_bytes(data[i + 1:i + ln], "little") if ln > 1 else 0
        typ = (b >> 2) & 0x03
        tag = b & 0xF0
        pad = "  " * depth
        if typ == 0:
            if tag == 0xA0:
                depth += 1
                out.append(f"{pad}Collection(Application)")
            elif tag == 0xC0:
                depth = max(0, depth - 1)
                out.append(f"{pad}EndCollection")
            elif tag in (0x80, 0x90, 0xB0):
                kind = {0x80: "INPUT", 0x90: "OUTPUT", 0xB0: "FEATURE"}[tag]
                bits = rsize * rcount
                lens[(rid, kind)] = lens.get((rid, kind), 0) + bits
                out.append(f"{pad}{kind:8s} {rsize}bit x{rcount} = {bits // 8} bytes")
            else:
                out.append(f"{pad}Main 0x{tag:02X}")
        elif typ == 1:
            if tag == 0x00:
                upage = val
                nm = USAGE_PAGES.get(val)
                out.append(f"{pad}UsagePage(0x{val:04X})" + (f"  [{nm}]" if nm else ""))
            elif tag == 0x70:
                rsize = val
                out.append(f"{pad}ReportSize  = {val}")
            elif tag == 0x90:
                rcount = val
                out.append(f"{pad}ReportCount = {val}")
            elif tag == 0x80:
                rid = val
                out.append(f"{pad}*** ReportID = 0x{val:02X} ({val}) ***")
            else:
                out.append(f"{pad}{GLOBAL.get(tag, hex(tag))} = {val}")
        elif typ == 2:
            if tag == 0x00:
                nm = USAGE_NAMES.get((upage << 16) | val)
                out.append(f"{pad}Usage = 0x{val:04X}" + (f"  [{nm}]" if nm else ""))
            elif tag == 0x20:
                out.append(f"{pad}UsageMin = 0x{val:04X}")
            elif tag == 0x30:
                out.append(f"{pad}UsageMax = 0x{val:04X}")
            else:
                out.append(f"{pad}Local 0x{tag:02X} = {val}")
        i += ln

    if lens:
        out.append("  -- report byte lengths --")
        for (r, k), bits in sorted(lens.items(), key=lambda kv: (kv[0][0] is None, kv[0][0] or 0)):
            who = "NONE" if r is None else f"0x{r:02X} ({r})"
            out.append(f"     ReportID {who:12s} {k:8s} {bits // 8} bytes")
    return out




class Device:
    def __init__(self, node: str):
        self.node = node
        self.fd = os.open(node, os.O_RDWR)

    def close(self):
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def write(self, frame: bytes):
        n = os.write(self.fd, frame)
        return n

    def read(self, timeout_s: float = 1.0):
        import select
        r, _, _ = select.select([self.fd], [], [], timeout_s)
        if not r:
            return None
        try:
            return os.read(self.fd, TRANSFER_LEN)
        except BlockingIOError:
            return None


def cmd_list(args):
    entries = enumerate_hidraw()
    if not entries:
        print("No hidraw nodes found.")
        return 0
    print(f"{'node':<16} {'vid:pid':<11} {'desc':>5}  {'rw':<4} what")
    print("-" * 92)
    for e in sorted(entries, key=lambda x: (not x["match"], x["node"])):
        node = e["node"]
        rw = "rw" if os.access(node, os.R_OK | os.W_OK) else ("r" if os.access(node, os.R_OK) else "-")
        star = "*" if (e["match"] and classify(e["desc_len"]).startswith("VENDOR")) else " "
        print(f"{star}{node:<15} {e['vid']:04X}:{e['pid']:04X}  {e['desc_len']:>5}  {rw:<4} {classify(e['desc_len'])}")
    print()
    tgt = find_target()
    print(f"Looking for {VID:04X}:{PID:04X} (vendor config interface).")
    if tgt:
        print(f"  -> {tgt['node']}  interface {tgt['iface']}  {tgt['phys']}")
        if not os.access(tgt["node"], os.W_OK):
            print("  !! no write access - install the udev rule (see README.md):")
            print("       sudo cp 70-apex.rules /etc/udev/rules.d/")
            print("       sudo udevadm control --reload-rules && sudo udevadm trigger")
    else:
        print("  -> not found")
    return 0


def _open(args) -> Device:
    node = args.node or (find_target() or {}).get("node")
    if not node:
        print(f"No device matching {VID:04X}:{PID:04X}. Run `apexctl.py list`.", file=sys.stderr)
        sys.exit(2)
    if not os.access(node, os.W_OK):
        print(f"Permission denied on {node}. Install the udev rule first:", file=sys.stderr)
        print("  sudo cp 70-apex.rules /etc/udev/rules.d/", file=sys.stderr)
        print("  sudo udevadm control --reload-rules && sudo udevadm trigger", file=sys.stderr)
        sys.exit(2)
    return Device(node)


def cmd_descriptor(args):
    """Print every matching descriptor. Needs no privileges (reads sysfs)."""
    entries = [e for e in enumerate_hidraw() if e["match"]]
    if args.node:
        entries = [{"node": args.node, "desc_len": 0, "iface": "?", "match": True}]
    if not entries:
        print(f"No device matching {VID:04X}:{PID:04X}.", file=sys.stderr)
        return 2
    for e in entries:
        try:
            data = read_raw_descriptor(e["node"])
        except OSError as err:
            print(f"{e['node']}: {err}", file=sys.stderr)
            continue
        print(f"\n{'=' * 58}")
        print(f"{e['node']}   interface {e['iface']}   {len(data)} bytes")
        print("=" * 58)
        for line in describe_report_descriptor(data):
            print(line)
    return 0


def read_all(dev: Device, cmd: int, param2: int = 85, max_pages: int = 32,
              settle: float = 0.5) -> tuple[dict, int]:
    """Page through a multi-frame response.

    The device only sends page N when asked, so param1 is driven upward and the
    loop stops once `total` pages have arrived.
    """
    pages: dict[int, bytes] = {}
    total = 0
    for page in range(max_pages):
        dev.write(build_frame(cmd, b"", page, param2))
        while True:
            resp = dev.read(settle)
            if resp is None:
                break
            if resp[0] != MAGIC:
                continue
            _op, fr, tot, payload = parse_response(resp)
            pages[fr] = payload
            if tot:
                total = tot
            if total and fr + 1 >= total:
                break
        if total and len(pages) >= total:
            break
        if page == 0 and not total:
            break
    return pages, total


def _print_names(payload: bytes) -> None:
    """Decode a 0x18 effect-name page. Only valid for that opcode."""
    if len(payload) < 2:
        return
    width = payload[1]
    if width < 3 or width > 18:
        return
    names = []
    for i in range((len(payload) - 2) // width):
        field = payload[2 + i * width:2 + (i + 1) * width]
        nul = field.find(b"\0")
        names.append(field[:nul if nul >= 0 else len(field)].decode("ascii", "replace"))
    if names:
        print(f"       names: {', '.join(names)}")


def cmd_read(args):
    with _open(args) as dev:
        pages, total = read_all(dev, args.opcode, args.p2, settle=args.timeout)
        if not pages:
            print("(no response)")
            return 1
        joined = b"".join(pages[k] for k in sorted(pages))
        print(f"0x{args.opcode:02X} {opcode_name(args.opcode)}  {len(pages)} page(s), "
              f"{len(joined)} bytes total")
        for k in sorted(pages):
            pl = pages[k]
            tag = f"page {k}/{total}" if total else "single"
            print(f"  [{tag}] len={len(pl):3d}  {pl[:32].hex(' ')}"
                  + (" ..." if len(pl) > 32 else ""))
            if args.opcode == 0x18:
                _print_names(pl)
            text = "".join(chr(b) if 32 <= b < 127 else "." for b in pl)
            if sum(32 <= b < 127 for b in pl) > len(pl) * 0.5:
                print(f"       text: {text[:60]}")
        if len(joined) >= 3 and args.opcode != 0x18:
            vals = [int.from_bytes(joined[i:i + 2], "little")
                    for i in range(0, min(12, len(joined) - 1), 2)]
            print(f"  joined u16LE[0:6] = {vals}")
    return 0


def _send_and_read(dev, op, p1, p2, timeout):
    """Send one frame and print the response. Shared by cmd_light --read."""
    frame = build_frame(op, b"", p1, p2)
    print(f"--> 0x{op:02X} {opcode_name(op)}")
    dev.write(frame)
    deadline = time.time() + timeout
    expect = op | RESPONSE_FLAG
    while time.time() < deadline:
        resp = dev.read(max(0.0, deadline - time.time()))
        if resp is None:
            continue
        r_op, r_frame, r_total, pl = parse_response(resp)
        print(f"<-- 0x{r_op:02X} {opcode_name(r_op)} frame={r_frame}/{r_total} "
              f"len={len(pl)}")
        print("    " + " ".join(f"{b:02x}" for b in pl))
        if r_op == expect:
            return pl
    print("    (no matching response)")
    return None


def cmd_send(args):
    op = args.opcode
    # Safety gate, matching the web driver: an unclassified opcode never goes
    # out, a write needs --write, and factory/firmware commands need --i-am-sure.
    cls = opcode_class(op)
    if cls == "unknown":
        print(f"refusing 0x{op:02X}: not in the classified command table "
              f"(PROTOCOL.md section 3)", file=sys.stderr)
        return 2
    if cls == "write" and not args.write:
        print(f"refusing write 0x{op:02X} {opcode_name(op)}: pass --write to confirm "
              f"you intend to mutate device state", file=sys.stderr)
        return 2
    if op in FORBIDDEN_OPCODES and not args.i_am_sure:
        print(f"refusing 0x{op:02X} {opcode_name(op)}: factory-destructive. "
              f"Pass --i-am-sure if you really mean it.", file=sys.stderr)
        return 2

    with _open(args) as dev:
        frame = build_frame(op, b"", args.p1, args.p2)
        print(f"--> 0x{op:02X} {opcode_name(op)}  ({cls})")
        print("    " + " ".join(f"{b:02x}" for b in frame[:16]) + " ...")
        n = dev.write(frame)
        print(f"    wrote {n} bytes")
        expect = op | RESPONSE_FLAG
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            resp = dev.read(max(0.0, deadline - time.time()))
            if resp is None:
                continue
            r_op, r_frame, r_total, payload = parse_response(resp)
            print(f"<-- 0x{r_op:02X} {opcode_name(r_op)} frame={r_frame}/{r_total} len={len(payload)}")
            print("    " + " ".join(f"{b:02x}" for b in payload))
            if r_op == expect:
                return 0
        print("    (no matching response)")
    return 1


def cmd_light(args):
    """Set effect / brightness / speed via 0x13.

    Bytes 3..7 of the payload are device-owned. Without --raw-opaque they are
    sent as zero, which resets whatever the firmware keeps in them; read them
    back first with `--read` and pass the result to preserve state.
    """
    if args.read:
        with _open(args) as dev:
            _send_and_read(dev, 0x17, args.p1, args.p2, args.timeout)
        return 0

    if not EFFECT_MIN <= args.effect <= EFFECT_MAX:
        print(f"effect must be {EFFECT_MIN}..{EFFECT_MAX}", file=sys.stderr)
        return 2
    if not BRIGHTNESS_MIN <= args.brightness <= BRIGHTNESS_MAX:
        print(f"brightness must be {BRIGHTNESS_MIN}..{BRIGHTNESS_MAX} (it is a "
              f"percentage, not a 0-255 level)", file=sys.stderr)
        return 2
    if not SPEED_MIN <= args.speed <= SPEED_MAX:
        print(f"speed must be {SPEED_MIN}..{SPEED_MAX} (higher is slower)",
              file=sys.stderr)
        return 2

    payload = bytearray(8)
    payload[0] = args.effect
    payload[1] = args.brightness
    payload[2] = args.speed
    if args.raw_opaque:
        try:
            tail = bytes(int(x, 16) for x in args.raw_opaque.split(",") if x.strip())
        except ValueError:
            print("--raw-opaque takes comma-separated hex bytes", file=sys.stderr)
            return 2
        if len(tail) != 5:
            print("--raw-opaque needs exactly 5 hex bytes (payload 3..7)",
                  file=sys.stderr)
            return 2
        payload[3:8] = tail

    with _open(args) as dev:
        print(f"--> 0x13 set_effect_light effect={args.effect} "
              f"brightness={args.brightness}% speed={args.speed}"
              f"{'' if args.raw_opaque else '  [opaque bytes 3..7 ZEROED]'}")
        print("    payload " + " ".join(f"{b:02x}" for b in payload))
        frame = build_frame(0x13, bytes(payload), args.p1, args.p2)
        dev.write(frame)
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            resp = dev.read(max(0.0, deadline - time.time()))
            if resp is None:
                continue
            r_op, r_frame, r_total, pl = parse_response(resp)
            print(f"<-- 0x{r_op:02X} {opcode_name(r_op)} frame={r_frame}/{r_total} "
                  f"len={len(pl)}")
            print("    " + " ".join(f"{b:02x}" for b in pl))
            if r_op == 0x93:
                print("    status " + ("accepted" if pl[:1] == b"\x00" else
                                      "REJECTED (status " +
                                      (f"0x{pl[0]:02X}" if pl else "?") + ")"))
                return 0 if pl[:1] == b"\x00" else 1
    print("    (no matching response)")
    return 1


def cmd_raw(args):
    try:
        payload = bytes(int(x, 16) for x in args.data.split(",") if x.strip()) if args.data else b""
    except ValueError:
        print("--data must be comma-separated hex bytes, e.g. ff,00,10", file=sys.stderr)
        return 2
    with _open(args) as dev:
        frame = build_frame(args.cmd, payload, args.p1, args.p2)
        print("frame: " + " ".join(f"{b:02x}" for b in frame[:6 + len(payload)]))
        dev.write(frame)
        deadline = time.time() + args.timeout
        while time.time() < deadline:
            resp = dev.read(max(0.0, deadline - time.time()))
            if resp is None:
                continue
            r_op, r_frame, r_total, pl = parse_response(resp)
            print(f"<-- 0x{r_op:02X} {opcode_name(r_op)} frame={r_frame}/{r_total} "
                  f"len={len(pl)}: {' '.join(f'{b:02x}' for b in pl)}")
    return 0


def cmd_monitor(args):
    with _open(args) as dev:
        print("monitoring... (Ctrl-C to stop)")
        while True:
            resp = dev.read(1.0)
            if resp is None:
                continue
            r_op, r_frame, r_total, pl = parse_response(resp)
            print(f"[{time.strftime('%H:%M:%S')}] 0x{r_op:02X} {opcode_name(r_op)} "
                  f"frame={r_frame}/{r_total} len={len(pl)}: {' '.join(f'{b:02x}' for b in pl[:64])}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node", help="hidraw node (default: auto-detect)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="enumerate hidraw nodes").set_defaults(func=cmd_list)
    sub.add_parser("descriptor", help="dump the HID report descriptor").set_defaults(func=cmd_descriptor)

    p_send = sub.add_parser("send", help="send a named opcode and print the response")
    p_send.add_argument("opcode", type=lambda s: int(s, 16))
    p_send.add_argument("--p1", type=int, default=0)
    p_send.add_argument("--p2", type=int, default=0)
    p_send.add_argument("--timeout", type=float, default=1.0)
    p_send.add_argument("--write", action="store_true",
                        help="required to send a WRITE opcode (26 of the 39)")
    p_send.add_argument("--i-am-sure", action="store_true",
                        help="required for factory-reset (0x61) and firmware (0x60/65/66)")
    p_send.set_defaults(func=cmd_send)

    p_light = sub.add_parser(
        "light",
        help="set RGB effect / brightness / speed via 0x13, or --read to read back")
    p_light.add_argument("effect", type=int, nargs="?", default=0,
                         help=f"effect index {EFFECT_MIN}..{EFFECT_MAX}")
    p_light.add_argument("--brightness", type=int, default=100,
                         help=f"{BRIGHTNESS_MIN}..{BRIGHTNESS_MAX}, a percentage")
    p_light.add_argument("--speed", type=int, default=100,
                         help=f"{SPEED_MIN}..{SPEED_MAX}; HIGHER IS SLOWER")
    p_light.add_argument("--raw-opaque", default="",
                         help="5 hex bytes for payload 3..7; omit to zero them")
    p_light.add_argument("--read", action="store_true",
                         help="read the current config via 0x17 instead of writing")
    p_light.add_argument("--p1", type=int, default=0)
    p_light.add_argument("--p2", type=int, default=0)
    p_light.add_argument("--timeout", type=float, default=1.0)
    p_light.set_defaults(func=cmd_light)

    p_read = sub.add_parser("read", help="page through a multi-frame response")
    p_read.add_argument("opcode", type=lambda s: int(s, 16))
    p_read.add_argument("--p2", type=int, default=85, help="param2 (85 = all keys)")
    p_read.add_argument("--timeout", type=float, default=0.5, help="per-page settle time")
    p_read.set_defaults(func=cmd_read)

    p_raw = sub.add_parser("raw", help="send an arbitrary frame")
    p_raw.add_argument("--cmd", type=lambda s: int(s, 16), required=True)
    p_raw.add_argument("--data", default="")
    p_raw.add_argument("--p1", type=int, default=0)
    p_raw.add_argument("--p2", type=int, default=0)
    p_raw.add_argument("--timeout", type=float, default=1.0)
    p_raw.set_defaults(func=cmd_raw)

    sub.add_parser("monitor", help="print incoming frames until interrupted").set_defaults(
        func=cmd_monitor)

    args = ap.parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())