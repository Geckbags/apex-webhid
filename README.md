# APEX 200 WebHID control

Open-source replacement for the ANT ESPORTS APEX 200 Windows software. A static
web page (no build step) plus a hidraw CLI for Linux.

**Live app:** <https://geckbags.github.io/apex-webhid/> — GitHub Pages over HTTPS,
which is a secure context, so WebHID works. Use Chrome or Edge on a desktop;
Firefox and Safari do not implement WebHID.

The protocol was recovered from `GameKeyboard.exe` by static analysis. See
[PROTOCOL.md](PROTOCOL.md) — 39 send opcodes and 40 dispatched responses, all
classified, with confidence labelled per claim. Response opcode is exactly
`request + 0x80` on all 37 pairs that have one.

## Web app

No build step, no server. Serve the directory over HTTP (WebHID needs a secure
context; `localhost` counts):

    python3 -m http.server 8000
    # open http://localhost:8000 in Chrome or Edge

Firefox does not implement WebHID.

### "Failed to open HID device"

The config channel is the vendor collection on usage page `0xFF02` (USB
interface 0). The app filters the picker on that page and verifies the selected
interface before opening it, so a wrong-interface pick is reported rather than
silently ignored. If opening the correct interface still fails:

- **Linux** — install the udev rule and replug the keyboard:

      sudo cp 70-apex.rules /etc/udev/rules.d/
      sudo udevadm control --reload-rules && sudo udevadm trigger

  Check that `/dev/hidraw*` now has an ACL for your user (`getfacl`). Chrome or
  Chromium installed as a snap/Flatpak may have no hidraw access at all; a
  distro package, Brave, or the official `.deb` works.
- **Windows** — close the ANT ESPORTS software and any other HID utility before
  connecting; they can hold the config interface open.
- Connect the keyboard **by USB**. WebHID cannot reach the 2.4 GHz dongle or
  Bluetooth.
- Close other browser tabs that already have the keyboard open.

The status pill names the failure and the Device tab's trace shows the
collections the browser actually exposed. **Scan granted HID devices** lists
every interface Chrome remembers permission for, without opening any of them.

## CLI

Needs the udev rule so the device is readable without root:

    sudo cp 70-apex.rules /etc/udev/rules.d/
    sudo udevadm control --reload-rules && sudo udevadm trigger

Then:

    python3 cli/apexctl.py list
    python3 cli/apexctl.py send 62            # get product info (a read)
    python3 cli/apexctl.py light 0 --brightness 40 --speed 20
    python3 cli/apexctl.py light --read
    python3 cli/apexctl.py monitor

## Safety model

Writes to this board can brick its configuration. The only recovery is a factory
reset (`0x61`, payload `5A A5`), which discards every profile and binding.

Both frontends therefore:

- **refuse any opcode not in the classified table** — you cannot sweep the
  protocol by accident;
- **refuse a write unless you opt in** — `--write` on the CLI, `allowWrite: true`
  in the driver;
- **refuse factory reset and firmware commands** unless you pass an explicit
  second acknowledgement (`--i-am-sure`);
- **read the device back after every write** and report whether the change
  actually took.

## What works

| Feature | Status |
|---|---|
| RGB effect select (0-11) | working |
| Brightness, 0-100 % | working, byte 1 of `0x13` |
| Speed, 1-100, higher is slower | working, byte 2 of `0x13` |
| Effect names | working, paged |
| Profiles: list / add / switch / delete | working, readback verified |
| Fn layer read | working |
| Key map / per-key remap (0x2A) | working, read-only, decoded to key names |
| Keymap reference diff | working — a read alone cannot tell you what is remapped |
| Global settings: polling rate, dead keys, shake, sports mode, layer (0x50/0x5E) | working, read-modify-write, readback verified |
| Trigger + calibration reads | working |
| Device snapshot: all 10 config tables to JSON | working — read-only backup |
| Product info, report descriptor | working |
| Macros M1-M10: read, write, delete | working — real keystroke editor, readback verified |
| Six advanced modifiers (DKS/MT/TGL/RS/SOCD/OKS) | working — all six codes decoded |
| Per-key colour | **exposed** — `0x11` setCustomLightAll, read-modify-write + readback verification, every byte named (§8.13.2) |
| Actuation-point writes | **disabled** — packing decoded (§8.21.5), but never hardware-validated; a wrong write needs a factory reset |
| Profile import (host config → device) | **not implemented** — the Windows app uses `ImportConfigUtil`; it needs the gated keymap, trigger and high-key bulk writes |
| Firmware update | **not implemented** |

The advanced modifiers are fully decoded: their six record codes are
`TGL=0, MT=1, DKS=2, RS=3, OKS=4, SOCD=5` — deliberately *not* in the order the
app lays its dialogs out — with record lengths 6, 11, 19, 4, 4 and 5. SOCD is
specified end to end including its four resolution modes.

Per-key colour is exposed via `0x11` with read-modify-write and readback verification.
unknown" — that turned out to be a false contradiction between three things
measuring different things. The per-key byte in `0x10` is **a key index**, not a
colour: it is the per-key map entry's byte 0, which the app uses to select a
slot in a per-key table. So `0x10` carries `[brightness, R, G, B]` followed by
one key index per key.

It is still gated for a sharper reason: selecting one key emits an index for
**every entry in that key's group**, so the command has no single-key
granularity. Exposing it would colour keys the user never selected. PROTOCOL.md
8.11.1 and 8.11.2 have the instruction-level evidence.

Macros are a real editor rather than a hex field. The field names are not
guesses: `GameKeyboard.exe` ships the SQLite schema it uses to persist macro
records, and the bind code ties each column to a byte offset. Each step is
`type`, `state` (down/up), a 16-bit HID usage split across `lValue`/`hValue`,
and a 16-bit millisecond delay. The same schema also named `0x13`'s two
previously-opaque bytes (`fullColor`, `functionFlag`), every field of the trigger
record, and the 20-byte global-settings blob behind `0x50`/`0x5E` — polling rate,
dead keys, shake level, calibration, sports mode and current layer. PROTOCOL.md
8.12-8.14 has the DDL and the offsets.

Before changing anything on this board, take a **Device snapshot**. It reads all
ten configuration tables in one pass and saves them as JSON with every payload
kept as bytes, plus a decoded view for the six tables that have one. Nothing in it can write — and since the only recovery from a bad
write is a factory reset, it is the only record of the current state that can be
made from the host. It is the WebHID counterpart to the Windows app's
`SyncConfigUtil`.

A third, which opened two gates at once. `sender+0xC0` — carried for several
sections as an unnamed "keyboard-config byte" and the *only* thing holding back
the `0x20` keymap write — is the **keymap layer**, with exactly two legal values.
And the `0x11` leading byte, which §8.13.1 had concluded was "a global flag", is
actually the **first entry's `keyItem`**, byte-for-byte the same instruction
sequence `0x20` uses. Both had been sitting in the spec as open questions when
the answer was already visible in a builder.

That pattern is the useful part: a byte forwarded by one command and *acted on* by
another gets its meaning from the second one.

A negative result worth having: `0x13` and the keymap both *permute* their
records onto the wire, so it was worth asking whether the trigger write does too.
It does not — the whole `0x26` body is a byte-for-byte `memcpy` out of an array
the builder never inspects. That removes a hypothesis, and it localises the
remaining question to whatever fills that array.

Two corrections worth stating plainly, both in the keymap parser.

The first: its three wire bytes were named `modifier`, `layer` and `usage`. Two
of those were wrong — there is no per-record modifier, and no per-record layer,
because the layer qualifies the whole read. They are `type`, `lValue`, `hValue`.

The second, and the more interesting one: **the wire is not in schema order.**
The `0x20` builder writes record bytes `rec[1], rec[3], rec[2]`, so `lValue` and
`hValue` arrive the *opposite* way round from the database columns. Reading the
schema and dropping `keyItem` gives a 16-bit usage of `0x01xx`, which is not a
HID usage for any key — that nonsense is what made the fields look wrong for
several phases. `hValue` carries the usage; `lValue` is a constant `0x01`. The
permutation is exported as data and checked against the spec, so the two cannot
drift apart (PROTOCOL.md 8.18.3). Chasing that down also turned
up a bug: the UI decided a key was remapped by comparing its HID usage against
its record position, which on a factory-fresh board is true for nearly every
key. It now compares against a reference you take explicitly.

One more embedded artefact paid off: every Qt class's moc string-data blob, which
lists that class's signals and slots **with their parameter names**. That named
the five frame fields as the app itself names them, showed the keymap read is
layer-qualified, and produced a complete map of which class reacts to each device
response — including `ImportConfigUtil`, a whole-profile writer with no UI of its
own. PROTOCOL.md 8.16-8.17.

Full list of open items: PROTOCOL.md section 10.

PROTOCOL.md section 12 audits all 39 functions the Windows app can perform:
**24 exposed, 11 deliberately gated, 4 refused as firmware.** No row is blank and
every gated row names what would have to be known first. The test suite checks
that table against the code, so it cannot drift into a claim the app does not
support.

## Tests

    ./test/run-all.sh

Three suites:

- **`node test/protocol.test.mjs`** — 413 assertions on opcode classification,
  the `0x13` permutation (checked against a hand-computed uint64, not the same
  table under test), range rejection, byte-order preservation, and frame layout.
- **`test/browser-smoke.html`** — the same protocol layer again, but *inside a
  real browser*, so the ES modules, BigInt, and WebHID feature detection are
  genuinely exercised rather than assumed.
- **`test/dom-wiring.html`** — loads the real page and checks that every element
  the app reaches for exists, that no button is left without a handler, that no
  id is duplicated, that the effect dropdown only offers in-range effects, and
  that the macro editor actually *works* — clicking Add really appends a row,
  the remove control really removes one, and every key picker is populated with
  unambiguous names.

The last block is a completion audit: it carries the binary's own opcode list as
independent ground truth and checks that the spec, the code and the binary all
agree. Deleting a parity row, renaming a response in one file, and unclassifying
an opcode were each injected as tests, and all three were caught.

The browser suites are not decoration. Running them found four real defects:

- a duplicate `id="trace"`, so `$('#trace')` returned the wrapping `<section>`
  and the traffic log was written to the wrong node;
- three buttons (`btnGetLightName`, `btnCustom`, `btnReadHighKeys`) whose
  handlers had been deleted during an earlier edit — dead UI that `node --check`
  cannot see;
- the effect dropdown offering effect 12, which is a `null` placeholder for an
  undecoded record and is **outside the device's validated 0-11 range**;
- a test bug of my own, asserting 12 effect names when the array correctly holds
  13 slots (12 decoded plus the placeholder).

Set `BROWSER=/path/to/chrome` if the browser is not on the default path.

## Layout

    index.html          UI, no framework
    js/protocol.js      framing, opcodes, read/write classification
    js/driver.js        WebHID transport, paging, write guard, verification
    js/app.js           UI wiring
    cli/apexctl.py      hidraw CLI
    test/               protocol self-checks
    PROTOCOL.md         the reverse-engineering writeup
