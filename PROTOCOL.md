# ANT ESPORTS APEX 200 — USB/HID Protocol Notes

Reverse-engineered from `~/Downloads/APEX-200.exe` (Inno Setup 6.4.0.1, 115 MB).

| Artifact | Value |
|---|---|
| Installer SHA-256 | `0ef08bf1434419e3bceba497bf7efebe5245a939a4c418326a1a815bcb5b866b` |
| Installer framework | Inno Setup 6.4.0.1 |
| Main app | `app/GameKeyboard.exe`, x86-64 PE, MSVC 14.44, Qt 6 Widgets, C++ |
| App SHA-256 | `8c8375bd4a7cee0c00fc8a0bf18f3618b8b4f9730a611998088c9c893e6f0c7d` |
| Transport | `hidapi.dll` (stock hidapi) — **no feature reports used** |
| Compression | `app/z.dll` — stock zlib renamed (`deflate`/`inflate`/`crc32`) |
| Storage | `app/data/gameboard.db3` (SQLite), `app/data/config.ini` |

> Extracting the payload requires innoextract >= 1.10-dev (`dscharrer/innoextract` @ `6e9e34e`);
> distro `innoextract` 1.9 fails with `Unexpected setup data version: 6.4.0.1`.

## 1. Device identity

**Confirmed on hardware.** `lsusb` reports `314b:1026 APEX APEX200` — exactly the
filter recovered from the binary (`mov eax,0x314b; cmp di,ax; mov eax,0x1026; cmp si,ax`).

| Field | Value |
|---|---|
| Vendor ID | `0x314B` |
| Product ID | `0x1026` |
| Product string | `APEX APEX200` |
| Config interface | **USB interface 0** (`/dev/hidraw0`) |
| Report size | **64 bytes**, input and output |
| Report IDs | **none** on the vendor interface |
| Usage page | **`0xFF02`** (vendor defined), usage `0x0002` |
| Product key | `APEX`, serialNumber `1028`, keyNumber **85** |
| Config table ranges | trigger 10..359, qtt/qrt 4..330 |

### Interface map

Four HID interfaces, Linux exposing them in USB order:

| USB iface | hidraw | Descriptor | Class | Endpoints | Role |
|---:|---|---:|---|---|---|
| 0 | `hidraw0` | 34 B | HID | **IN + OUT** (0x84/0x04, 1 ms) | **vendor config channel** |
| 1 | `hidraw1` | 71 B | HID, proto 1 | IN only | boot keyboard + LEDs |
| 2 | `hidraw2` | 73 B | HID, proto 2 | IN only | pointer |
| 3 | `hidraw3` | 153 B | HID, proto 1 | IN only | keyboard (IDs 1,2) + digitizer (ID 3) |

Interface 0 is the only bidirectional one, which is exactly why it carries the
config protocol. The keyboard's real HID report descriptor:

```
UsagePage(0xFF02)  [Vendor FF02]
Usage = 0x0002     [Config In]
Collection(Application)
  Usage = 0x0003   [Config Data]
  ReportSize 8, ReportCount 64
  INPUT  8bit x64 = 64 bytes
  Usage = 0x0004   [Config Out]
  ReportSize 8, ReportCount 64
  OUTPUT 8bit x64 = 64 bytes
EndCollection
```

Note the earlier "target interface 2" came from the shipped `device_table`, which
recorded a *different* model in the same family (`HJX HX-82A`, `0x0C45:0x1001`).
For the APEX200 itself the config channel is interface 0.

## 2. Frame format

| Offset | Field | Notes |
|---:|---|---|
| 0 | `0xFA` | **magic byte** — *not* a report ID (see below) |
| 1 | `command` | |
| 2 | `param1` | start index |
| 3 | `param2` | end index |
| 4 | `0x00` | reserved |
| 5 | `length` | payload length |
| 6..63 | `payload` | `length` bytes, max **58** |

Responses reuse the layout with `command | 0x80`, and offsets 2/3 repurposed as
`frame` / `total` for chunked transfers.

### Corrections forced by the real descriptor

Three earlier conclusions were wrong and are now fixed:

1. **`0xFA` is not a report ID.** The vendor collection declares no `ReportID`
   items, so the implicit report ID is 0 and `0xFA` is a protocol magic byte.
   For WebHID this means `sendReport(0, frame)`, not `sendReport(0xFA, …)`.
2. **Reports are 64 bytes, not 128.** The app's `gUsbFrameMaxsize` is 128 and it
   calls `hid_write(dev, buf, 129)`; the APEX200's report is 64. The app either
   over-writes harmlessly or targets larger reports on other models in the
   family. **Unverified** until a frame round-trips.
3. **The payload budget is 58 bytes, not 123** (64 − 6). This tightens paging:
   `0x28` over 85 keys (681 B) now needs ~12 frames, and `0x27` fits only 7 keys
   per frame.

### Wireless (BLE) variant

**Solved.** Every one of the 39 frame builders carries a second, otherwise
identical builder one branch away, selected by a transport flag rather than by
user choice. The BLE form prepends a single `0x00` byte and shifts everything up
by one:

```
USB:  [0]=0xFA [1]=opcode [2]=order [3]=frame [4]=retry [5]=total  payload@[6]
BLE:  [0]=0x00 [1]=0xFA [2]=opcode [3]=order [4]=frame [5]=retry [6]=total  payload@[7]
```

Header fields and payload bytes are otherwise identical. Full detail in §3.2.
Not yet exercised on hardware — the board under test is wired USB.

### Receive validation

- Byte 0 must be `0xFA`; otherwise the error path `sub_14001a100(this, 0xFF, this[0x28])`
  runs and the loop continues without dispatching.
- Dispatch key is `byte1 - 0x90`, bounded to `0x90..0xF1`, indexed into the
  98-byte table at `.text:0x140089a04`.
- 40 opcodes are dispatched; the remaining 58 fall through to the default handler.
- The read loop uses `hid_read_timeout(dev, buf, reportSize + 1, 1000)`.

Full table and the unsolicited-`0xF1` finding in §4.

## 3. Command table — complete, with read/write classification

Every frame builder was located by scanning `.text` for the `0xFA` magic write and
the immediately following command byte, then attributed to a method via its
`"=== UsbCommunicateUtil <method> send data result="` log string. **39 frame
constructors, 39 distinct opcodes** — this is the complete send surface.

`Dir` is the classification that must gate every send. `READ` frames only request
data. `WRITE` frames mutate device state.

| Cmd | Method | Dir | Payload (after the 6-byte header) |
|---:|---|:---:|---|
| `0x10` | sendSetCustomLight | **W** | 4B `[brightness,R,G,B]` + key-index list; group-expanded (§8.21.2) |
| `0x11` | sendSetCustomLightAll | **W** | 1B first key + N x 4B — **exposed**, read-modify-write + readback |
| `0x13` | sendSetEffectLight | **W** | 8B: `0x240`,`0x242`,`0x243`,`0x244`,`0x241`,`0x245`,`0x246`,`0x247` |
| `0x14` | sendSetEffectLightAll | **W** | N x 8B effect record, no prefix (§8.21.1) |
| `0x16` | sendGetCustomLight | R | none |
| `0x17` | sendGetEffectLight | R | 1B: effect index |
| `0x18` | sendGetEffectLightName | R | 1B: name-set selector (`0` English/default, `1`, `7`); **not** an effect index (§8.23.2) |
| `0x19` | sendSelectEffectLight | **W** | 1B: effect index |
| `0x20` | sendSetKeyboardConfig (A) | **W** | `[layer][firstKeyItem]` + N x 3B `[type,lValue,hValue]` (§8.21.3) |
| `0x22` | sendAddHighKey | **W** | `[key][type]` + type-specific data; record 6/11/19/4/4/5B (§8.3.1) |
| `0x23` | sendSetHighKey | **W** | paged: 19B per slot, ≤3 slots; frame `[page][lastPage][0][LEN]` (§8.21.8) |
| `0x24` | sendSetKeyboardConfig (B) | **W** | `[layer]` + N-byte caller list (§8.21.4) |
| `0x25` | sendDelHighKey | **W** | 1B: key item (`0x24A`), **not** a table index |
| `0x26` | sendSetTriggerConfig | **W** | `[trigger lo][trigger hi]` + key-index list (§8.21.5) |
| `0x27` | sendSetQuickTriggerConfig | **W** | N x 8B `[keyItem,0,model,quick,qt u16,rt u16]` (§8.21.5) |
| `0x28` | sendSetTriggerConfigAll | **W** | `[firstKeyItem][count]` + N x 8B full record (§8.21.5) |
| `0x2A` | sendGetKeyboardConfig | R | 1B: keymap layer (`0xC0`, 0 or 1) |
| `0x2B` | sendGetHighKey | R | none; replies with fixed 19B slots (§8.3.5) |
| `0x2C` | sendGetTriggerConfig | R | none |
| `0x40` | sendSetMacroConfig | **W** | paged: `[slot][count]` + count x 6B; 9 records per frame (§8.10.3) |
| `0x41` | sendDelMacroConfig | **W** | 1B: `0x108` |
| `0x42` | sendGetMacroConfig | R | 1B: macro slot (`0x108`, 0..9); one slot per request |
| `0x50` | sendSetWholeParam | **W** | 20B (`LEN=0x14`): `[0xFF]` + 10B struct + 9 x `0xFF` |
| `0x52` | sendGetCalibrationState | R | none |
| `0x53` | sendSetReportCalibration | **W** | 1B: `0x298` |
| `0x54` | sendSaveCalibration | **W** | none |
| `0x55` | sendSwitchConfigTable | **W** | 1B: `0x88` |
| `0x56` | sendSetConfigInfo | **W** | 30B: `[selector]` + UTF-8 name, zero-padded (§8.21.7) |
| `0x57` | sendGetConfigInfo | R | none |
| `0x58` | sendAddConfigTable | **W** | 1B: `0x88` |
| `0x59` | sendDelConfigTable | **W** | 1B: `0x88` |
| `0x5B` | sendGetCalibrationAdc | R | none |
| `0x5E` | sendGetWholeParam | R | none |
| `0x60` | sendDownloadFirewwareKeyboard | **W** | firmware chunk |
| `0x61` | sendResetKeyboard | **W** | 2B: `0x5A`,`0xA5` |
| `0x62` | sendGetProductInfo | R | 7B: `[0, year, month, day, hour, minute, second]` (§8.23.3) |
| `0x63` | receiveDownloadFirewareKeyboardEnd | R | 8B: `0x2DC`…`0x2DF`,`0x2D8`…`0x2DB` |
| `0x65` | sendDownloadFirewareData | **W** | firmware chunk |
| `0x66` | sendDownloadFirewareDataEnd | **W** | 8B: `0x2DC`…`0x2DF`,`0x2D8`…`0x2DB` |

13 READ, 26 WRITE. No opcode is unclassified.

### 3.1 Header layout, as written

Every builder writes the same six header bytes before the payload:

```
[0] = 0xFA          magic
[1] = opcode
[2] = sender[0x5A]  order
[3] = sender[0x59]  frame
[4] = retry         (0x00 for most; a register for the paged commands)
[5] = total         payload length
```

`sender[0x5A]` is the paging *order* and `sender[0x59]` the *frame* index. This is
where the paging model of §5 comes from — it is a property of the header, not of
any particular opcode.

### 3.2 BLE variant

**Every one of the 39 builders has a second, otherwise identical frame builder
one branch away**, used when the keyboard is paired over Bluetooth. It differs in
exactly one way: a `0x00` byte is prepended, shifting everything up by one.

```
BLE:  [0]=0x00  [1]=0xFA  [2]=opcode  [3]=order  [4]=frame  [5]=retry  [6]=total  payload at [7]
USB:  [0]=0xFA       [1]=opcode  [2]=order  [3]=frame  [4]=retry  [5]=total  payload at [6]
```

Payload contents and every header field are otherwise identical. The branch is
selected by a device-transport flag, not by user choice.

### 3.3 Naming defects found in the app

- **`0x20` and `0x24` are two distinct functions that both log
  `"sendSetKeyboardConfig"`.** They are not the same code — `0x20` takes its
  `retry` byte from a register and `0x24` writes `0x00`, and they have different
  caller sets (`0x20` has 3 callers, `0x24` has 2). Which one the app picks for a
  given UI action is not distinguishable from the log strings alone.
- **`0x63` is named `receiveDownloadFirewareKeyboardEnd` but it is a frame
  *builder* on the send side.** It writes its own outgoing frame rather than
  parsing a response, despite the `receive_` prefix.
- **`sendSetEffectLightAll` is `0x14`, not `0x11`.** `0x11` is
  `sendSetCustomLightAll`. Earlier notes had these transposed.

### 3.4 Factory reset

`0x61` `sendResetKeyboard` sends a fixed 2-byte payload `0x5A 0xA5` — a magic
confirmation pair, not data. This is the **factory-reset** command: it returns the
board to defaults, which is the only recovery from a corrupted configuration.

It is the single most destructive opcode in the protocol and is **excluded from
the app**. The CLI can issue it manually, but nothing in the WebHID app calls it,
and it is not reachable from any UI path.

### 3.5 Sender object map

All 39 builders read from one object — the USB/light singleton at
`qword_140197048` — plus one QColor-bearing form at `qword_140197068`. Offsets
are exact (read directly from the payload-load instructions); the names are
inferred from the method that consumes each field, so treat names as
well-evidenced but not proven identifiers.

| Offset | Type | Meaning | Evidence |
|---:|---|---|---|
| `+0x07` | QTimer* | post-send completion timer | `QTimer::start(timer, 1000)` |
| `+0x30` | u8 | last command byte logged | setters store `0xAD` |
| `+0x31` | u8 | sub-mode tag | `0x93` = effect path, `0x90` = all-keys path |
| `+0x48` | u8 | retry count | logged as `retry={s[0x48]}` |
| `+0x58` | u8 | "arm completion timer" flag | `if (s[0x58]) QTimer::start(...)` |
| `+0x59` | u8 | **frame counter** → header `[3]` | every builder |
| `+0x5A` | u8 | **order counter** → header `[2]` | every builder |
| `+0x5C` | u8 | macro config second byte | `0x40` payload `[1]` |
| `+0x88` | u8 | config-table index | `0x55`, `0x58`, `0x59` |
| `+0xB0` | u8 | effect index for get | `0x17` payload `[0]` |
| `+0xC0` | u8 | **keymap layer**, 0 or 1 (§8.19) | `0x20`, `0x24`, `0x2A` |
| `+0x108` | u8 | macro index | `0x40`, `0x41`, `0x42` |
| `+0x208` | 30 B | config-info blob | `0x56` (30-byte payload) |
| `+0x240..+0x247` | u64 LE | **packed effect config** | see §6 |
| `+0x248` | u8 | effect index for select | `0x19` |
| `+0x24A`,`+0x24B` | u16 | high-key descriptor | `0x22`, `0x25` |
| `+0x260`,`+0x261` | u16 | trigger config | `0x26` |
| `+0x298` | u8 | calibration report flag | `0x53` |
| `+0x2D0..+0x2DF` | 16 B | firmware chunk + counters | `0x60`, `0x63`, `0x65`, `0x66` |

`+0x59` and `+0x5A` are the paging model of §5 in miniature: every frame carries
an incrementing order and frame number, and the firmware chunk commands move
`+0x2D4`/`+0x2D5` into header `[2]`/`[3]` instead of the struct counters.

The `+0x30`/`+0x31` pair is an app-internal log tag, **not** a wire field. It is
absent from every frame the builders write.

## 4. Response table — receive dispatch, verified

**Response opcode = request opcode + 0x80.** Verified against the binary with no
exceptions: all 37 dispatched responses that have a request counterpart sit at
exactly `request + 0x80`. The full accounting, all from assembly:

| | count | detail |
|---|---:|---|
| Requests the app can build | 39 | one `0xFA <op>` write each, §4.6 |
| Responses dispatched | 40 | `0x90`-`0xF1`, §4.1 |
| Paired `request`+`0x80` | 37 | exact, no exceptions |
| Requests with **no** dispatched response | 2 | `0x65`, `0x66` (firmware data / data-end) |
| Responses with **no** request | 3 | `0xA1`, `0xD1`, `0xF1` |

`0xA1` and `0xD1` are handled-but-unsolicited; `0xF1` is a device push (§4.2).

### 4.1 The receive thread

`UsbProtocolParse` receive loop at `0x140088a10`, running on a `QThread`:

```
hid_read_timeout(dev, buf, reportSize + 1, 1000)   // 1000 ms timeout
if (buf[0] != 0xFA) -> error path, loop
idx = buf[1] - 0x90
if (idx <= 0x61) switch (table[idx]) ...
```

The dispatch table is at **`0x140089a04`, 98 bytes, one byte per entry**, indexed
by `opcode - 0x90`. Values: `0x00` = explicitly ignored, `0x28` (40) = no handler
(default), `0x01`-`0x27` = handler index.

**40 of the 98 possible opcodes in the `0x90`-`0xF1` range are dispatched.**

The table is a pure jump table with **no special case for any value**:
`movzx eax, byte[rsi + (opcode-0x90) + 0x89a04]` then
`mov ecx, dword[rsi + eax*4 + 0x89960]; add rcx, rsi; jmp rcx`. Every value
`0x00`-`0x27` is a real handler slot; `0x28` (40) is the only sentinel, and it is
`jump[40]`, the single default entry at `0x140089a00`. All 40 slots are used and
each appears **exactly once** in the 98-byte table.

| Resp | Idx | Req | Signal |
|---:|---:|---:|---|
| `0x90` | 0 | `0x10` | set_custom_light |
| `0x91` | 1 | `0x11` | set_custom_light_all |
| `0x93` | 2 | `0x13` | set_effect_light |
| `0x94` | 3 | `0x14` | set_effect_light_all |
| `0x96` | 4 | `0x16` | get_custom_light_all |
| `0x97` | 5 | `0x17` | get_effect_light |
| `0x98` | 6 | `0x18` | get_effect_light_name |
| `0x99` | 7 | `0x19` | select_effect_light |
| `0xA0` | 8 | `0x20` | set_key |
| `0xA1` | 9 | `0x21` | set_key_function |
| `0xA2` | 10 | `0x22` | set_high_key |
| `0xA3` | 11 | `0x23` | set_high_key_more |
| `0xA4` | 12 | `0x24` | set_key_default |
| `0xA5` | 13 | `0x25` | del_high_key |
| `0xA6` | 14 | `0x26` | set_trigger |
| `0xA7` | 15 | `0x27` | set_quick_trigger |
| `0xA8` | 16 | `0x28` | set_trigger_all |
| `0xAA` | 17 | `0x2A` | get_key_config |
| `0xAB` | 18 | `0x2B` | get_high_key_config |
| `0xAC` | 19 | `0x2C` | get_trigger_config |
| `0xC0` | 20 | `0x40` | set_macro |
| `0xC1` | 21 | `0x41` | del_macro |
| `0xC2` | 22 | `0x42` | get_macro_all |
| `0xD0` | 23 | `0x50` | set_whole_config |
| `0xD1` | 24 | `0x51` | start_calibration |
| `0xD2` | 25 | `0x52` | start_calibration_config |
| `0xD3` | 26 | `0x53` | open_calibration_time |
| `0xD4` | 27 | `0x54` | save_calibration |
| `0xD5` | 28 | `0x55` | set_current_config_table |
| `0xD6` | 29 | `0x56` | set_config_table_info |
| `0xD7` | 30 | `0x57` | get_config_table |
| `0xD8` | 31 | `0x58` | add_config_table |
| `0xD9` | 32 | `0x59` | del_configure_table |
| `0xDB` | 33 | `0x5B` | get_calibration_adc |
| `0xDE` | 34 | `0x5E` | get_whole_config |
| `0xE0` | 35 | `0x60` | fireware_download |
| `0xE1` | 36 | `0x61` | reset |
| `0xE2` | 37 | `0x62` | get_product_info |
| `0xE3` | 38 | `0x63` | fireware_download_end |
| `0xF1` | 39 | *(none)* | config_change |

Signal names are the app's own; `fireware_download` and `fireware_download_end`
are spelled that way in the binary (`fireware`, not `firmware`), as is the send
method `sendDownloadFirewwareKeyboard` (§4.6). Kept verbatim rather than
corrected, so the tables can be diffed against the app.

Slot 0 is an ordinary handler, not an ignored case - see §4.4 for the correction.
Its handler is `sub_14001b1c0`; all 40 handlers share one generated shape (marshal
the frame fields, then `QMetaObject::activate(obj, 0x1400d5c70, <signal>, ...)`),
and differ only in the signal index. The slot -> signal index mapping is a
bijection onto `0x01`-`0x28`.

### 4.2 Hidden: unsolicited config-change push

**`0xF1` has no corresponding request opcode.** Nothing in the app sends a `0x71`;
the keyboard pushes `0xF1` on its own and the app dispatches it as
`config_change`. This is an unsolicited device-to-host notification - most likely
"state changed on the device, re-read". A WebHID driver must listen for it rather
than assume every response is solicited.

### 4.3 Hidden: handled responses with no sender

**Two** dispatched responses have no request the app can build:

- **`0xD1`** (slot 24, `start_calibration`) - no frame builder writes `0x51`.
- **`0xA1`** (slot 9, `set_key_function`) - no frame builder writes `0x21`.
  This one was missed in earlier drafts of these notes, which named only `0xD1`.

Both response paths exist for commands the app never sends - vestigial from a
removed flow, or reachable only from firmware. Recorded, not exercised.

Conversely, two requests the app **does** build have no dispatched response:
`0x65` (`sendDownloadFirewareData`) and `0x66` (`sendDownloadFirewareDataEnd`).
Their acks, `0xE5` and `0xE6`, fall to the default handler. A driver that waits
for those two will hang.

### 4.4 Correction: `0x90` **is** dispatched

An earlier draft of these notes said `0x90` mapped to "the explicitly ignored
case" and that a driver must not wait for it. **That was wrong**, and it came
from reading the table's value `0x00` as a sentinel.

There is exactly one sentinel, `0x28` (40), which is the default entry. Value
`0x00` is handler slot 0, and slot 0 is a live handler: `sub_14001b1c0`, which
emits signal `0x01`, `usb_receive_set_custom_light`. It is the same generated
template as the other 39 handlers - the same prologue, the same stack cookie,
the same five-argument marshal - with only `mov r8d, 1` in place of the other
signal indices.

Practical consequence: the `0x90` ack to `0x10 setCustomLight` is delivered to
the application, so a driver **may** wait for it. Verified structurally from the
jump table and the handler body; not yet confirmed against live hardware.

### 4.5 App bug: receive log fields are mislabelled

For a frame `[0]=0xFA, [1]=opcode, [2]=order, [3]=frame, [4]=retry, [5]=total`,
the receive thread logs:

```
"source:{this[0x28]} ;order:{buf[1]} ;frame:{buf[2]} ;total:{buf[3]} ;length:{buf[5]}"
```

It labels `buf[1]` as *order*, but `buf[1]` is the opcode - the code computes
`(buf[1] & 0xFF) - 0x90`. Labels are shifted by one field; the framing is not.
Harmless to the protocol, but it makes the app's own log output misleading when
reading captures.

### 4.6 The send side, re-derived from the app's own log strings

§3 names every opcode after the app's `UsbCommunicateUtil` methods. That mapping
can be re-checked independently, without trusting any earlier note, by pairing
each method's own log string with the `0xFA` frame write in the same function:

1. the app logs `"=== UsbCommunicateUtil <method> send data result="` at the end
   of every send function - 38 distinct method names in `.rdata`;
2. each send function writes the frame magic `mov byte[buf], 0xFA` and then
   `mov byte[buf+1], <opcode>`.

Walking back from each log-string reference to its function and reading the
`0xFA` pair gives the table below. Scanning the whole of `.text` for that
`0xFA`/opcode pair yields **exactly 39 distinct opcodes, one builder each**, so
this is the complete send surface - not a sample.

| Req | app method | builder |
|---|---|---|
| `0x10` | `sendSetCustomLight` | `0x1400a60f9` |
| `0x11` | `sendSetCustomLightAll` | `0x1400a66e7` |
| `0x13` | `sendSetEffectLight` | `0x1400a6e39` |
| `0x14` | `sendSetEffectLightAll` | `0x1400a73c7` |
| `0x16` | `sendGetCustomLight` | `0x1400a1f79` |
| `0x17` | `sendGetEffectLight` | `0x1400a2429` |
| `0x18` | `sendGetEffectLightName` | `0x1400a2919` |
| `0x19` | `sendSelectEffectLight` | `0x1400a5669` |
| `0x20` | `sendSetKeyboardConfig` | `0x1400a87b7` |
| `0x22` | `sendAddHighKey` | `0x14009e399` |
| `0x23` | `sendSetHighKey` | `0x1400a7b59` |
| `0x24` | `sendSetKeyboardConfig` | `0x1400a9153` |
| `0x25` | `sendDelHighKey` | `0x14009f219` |
| `0x26` | `sendSetTriggerConfig` | `0x1400ab719` |
| `0x27` | `sendSetQuickTriggerConfig` | `0x1400aabb3` |
| `0x28` | `sendSetTriggerConfigAll` | `0x1400abcfa` |
| `0x2A` | `sendGetKeyboardConfig` | `0x1400a3339` |
| `0x2B` | `sendGetHighKey` | `0x1400a2e69` |
| `0x2C` | `sendGetTriggerConfig` | `0x1400a4369` |
| `0x40` | `sendSetMacroConfig` | `0x1400a96b9` |
| `0x41` | `sendDelMacroConfig` | `0x14009f6d9` |
| `0x42` | `sendGetMacroConfig` | `0x1400a3829` |
| `0x50` | `sendSetWholeParam` | `0x1400ac499` |
| `0x52` | `sendGetCalibrationState` | `0x1400a1619` |
| `0x53` | `sendSetReportCalibration` | `0x1400ab249` |
| `0x54` | `sendSaveCalibration` | `0x1400a51b9` |
| `0x55` | `sendSwitchConfigTable` | `0x1400acb59` |
| `0x56` | `sendSetConfigInfo` | `0x1400a5b3c` |
| `0x57` | `sendGetConfigInfo` | `0x1400a1ac9` |
| `0x58` | `sendAddConfigTable` | `0x14009dea9` |
| `0x59` | `sendDelConfigTable` | `0x14009ed29` |
| `0x5B` | `sendGetCalibrationAdc` | `0x1400a1169` |
| `0x5E` | `sendGetWholeParam` | `0x1400a4839` |
| `0x60` | `sendDownloadFirewwareKeyboard` | `0x1400a0629` |
| `0x61` | `sendResetKeyboard` | `0x1400a4ce9` |
| `0x62` | `sendGetProductInfo` | `0x1400a3d11` |
| `0x63` | `receiveDownloadFirewareKeyboardEnd` | `0x1400a0c03` |
| `0x65` | `sendDownloadFirewareData` | `0x14009fb99` |
| `0x66` | `sendDownloadFirewareDataEnd` | `0x1400a0099` |

Two things this settles:

- **`0x20` and `0x24` really are two opcodes behind one name**
  (`sendSetKeyboardConfig`, two separate builders). Confirmed at the frame
  level, not just from the duplicated logging text (§3.3). §8.15 goes further:
  their payload shapes differ, so they are not variants of one command.
- **`0x63` is the odd one out**: its log string is
  `receiveDownloadFirewareKeyboardEnd`, not a `send*` name. It is a real
  builder, but it is logged on the receive side - a leftover misnomer like §4.5.

The names here also **confirm §3 was right** where an independent check later
suggested otherwise: `0x55` is `sendSwitchConfigTable`, `0x5B` is
`sendGetCalibrationAdc`, and `0x50` is `sendSetWholeParam`. The log strings are
the ground truth for **request** opcodes.

The Qt moc string-data blob is a different matter, and an earlier draft of this
note got it wrong in both directions. It does *not* give request opcodes - signal
names like `set_whole_config` and `start_calibration` sit beside
`setKeyWholeParam` and `setReportCalibration` without a positional relationship,
and reading one off the other produced 29 phantom mismatches. But it **is** an
exact source for **signal names by index**: blob position equals signal index
for all 40 dispatched responses, verified in §8.17.1. The two things are not in
conflict; they are different directions, and only one of them works.

## 5. Paged record commands

Decompilation showed that record-array commands are **not** one-key-at-a-time
writes. The sender object carries four fields that drive paging:

| Sender offset | Role | Frame position |
|---|---|---|
| `+0x59` | `endIndex` | param2 |
| `+0x5a` | `startIndex` (1-based) | param1 |
| `+0x5b` | `pageSize` | — |
| `+0x5c` | `recordCount` | — |

with

```
startOffset = (startIndex - 1) * pageSize
remaining   = (startIndex >= endIndex) ? recordCount - startOffset : ...
```

This is why `frame`/`total` exist in the response header: large record arrays are
transferred in pages, and a single 129-byte frame can only carry 123 payload bytes.

Per-command wire shapes (counts start at frame offset 6):

| Cmd | Prefix bytes | Bytes/record | Notes |
|---|---:|---:|---|
| `0x52` | — | — | **no payload**, length byte written as `0x00` |
| `0x5B` | — | — | **no payload**, length byte written as `0x00` |
| `0x26` | 2 | 1 | prefix is sender `+0x260`, `+0x261` |
| `0x27` | 0 | 8 | source struct is 16 B; emitted byte 1 written as `0x00` |
| `0x28` | 1 | 8 | prefix is the record count; records from source offsets 2..9 |
| `0x20` | 1 | 3 | prefix is sender `+0xC0` = the keymap layer (0 or 1); then the first entry's `keyItem`; then records permuted 1,3,2 |
| `0x11` | 1 | 4 | prefix is the page's first `keyItem`; paged, 14 records max (§8.13.4) |
| `0x10` | 4 | 1 | prefix is sender `+0x242`, `+0x245`, `+0x246`, `+0x247` |

Worked example: `0x28` over 85 keys = `1 + 8×85` = **681 bytes**, which cannot fit
one frame and must be paged. `0x27` over 15 keys = `0 + 8×15` = 120 bytes, which
does fit.

## 6. Lighting payload — `0x13` set effect light  (SOLVED)

`LightSetForm` has real brightness and speed controls, and the full byte layout of
`0x13` is now established from static analysis. Hopper's decompiler silently drops
the byte-assembly block in `sub_140037f80` / `sub_1400380d0`; only
`procedure_assembly` shows it. Read the assembly, not the pseudocode, for these.

### 6.1 The setter

`sub_1400b08a0` takes a `uint64` and unpacks it across eight adjacent bytes:

```c
s[0x240] = v & 0xFF;   s[0x241] = (v >> 8)  & 0xFF;   s[0x242] = (v >> 16) & 0xFF;
s[0x243] = (v >> 24) & 0xFF;   s[0x244] = (v >> 32) & 0xFF;
s[0x245] = (v >> 40) & 0xFF;   s[0x246] = (v >> 48) & 0xFF;   s[0x247] = (v >> 56) & 0xFF;
s[0x30] = 0xAD;  s[0x31] = 0x93;  s[0x48] = 0;
```

`s[0x240] == 0xFF` is a sentinel meaning *no single effect selected*.

### 6.2 The frame

`sub_1400a6e20` — `sendSetEffectLight`, identified by its own debug string
`"=== UsbCommunicateUtil sendSetEffectLight ..."` — builds:

```
buf[0] = 0xFA          magic
buf[1] = 0x13          opcode
buf[2] = s[0x5A]       order
buf[3] = s[0x59]       frame
buf[4] = 0x00          retry
buf[5] = 0x08          total (payload length)
buf[6] = s[0x240]      payload[0]
buf[7] = s[0x242]      payload[1]
buf[8] = s[0x243]      payload[2]
buf[9] = s[0x244]      payload[3]
buf[10]= s[0x241]      payload[4]
buf[11]= s[0x245]      payload[5]
buf[12]= s[0x246]      payload[6]
buf[13]= s[0x247]      payload[7]
```

Combined with §6.1, the uint64 byte order on the wire is the permutation
`[0, 2, 3, 4, 1, 5, 6, 7]`.

### 6.3 Byte meanings

The UI assembles the `uint64` one byte at a time. Two call sites differ, and the
difference is exactly the field the user was editing:

| payload | uint64 byte | meaning | written by |
|---------|-------------|---------|------------|
| 0 | 0 | **effect index**, 0–11 | every path |
| 1 | 2 | **brightness**, 0–100, raw | light slider; colour path preserves it |
| 2 | 3 | **speed**, 1–100 | speed slider; colour path preserves it |
| 3 | 4 | unnamed | passed through from `record[4]` |
| 4 | 1 | unnamed | passed through from `record[1]` |
| 5 | 5 | **red** | `QColor::red()` |
| 6 | 6 | **green** | `QColor::green()` |
| 7 | 7 | **blue** | `QColor::blue()` |

- The device rejects any effect index outside 0–11 with status `07`.
- Brightness is a **percentage of the 0–100 slider, not a 0–255 level.**
- Speed's slider range is `setRange(1, 0x64)` and higher = slower, so it is an
  interval, not a rate.

### 6.3.1 How bytes 5-7 were named

Three separate UI handlers each rewrite the `uint64` and substitute exactly one
group of fields, leaving the rest from the record. Reading all three together
names every byte:

| Handler | Address | Substitutes | Passes through |
|---|---|---|---|
| brightness | `0x140035d60` | `form+0x2C0` -> u2 | `record[1]`,`[3]`..`[7]` |
| speed | `0x14003c3a0` | `form+0x2E0` -> u3 | `record[1]`,`[2]`,`[4]`..`[7]` |
| **colour** | `0x140037cd0` | `QColor::red/green/blue` -> u5,u6,u7 | `record[1]`..`[4]` |

The colour handler is the decisive one:

```asm
movzx eax, BYTE PTR [rcx+0x1]        ; record[1]  -> unchanged
movzx eax, BYTE PTR [rcx+0x2]        ; record[2]  -> brightness, preserved
movzx eax, BYTE PTR [rcx+0x3]        ; record[3]  -> speed, preserved
movzx eax, BYTE PTR [rcx+0x4]        ; record[4]  -> unchanged
mov    rcx, rbx ; add rbx, 0x48      ; the form's QColor
call QColor::red                      ; -> byte 5
call QColor::green                    ; -> byte 6
call QColor::blue                     ; -> byte 7
call sub_1400b08a0                    ; build the frame
```

It confirms three things at once: that bytes 5-7 are RGB, that u2 is the
brightness byte (it deliberately preserves it rather than clearing it), and that
u3 is the speed byte. The permutation of §6.2 then places u5,u6,u7 at wire
positions 5, 6 and 7.

The colour handler is also reached through a fourth UI path tagged
`form+0x1C8 = 4`, alongside brightness (1), speed (2) and the all-keys variant —
a four-way dispatch on which control the user touched.

### 6.3.2 Bytes 3 and 4 (resolved in §8.12.2)

> **These two are now named.** Byte 3 is `fullColor` and byte 4 is `functionFlag`,
> recovered from the `effect_light_table` DDL the app ships. The reasoning below
> is kept because it is the evidence that led to looking, and it is correct about
> *why they read as opaque* — the app simply never sets them from the UI.

These remain unnamed. Both are carried through unchanged from the device record
by all three handlers, so nothing in the app treats them as host-addressable —
they are firmware-owned state. A driver should read and rewrite them verbatim
rather than zero them.

Brightness is a **percentage of the slider's 0–100 range**, not a 0–255 level.
This is the direct answer to the long-standing question of what 40% means:
**byte 1 = 40**.

### 6.4 Why the field order looked arbitrary

The setter writes a `uint64` into eight separate one-byte struct slots, and the
frame builder then reads them back in a permuted order. The permutation is stable
and is the only thing standing between the struct and the wire. Any reimplementation
must apply it: `wire = [u0, u2, u3, u4, u1, u5, u6, u7]`.

### 6.5 Per-key colour (`0x10`, `0x11`)

Unchanged: per-key colour rides inside the record array rather than the packed
config, and the in-record byte order is still unresolved.

### 6.6 Address map used above

`form` is the `LightSetForm` instance; `ui = form[0x5]`; `record` is the 8-byte
per-effect struct held in a `std::map<uint8_t, shared_ptr<record>>` at
`(*qword_140197068)+0xA8`, keyed by effect index at node offset `+0x20` with the
record pointer at `+0x28`.

| offset | meaning |
|--------|---------|
| `form+0x1C0` | selected effect index (`0xFF` = all keys) |
| `form+0x1C8` | pending-change tag: `1` = brightness, `2` = speed |
| `form+0x2C0` | brightness, 0–100 (dword) |
| `form+0x2E0` | speed, 1–100 (dword) |
| `form+0x48`  | `QColor` member — the selected colour |

## 7. Live capture results

Everything below was read from a real APEX200 (2026-10-17) with the CLI, not
inferred. Reads only — nothing was written to the keyboard.

### Paging behaviour

The device **does not stream** a multi-page answer. It sends page `n` only when
it is asked for, and reports progress in the response header's `frame`/`total`.

The vendor app asks for page **1** first: every read initiator writes
`sender+0x59/+0x5A = 0x0101`, so the first frame carries `[2]=1 [3]=1`
(`FUN_1400af5d0` for `0x2B`, and the same pattern for the other reads). On each
reply the handler sets `[2] = response frame + 1` and `[3] = response total`
before re-entering the builder (`FUN_140098b90`; §8.23.1). That is the sequence
`readAll()` implements.

The CLI's `read` tool starts at page 0; the firmware accepts 0 as an alias for
the first page, and page 0 is a count/probe page on some commands (several
return a single byte `0x0D` = 13, and `0x18` page 0 is a 16-byte blob). Page 0
is not part of the vendor app's read sequence, so the driver does not request
it. The CLI's earlier `--p2 1` no-reply observation was made on that page-0
probe, not on the vendor app's page-1/1 request.

| Cmd | Response | Pages | Notes |
|---|---|---:|---|
| `0x62` | `0xE2` | 1 | product info, 56 B |
| `0x18` | `0x98` | 4 | effect names |
| `0x16` | `0x96` | 6 | per-key custom light |
| `0x57` | `0xD7` | 5 | profile table |
| `0x2A` | `0xAA` | 5 | per-key remap, 3-byte records |
| `0x2C` | `0xAC` | 12 | trigger config, 7-byte records |
| `0x5B` | `0xDB` | 3 | per-key Hall-effect ADC |
| `0x52` | `0xD2` | 2 | per-key calibration flags |

`0x52` answers with `0xD2` (`start_calibration_config`), not the `0xD1` the static
mapping suggested — the handler table in §4 is off by one for this pair.

### Product info — `0x62`

```
04 04 39 10 fe ff 00 00 00 00  "APEX\0"  "V0.4\0"  "%s\r\n"  00 00 01 02
"APEX200\0" ... "vm_ilogoo1\0"
```

`04 04` and `39 10` are plausibly version fields; `fe ff` is `0xFFFE`. Firmware
string is **`V0.4`** (note `HID_UNIQ` in sysfs reads `V0.3` — the two disagree).

### Effect names — `0x18`

Pages 1..3 each carry three names in **18-byte null-terminated fields**, prefixed
by `[globalIndex][0x12]` where `0x12` = 18:

```
page 1  idx 0x00  "Close"   "Static"   "Layer"
page 2  idx 0x03  "Breath"  "Star"     "Flow L->R"
page 3  idx 0x06  "Flow R->L" "Flow Up->Dn" "Flow Dn->Up"
page 4  idx 0x09  "Dot(Press)" "Cross(Press)" "Ripple(Press)"
```

Twelve names recovered. Page 0 is a 16-byte non-ASCII blob
(`fd 12 62 40 20 4a 20 4e 20 c3 00 c0 ff e0 55 00`) — the thirteenth effect, still
undecoded. It is probably a Chinese-language name given the firmware origin.

### Profiles — `0x57`

Four onboard profiles, 32-byte pages, `[0x05][index][0x00][name in 18-byte field]`:

```
05 00 00 "KeyLayer1"
05 00 01 "KeyLayer2"
05 00 02 "KeyLayer3"
05 00 03 "KeyLayer4"
```

### Per-key data

- **`0x5B` calibration ADC** — 16-bit little-endian per key, values ~390–520,
  consistent with raw Hall-effect readings. 3 pages × 28 records ≈ 85 keys.
- **`0x2C` trigger config** — 7-byte records. First byte of each page is
  `page × 7`. Repeating body `f0 00 01 00 aa 00 64` decodes as four u16-LE values
  **240, 1, 170, 100**; `240` sits inside the documented trigger range 10–359.
  The remaining three fields are **not yet identified**.
- **`0x2A` key config** — 3-byte records `[00 01 <usage>]`; the third byte is a
  HID usage ID, so this is the per-key remap table. The bytes are `type,
  hValue, lValue` (§8.18) - not, as an earlier revision of this file had it,
  `modifier, layer, usage`. An earlier note here claimed
  the observed run `0x29, 0x3a … 0x42` was `) : ; < = > ? @ A B`. **That was
  wrong**: `;` and `<` are `0x33` and `0x36`, not `0x3b` and `0x3c`. The run is
  consecutive and reads `Escape, F1, F2 … F9`, which is both a real HID sequence
  and a plausible physical key row. Corrected after decoding the table with
  `parseKeymap()`.

## 8. Feature semantics (from RTTI, logs, `tip_file_en.ini`)

UI classes: `LightSetForm`, `QColorPalette`, `QColorSlider`, `QLightKeyboardWidget`
(RGB) · `AlignSetForm` (Hall-effect calibration) · `HighKeyForm` (key remap) ·
`QKeyKeyboardWidget`, `QInputKeyboardWidget`, `QNatureKeyboardWidget` ·
`FirewareDownloadThread`, `firmware.bin` / `firmversion.xml`.

Database tables (`gameboard.db3`): `device_table`, `product_table`,
`keyboard_default_table` (556 rows, keyItem/type/hValue/lValue/label),
`keyboard_default_fn1_table`, `key_position_table` (320 rows).

Hall-effect ranges from `product_table`: `triggerMin=10 triggerMax=359`,
`qttMin=4 qttMax=330`, `qrtMin=4 qrtMax=330`.

Firmware update pulls `/firmversion.xml` and `/firmware.bin`; bulk payloads are
**zlib-deflate compressed**, and the shipped `z.dll` is stock zlib, so a standard
inflate/deflate implementation is sufficient.

### 8.1 UI surface

The app is a `QMainWindow` with a left sidebar of stacked forms. Nine
`setObjectName` sites were located, one per form's `setupUi`:

| Form | Purpose |
|---|---|
| `KeySetForm` | key reassignment, layer selection |
| `LightSetForm` | lighting: effect, brightness, speed, per-key colour |
| `HighKeyForm` | advanced key modifiers |
| `MacroSetForm` | macro M1-M10 editor |
| `PerformanceSetForm` | polling rate, actuation, performance options |
| `OtherSetForm` | secondary options |
| `SystemSetForm` | language, theme, firmware check |
| `AlignSetForm` | alignment / calibration |
| `DeviceManageForm`, `FirewareManageForm` | device list, firmware select |

`MainWindow` toolbar actions: **Add a profile**, **Delete current profile**,
**Export current profile**, **Import a profile**, **Device list**, **Settings**,
**Select the firmware**.

Each form class exists twice, with and without an `AV` prefix
(`AVLightSetForm` / `LightSetForm`, etc.). Only the unprefixed set is reached from
the sidebar; the `AV*` variants appear to be a second, unreferenced generation of
the same screens.

### 8.2 Function vocabulary

Every assignable key action comes from `data/tip_file_en.ini`, which is the
authoritative list. Five namespaces:

- **`keyboard/control`** — the 8 modifiers (Left/Right Ctrl/Shift/Alt/Win)
- **`keyboard/key`** — ~90 printable keys, `F1`-`F24`, navigation, numpad
- **`keyboard/media`** — 19 multimedia and application keys
- **`keyboard/macro`** — `M1`-`M10`
- **`keyboard/high`** — the six advanced modifiers (below)

### 8.3 Hidden: six advanced key modifiers

`HighKeyForm` implements six non-obvious per-key modifiers, each with its own
add-dialog class and its own `QDksAddDialog` / `QRsAddDialog` / `QSocdAddDialog`
prompt. These are the feature most likely to be missed, and they are real
per-key functions, not cosmetics.

| Abbrev | Meaning | Notes |
|---|---|---|
| `dks` | Dynamic Key Stroke | distinct press/release keys |
| `mt` | Hold / Click (Click-Press) | two bindings for down vs up |
| `tgl` | Toggle | latches on press |
| `rs` | Radial Sensing | direction-aware; 8-way |
| `socd` | Simultaneous Opposing Cardinal Directions | **4 resolution modes** |
| `oks` | Key Override on Release | fires on key-up |

`SOCD` has four explicitly selectable resolutions, from `QSocdAddDialog`:
last key wins, Key1 wins, Key2 wins, and **"when both keys are pressed neither
is triggered"**.

All six are stored through the high-key opcode family — `0x22` add, `0x23` bulk
set, `0x25` delete (§3), with `0x2B` getHighKey to read them back. A driver that
only exposes plain keycodes cannot express these and is not feature-complete.

`0x22` and `0x25` are the per-binding edits the interactive `HighKeyForm` uses.
`0x23` is **not** a per-key edit and is **not** a 1-byte keyboard-config write:
it is a paged whole-table write of fixed 19-byte slots, and its only sender is
the config-import worker (`ImportConfigUtil`, started by MainWindow's Import
button). The two shapes must not be conflated; §8.21.8 has the builder evidence.

### 8.3.1 High-key record — fully decoded

`0x22 addHighKey` is a **variable-length** record. The frame builder branches on
the second byte:

```
[0]=0xFA [1]=0x22 [2]=0x01 [3]=0x01 [4]=0x00 [5]=LEN   (LEN is per-type)
[6]=sender+0x24A          the key item
[7]=sender+0x24B          TYPE — selects the record shape
[8..]=type-specific data from sender+0x24C onward
```

This is the **write** shape. `0x2B` does not return these variable-length
records: its readback is a sequence of fixed 19-byte slots, the same slot shape
`0x23` writes (§8.3.5).

### 8.3.2 The type codes

**The type codes are not in the same order as the labels.** Reading each add
dialog's descriptor initialiser settles it:

```asm
QTglAddDialog    mov DWORD PTR [rdi+0x40],0xffff00ff   -> byte1 = 0
QMtAddDialog     mov DWORD PTR [rdi+0x40],0x000001ff   -> byte1 = 1
QDksAddDialog    mov DWORD PTR [rdi+0x40],0x00ff02ff   -> byte1 = 2
QRsoAddDialog    mov DWORD PTR [rdi+0x40],0x000003ff   -> byte1 = 3
QOksAddDialog    mov DWORD PTR [rdi+0x40],0x000004ff   -> byte1 = 4
QSocdAddDialog   mov DWORD PTR [rdi+0x40],0x000005ff   -> byte1 = 5
```

| Type | Modifier | Dialog | `0x22` record len | Data bytes | Struct sources, in wire order |
|---:|---|---|---:|---:|---|
| `0` | **TGL** Toggle | `QTglAddDialog` | 6 | 4 | `0x24C`,`0x24D`,`0x24E`,`0x24F` |
| `1` | **MT** Hold/Click | `QMtAddDialog` | 11 | 9 | `0x24C`..`0x250`,**`0x252`**,**`0x251`**,**`0x253`**,`0x254`,`0x255` |
| `2` | **DKS** Dynamic Key Stroke | `QDksAddDialog` | 19 | 17 | `0x24C`..`0x25C` |
| `3` | **RS** Radial Sensing | `QRsoAddDialog` | 4 | 2 | `0x24C`,`0x24D` |
| `4` | **OKS** Key Override on Release | `QOksAddDialog` | 4 | 2 | `0x24C`,`0x24D` |
| `5` | **SOCD** | `QSocdAddDialog` | 5 | 3 | `0x24C`,`0x24D`,`0x24E` |

The lengths come from the branch table in the frame builder at `0x14009e380`:
types 0/1/2 set `LEN` to `6`/`0x0B`/`0x13`, types 3 and 4 both to `4`, and type 5
to `5`. Any type outside 0-5 sends `LEN = 0`, i.e. an empty record.

**In the `0x22` record, MT's data is 9 bytes, not 10.** Counting the `mov` pairs
in the branch at `0x14009e45a` gives ten loads (`0x24C`,`0x24D`,`0x24E`,`0x24F`,
`0x250`,`0x252`,`0x251`,`0x253`,`0x254`,`0x255`), but the last one at
`0x14009e4ec` writes to `frame[0x11]`, which is **past** the declared `LEN=0x0B`
— it is unreachable payload and must not be counted. This is the kind of
off-by-one that a "looks about right" implementation would ship.

The fixed-slot `0x23`/`0x2B` shape has no such truncation: it carries all ten
MT data bytes. Do not reuse the `0x22` length table for the readback.

Guessing here would have been actively dangerous: the dialogs are laid out in
memory as DKS, MT, TGL, RS, SOCD, OKS but their codes run **2, 1, 0, 3, 5, 4**.
An implementation that assumed code order matched label order would have written
a Toggle when the user picked Dynamic Key Stroke.

### 8.3.3 SOCD is fully decoded

`QSocdAddDialog` initialises `+0x43` (record byte 3) to `0xFF` and writes the
mode to `+0x44` (record byte 4) as one of exactly four values:

| Mode | Meaning |
|---:|---|
| 0 | last key wins |
| 1 | Key1 wins |
| 2 | Key2 wins |
| 3 | both pressed, neither triggers |

So a SOCD record is `[key, 5, key1, key2, mode]` — 5 bytes, fully specified.
Every other modifier's data bytes are still unnamed; only their count is known.

### 8.3.4 Field-order hazard

Type 1 (MT) emits `0x252` **before** `0x251`, so its data bytes are out of order
on the wire relative to the struct. This is the same class of non-linear ordering
as the `0x13` permutation in §6.2: a straight struct copy transposes two fields
silently. The only safe route is to build the record explicitly by index.

### 8.3.5 High-key readback `0x2B` — fixed 19-byte slots

`0x2B` is **not** a variable-length read. The `0xAB` handler `FUN_140098b90`
computes `LEN / 19` (magic `0xAF286BCB`) and walks the response payload with
stride `0x13`. Each entry is exactly the 19-byte slot `0x23` writes (§8.21.8):

```
slot[0] = key item
slot[1] = modifier type (0..5)
slot[2..] = type-specific data, zero padded
```

The handler's type switch copies exactly the slot widths from §8.21.8:

| Type | Modifier | Data bytes in the slot | Slot bytes 2..18 |
|---:|---|---:|---|
| `0` | TGL | 4 | 4 data, 13 zero |
| `1` | MT | 10 | 10 data, 7 zero |
| `2` | DKS | 17 | 17 data, 0 zero |
| `3` | RS | 2 | 2 data, 15 zero |
| `4` | OKS | 2 | 2 data, 15 zero |
| `5` | SOCD | 3 | 3 data, 14 zero |

So the readback carries all ten MT data bytes, including `src[0xB]` that the
`0x22` record cannot carry. The decoder must use the fixed stride, not the
`0x22` length table; treating slot byte 0 as a type is the specific mistake this
section exists to prevent.

`parseHighKeySlot()` and `decodeHighKeyRecords()` in `js/protocol.js` implement
the fixed-slot layout. They report a page whose length is not a multiple of 19,
and mark an unknown type rather than guessing its width.
`ApexHid.decodeHighKeyPages()` delegates to the same decoder.

The first request is page 1/total 1, and paging follows the response fields
(§7, §8.23.1).

### 8.4 Hidden: wireless transport switching

`keyboard/internal` exposes four onboard-transport actions that the app cannot
reach through any of the 39 documented opcodes: `24g` (2.4 GHz), and `bt1`,
`bt2`, `bt3` (three Bluetooth slots). Combined with §3.2, this board has three
separate Bluetooth pairings and one 2.4 GHz link, and the Windows app switches
them only through **onboard Fn shortcuts** — there is no host-side opcode. The
Windows app therefore cannot switch transports either; this is a firmware-side
function that both tools share as a limitation.

### 8.5 Hidden: five LED quick modes

`led1` through `led5` are quick-recall lighting modes bound to onboard buttons.
Like the transport switches, no host opcode corresponds to them.

### 8.6 Other functions with no host opcode

- `winLock` — locks the Win key so it cannot be used. Onboard only.
- `reset` — hold to restore factory settings. Equivalent to `0x61` but reached by
  holding a key, not by the app.
- `calibration` — hold 5 s to enter key calibration mode. Pairs with `0x52` /
  `0x5B` / `0x54`, which the app does expose.
- `web` — opens a web page from the board.

### 8.7 Onboard functions the app can also do

The onboard Fn layer duplicates a lot of what the app does: `rgbNext`,
`rgbPrev`, `rgbCycle`, `hueAdd`/`hueDec`, `lightAdd`/`lightDec`,
`rgbSpeedAdd`/`rgbSpeedDec`, `fn1`/`fn2`/`fn3` layer switching, `fninc`/`fndec`
profile cycling. The brightness and speed entries map cleanly onto the
`0x13` payload bytes solved in §6 — so the onboard brightness step and the app's
brightness slider are writing the same field, which is why `0x13` byte 1 tracks
the Fn key as well.

### 8.8 Confidence

8.1-8.3 are read from `setupUi` strings and the tip file: **high confidence**.
8.4-8.6 are inferences from the absence of a matching opcode among the 39
enumerated in §3: **medium confidence** — a transport switch could in principle
hide inside the opaque `0x56` 30-byte config blob, which is not yet decoded.
8.7 follows directly from §6 plus the tip file: **high confidence**.

## 9. WebHID viability

**Confirmed viable.** The vendor collection on interface 0 sits on usage page
**`0xFF02`**, which is *not* a protected usage, so Chrome exposes it and a page
can send and receive reports on it. The other three interfaces are
`0x0006 Keyboard` and `0x0002 Mouse` — both protected, and correctly inaccessible.

The software also uses only `hid_write` / `hid_read_timeout`, i.e. interrupt OUT
and IN reports, and never `hid_send_feature_report` / `hid_get_feature_report`.
WebHID supports output and input reports natively, so no feature-report
workaround is needed.

Implementation consequences of the no-ReportID descriptor:

```js
await device.open();
await device.sendReport(0, frame);           // reportId 0, whole 64-byte frame
device.addEventListener('inputreport', e => { // e.reportId is 0
  const frame = new Uint8Array(e.data.buffer); // e.data is the whole 64-byte frame
});
```

Request filter: `{ vendorId: 0x314b, productId: 0x1026, usagePage: 0xFF02 }`.
The `usagePage` term is load-bearing: a VID/PID-only filter matches every HID
interface of this composite device, and opening the keyboard or mouse collection
either fails ("Failed to open HID device") or succeeds against a collection that
ignores vendor frames. The app also checks `device.collections` for `0xFF02`
before `open()` and refuses anything else, so a wrong pick is an explicit error
rather than a silent no-op.

Caveats:

1. Wired USB only — WebHID cannot reach the 2.4 GHz dongle or Bluetooth.
2. `requestDevice()` filters cannot select by USB interface number; the
   `usagePage` filter selects the collection instead, and the app re-checks
   `collections` before opening.
3. On Linux, hidraw write access needs a udev rule.

### 8.9 Trigger record `0x26` — solved

> **Superseded twice.** §8.12.3 named every field (`keyItem`, `trigger`, `model`,
> `quick`, `quickTrigger`, `resetTrigger`) and §8.21.5 closed the packing for all
> three trigger opcodes from Ghidra assembly. The body below is kept as the
> record of the first pass; read §8.21.5 for the layout that is now in force.

`0x26 setTriggerConfig` is **paged**, which is why its length is computed rather
than fixed. From the builder at `0x1400ab700`:

```
[0]=0xFA [1]=0x26 [2]=order [3]=frame [4]=0x00
[5]=LEN = 2 + remaining          <- computed from the paging state
[6]=sender+0x260                 actuation point, low byte
[7]=sender+0x261                 actuation point, high byte
[8..]=run copied from sender+0x270
```

`LEN` is derived, not stored:

```c
r8 = sender[0x5B]                 // page stride
edx = sender[0x5A]; r8 = (edx-1) * stride;
if (sender[0x5A] < sender[0x59]) skip;   // not the final page
else r9 = sender[0x5C] - r8;
LEN = r9 + 2;
```

The wrapper at `0x1400b1280` supplies the first eight bytes as one blob:

```asm
movsd  xmm0, QWORD PTR [r9]
movsd  QWORD PTR [rcx+0x25e], xmm0     // sender+0x25E .. +0x265
movzx  eax,  WORD PTR [r9+8]
mov    WORD PTR [rcx+0x266], ax
```

so `sender+0x260` and `+0x261` are **bytes 2 and 3 of that 8-byte blob**, read
little-endian — i.e. the payload's first two bytes are a **u16 actuation
point**. That matches the UI range of 10-359.

**What is still unknown:** blob bytes 0-1 and 4-7, and what fills the array at
`sender+0x270` - see §8.9.1, which establishes that the copy out of it is
verbatim. Until those are named, a `0x26` write would have to
send zeros in the undecoded slots, and zeroing an actuation record is precisely
the failure that earlier cost a factory reset.

**Therefore `0x26`, `0x27` and `0x28` remain disabled.** The read path (`0x2C`)
works and is exposed.

## 10. Not yet established

Ordered by what most limits feature parity.

- ~~The `layer` values themselves.~~ **Resolved (§8.19).** Three sources had
  agreed the keymap is layer-qualified - the `layer` parameter in §8.16.1, the
  two `keyboard_fn*` tables in §8.12, and `params_table`'s `currentLayer` in
  §8.14 - without an encoding. `sender+0xC0` is that encoding: it is payload byte
  0 of `0x2A`, `0x20` and `0x24`, `0x20` accepts only 0 or 1, and it selects
  between two containers 8 bytes apart. What is *not* established is which of the
  two is the Fn layer the user thinks of as "fn" (§8.19.1).
- **`0x13` byte 4 (`functionFlag`).** Byte 3 is now named `fullColor` (§8.12.2)
  and byte 4 `functionFlag`. Both are named but neither is set by any UI path in
  the Windows app, so their legal value range is not established — the driver
  reads and rewrites them rather than choosing values.
- **The per-key group id** in `0x10 setCustomLight`. The per-key byte is
  resolved (§8.11.1) — it is a key index, not a colour. What is *not* resolved
  is `Entry+1`, the group id: the command applies to every entry sharing the
  selected key's group, so there is no single-key granularity to expose until
  the group ids are named. Blocker and the reason it is hard are in §8.11.2.
  This is now the largest remaining gap to feature parity.
- **The macro `type` byte.** The record is fully named in §8.12.1 — `type`,
  `state`, a 16-bit HID usage and a `time` delay — and the app now has a real
  keystroke editor. What is *not* established is what values `type` takes. The
  form exposes it as a numeric field defaulting to 1, and reading a slot adopts
  the value the device already holds, so an unknown `type` round-trips rather
  than being overwritten.
- **Record packing for the trigger family** `0x26`/`0x27`/`0x28`. Every field is
  named in §8.12.3 — `keyItem`, `trigger`, `model`, `quick`, `quickTrigger`,
  `resetTrigger` — and the board's own limits are in `product_table`
  (`triggerMin/Max`, `qttMin/Max`, `qrtMin/Max`). What is missing is how those
  differently-sized fields are packed across the paged payload, and where
  `quickTrigger`/`resetTrigger` sit relative to the 8-byte blob.

  **Narrowed by §8.9.1:** there is no permutation. The `0x26` body is a
  byte-for-byte `memcpy` out of the array at `sender+0x270`, so the packing is
  defined entirely by whatever fills that array - and `sender+0x261` is never
  stored individually, so the actuation-point `u16` arrives inside the 8-byte
  blob. The remaining question is one thing, with one known trap: `+0x270` also
  names a Qt widget pointer on a different class, and an offset match is not an
  identity. The read path (`0x2C`) works; writes stay disabled because mispacking
  an actuation slot is unrecoverable without a factory reset.
- **`0x56` setConfigInfo**, the 30-byte config blob. Suspected home of the
  transport-switch state that §8.4 says has no other opcode; not decoded. Note
  that decoding it would not be enough to expose it: writing the transport state
  could strand the board in a mode WebHID cannot reach, which is the same class
  of unrecoverable outcome as a bad lighting write (§12).
- **The value encodings** behind the `0x50`/`0x5E` settings. The blob's layout
  is solved (§8.14) and eight settings are writable, but nothing in the binary
  says which byte is 500 Hz or what the switch values mean. The UI shows raw
  numbers rather than inventing a mapping.
- **The `0x13` `functionFlag` value range** and the leading byte of `0x11`.
  Both are named positions with no named legal values (§8.12.2, §8.13.1).
- **Firmware chunking** for `0x60`/`0x65`/`0x66` and the `firmversion.xml`
  source. Deliberately not implemented.
- **The thirteenth effect name** (page 0 of `0x18`) — a 16-byte non-ASCII blob.
- **`0x20`'s prefix byte and record byte 0**, and all of `0x24`'s fields. The
  two are structurally different commands (§8.15), not two opcodes for one
  command, which resolves the §3.3 naming finding but leaves both unwritable.
- **BLE transport.** The frame layout is solved (§3.2) but never exercised —
  the board under test is wired USB.

## 10.1 What is solved

For contrast, these were open earlier in this work and are now closed:

| Item | Section |
|---|---|
| `0x13` brightness, byte 1, 0–100 raw | §6.3 |
| `0x13` speed, byte 2, 1–100 | §6.3 |
| `0x13` colour, bytes 5-7 = R,G,B | §6.3.1 |
| High-key record layout, all six modifier types, SOCD layout | §8.3.1-§8.3.4 |
| Macro record: 6 bytes, slot 0-9, bytes 0/1 transposed | §8.10 |
| Receive dispatch: 40 opcodes, all 40 slots used once each | §4.1 |
| `response = request + 0x80` exact on all 37 pairs | §4 |
| `0x90` *is* dispatched (earlier note said it was not) | §4.4 |
| All 39 request opcodes, re-derived from the app's log strings | §4.6 |
| Per-key byte in `0x10` is a key index, not a colour | §8.11.1 |
| Macro record: `type`, `state`, lValue/hValue = HID usage, `time` u16 | §8.12.1 |
| `0x13` byte 3 = `fullColor`, byte 4 = `functionFlag` | §8.12.2 |
| Trigger record field names | §8.12.3 |
| `0x50`/`0x5E` 20-byte blob: 8 named settings, two of them u16 | §8.14 |
| The app's own names for the five frame fields: order/frame/total/length/data | §8.16 |
| `0x2A` keymap carries a `layer`; `0x42` macro carries an `index` | §8.16.1 |
| Response-to-handler map: which class reacts to each response | §8.19 |
| Device snapshot: all ten tables read to JSON (both keymap layers, SyncConfigUtil's `0xFF` current-effect read) | §8.17 |
| Snapshot keeps raw bytes *and* a decoded view; decoders never throw | §8.17.1 |
| Keymap record is 4 bytes `keyItem,type,hValue,lValue`, confirmed both directions; `modifier`/`layer` names were wrong | §8.18 |
| Keymap wire order is **permuted** — `[type, lValue, hValue]`, not schema order; `hValue` carries the usage | §8.18.3 |
| `0x20` sends the first entry's `keyItem` once after LEN, then goes positional | §8.18.4 |
| `sender+0xC0` is the keymap layer, 0 or 1 only - the byte that gated `0x20` | §8.19 |
| `ImportConfigUtil` is a bulk whole-profile writer with no UI of its own | §8.17 |
| Feature-parity audit: 39 app functions, 24/11/4 | §12 |
| Trigger `0x26` bytes 0-1 = u16 actuation point, paged | §8.9 |
| Per-key colour `0x10` prefix = brightness, R, G, B | §8.11 |
| In-browser verification of the page and modules | §11.4 |
| `0x2A` keymap records: 3 bytes, third is a HID usage ID | §7 |
| `0x13` wire permutation `[0,2,3,4,1,5,6,7]` | §6.2 |
| All 39 send opcodes, classified read/write | §3, §4.6 |
| Header layout and paging model | §3.1, §3.5 |
| BLE frame variant | §3.2 |
| Receive dispatch table, 40 of 98 opcodes | §4.1 |
| Unsolicited `0xF1` push; handled-but-unsent `0xA1`, `0xD1` | §4.2, §4.3 |
| Sender object field map | §3.5 |
| Six advanced key modifiers | §8.3 |
| Transport and LED quick-mode functions | §8.4, §8.5 |

## 11. Method note

#### 8.9.1 The trigger body is a verbatim copy — there is no permutation

Two of the three records this project has decoded turned out to be *permuted* on
the wire: `0x13` sends `[0,2,3,4,1,5,6,7]`, and the keymap sends record bytes
`[1,3,2]` (§8.18.3). It was worth asking whether `0x26` does the same.

It does not. The whole body is a byte-for-byte `memcpy`:

```
0x1400ab7b9: mov    edx,0x8            ; destination = payload byte 8
0x1400ab7be: movzx  r8d,r8b            ; source index
0x1400ab7c2: movzx  r9d,r9b            ; remaining count
0x1400ab7d0: mov    rax,QWORD PTR [rbx+0x270]   ; source array
0x1400ab7db: movzx  eax,BYTE PTR [r8+rax*1]
0x1400ab7e0: mov    BYTE PTR [rdx+rcx*1],al
0x1400ab7e3: lea    rdx,[rdx+0x1]
0x1400ab7e7: lea    r8,[r8+0x1]
0x1400ab7eb: sub    r9,0x1
0x1400ab7ef: jne    0x1400ab7d0
```

No field extraction, no reordering, no branching on a type byte. Whatever is in
the array at `sender+0x270` reaches the device unchanged, so **the wire layout
of the trigger body is not a question this builder can answer** — the packing is
defined entirely by whatever fills that array.

That is a narrowing rather than an answer, and it is worth recording because it
removes a hypothesis. Two supporting observations:

- `sender+0x261` is **never stored to individually** anywhere in `.text`. The
  actuation-point `u16` is therefore written as part of a wider store, consistent
  with §8.9's finding that it arrives inside an 8-byte blob at `sender+0x25E`.
- The candidates that *look* like stores to `sender+0x270` are false leads.
  `sub_140038220` (and two near-identical siblings) store a **Qt widget pointer**
  to `+0x270`, followed by `QString` construction and `setText`-style calls at
  `0x1400d4f40` / `0x1400d51d8`. That object is a form, not the comm sender.
  **`+0x270` means different things on different classes**, and an offset match is
  not an identity.

**What remains unknown is one thing:** what fills `sender+0x270` on the comm
sender. The three callers of the builder (`0x14009cd46`, `0x14009dd12`,
`0x1400b137f`) are the paging loop — they set `sender+0x5A` / `+0x59` and call
straight into `0x1400ab700` without staging the array. So the staging happens in
a caller further up, behind the same Qt signal/slot wall that has blocked this
before.

### 8.10 Macro record `0x40` — decoded

`0x40 setMacroConfig` is paged and dispatches per macro slot.

```
[0]=0xFA [1]=0x40 [2]=order [3]=frame [4]=0x00 [5]=LEN
[6]=sender+0x108     the macro SLOT, 0..9   (M1..M10)
[7]=count of records in this page
[8..]=count records, 6 bytes each
```

**The slot is bounded 0-9 by the builder itself:**

```asm
movzx eax, BYTE PTR [rbx+0x108]
mov    BYTE PTR [rcx+0x6], al
cmp    eax, 0x9
ja     <default>                 ; slot > 9 takes the default path
lea    rcx, [rip-...]            ; rcx = image base
mov    eax, DWORD PTR [rcx+rax*4+0xaab14]   ; 10-entry dispatch table
add    rax, rcx
jmp    rax
```

Ten unrolled emitter blocks, one per slot, each 0xC3 bytes apart.

### 8.10.1 The record is 6 bytes, not 16

`sender+0x118` is walked with a **16-byte stride** (`shl r8, 0x4`), which suggests
16-byte records. It is not. The length field settles it:

```asm
movzx eax, r9b
add    al, al
lea    ecx, [rax+r9*1]      ; 3 * count
add    cl, cl               ; 6 * count
add    cl, 0x2              ; + 2 for the slot and count bytes
mov    BYTE PTR [rax+0x5], cl
```

`LEN = 6 * count + 2`. Each emitter block writes exactly six stores to
`frame[8]`..`frame[13]` and nothing further, so **the record is 6 bytes** and the
16-byte stride is the app's in-memory struct, not its wire format. Trusting the
stride would have produced records 10 bytes too long.

### 8.10.2 Bytes 0 and 1 are transposed

Every one of the ten emitter blocks, without exception, writes:

```
frame[8]  = record[1]
frame[9]  = record[0]
frame[10] = record[2]
frame[11] = record[3]
frame[12] = record[4]
frame[13] = record[5]
```

This is the third non-linear field order found in this protocol, after the `0x13`
permutation (§6.2) and MT's `0x252`/`0x251` swap (§8.3.4). It is a per-command
property, identical across all ten slots, so it must be applied on every macro
write.

`0x41 delMacroConfig` is simpler: `LEN = 1`, payload byte 0 is the slot.

The six bytes are the step model from the `key_macro_table` DDL (§8.12.1):
`type`, `state`, `lValue`, `hValue`, and a 16-bit `time`. Each record is one
keystroke/step; the page's record array is the sequence, not an opaque id. The
driver exposes those fields and still carries unknown type/state bytes through
verbatim: read with `0x42`, edit, write back with `0x40`.

### 8.10.3 `0x40` is paged — nine records per frame

The `0x40` initiator is `FUN_1400b0e20`. It sets:

```
+0x5B = (DAT_140194994 - 2) / 6 = (58 - 2) / 6 = 9   records per full page
+0x5A = 1                                            first page
+0x59 = ((count - 1) / 9) + 1                        last page
```

`DAT_140194994` is the 58-byte payload budget. The builder puts 9 records on
every non-last page and the remainder on the last:

```
count = (page == lastPage) ? totalRecords - (page - 1) * 9 : 9
LEN   = 6 * count + 2
```

The `0xC0` handler `FUN_14009c5c0` advances `page+1` and re-enters the builder
after each ack. `pageMacroPayloads()` implements the split and `setMacro()`
awaits each page. An empty record list takes the initiator's other branch, which
only emits a Qt completion signal and sends **no** `0x40` frame; the JS API
refuses it rather than inventing a zero-record frame.

### 8.11 Per-key colour `0x10` — prefix decoded

`0x10 setCustomLight` shares the effect config as a **4-byte prefix** and then
carries one byte per key:

```
[0]=0xFA [1]=0x10 [2]=order [3]=frame [4]=0x00
[5]=LEN = remaining + 4
[6]=sender+0x242   brightness      (the 0x13 uint64, byte 2)
[7]=sender+0x245   red             (byte 5)
[8]=sender+0x246   green           (byte 6)
[9]=sender+0x247   blue            (byte 7)
[10..]= per-key bytes, copied from sender+0x230
```

The prefix fields are the *same* struct slots the `0x13` handler fills, so the
app does not keep a separate copy of "the current colour" — it writes the same
four values either way. That is independent confirmation of the §6.3 field
mapping.

`sender+0x230` is filled by `sub_140034b00`, which walks the keyboard widget's
selection and resolves each key through the keymap at `*qword_140197068 + 0x20`
before emitting a byte.

### 8.11.1 What the per-key byte actually is — resolved

Earlier notes recorded a three-way contradiction about the per-key record *size*
and left the byte unnamed. The size contradiction is now explained: the three
sources were not measuring the same thing, because the byte is not a colour at
all.

The keymap at `*qword_140197068 + 0x20` is a
`QMap<uint8, shared_ptr<Entry>>`. Following every reference to it (23 sites, all
reads) and then following `Entry` to its uses gives `Entry`'s layout:

| Field | Used as | Evidence |
|---|---|---|
| `Entry+0` | **an index** into a per-key table at `*qword_140197068 + 0xb0` | `0x1400667af`: `movzx ecx, BYTE PTR [rdx]` where `rdx` is the entry; that byte is then the lookup key into `+0xb0`, and the found slot is written at `buf[+1]`, `buf[+2]`, `buf[+3]` — so it selects a *slot*, it is not stored *as* a value |
| `Entry+1` | a **group id** | `0x140034c75`: `movzx eax, BYTE PTR [r13+1]; cmp BYTE PTR [rcx+1], al; jne skip` — entries are selected by matching this byte |

`+0xb0` is itself `QMap<uint8, buffer*>`, and the app scatters a per-key record
into it by slot: `0x140066786` writes `record[1]` to `buf[1]`, `0x140066828`
writes `record[2]` to `buf[2]`, `0x1400668d7` writes `record[3]` to `buf[3]`.

So `sub_140034b00` emits `Entry+0` — **a key index** — once for every entry in
the selected key's group, and the four-byte prefix carries the colour. The
`0x10 setCustomLight` payload is therefore:

```
[brightness][R][G][B][keyIndex][keyIndex]...
```

which is why `0x10` emits **one byte per key** while `0x11 setCustomLightAll`
(a different command, "apply to all") has its own 5-byte record shape, and why
the stale 2-bytes-per-key capture is a *read* format from `0x16`, not a write
format. Read and write formats were never required to match.

### 8.11.2 Why the write still stays gated

The per-key byte is now named, so `0x10` is no longer un-understood in the way
earlier notes claimed. It is still not exposed, for a sharper reason:

**Selecting one key applies to its whole group.** `sub_140034b00` emits an index
for *every* entry whose `Entry+1` matches the selected key's `Entry+1`, not just
the key the user clicked. There is no way to address a single key with `0x10`;
the finest granularity the command offers is a group.

Whether that is acceptable is not a question this binary answers without the
population site for `Entry+1`, and that site is behind Qt's signal/slot layer:
the `0x96` handler (`sub_14001a4e0`) only marshals arguments and calls
`QMetaObject::activate(obj, 0x1400d5c70, 5, ...)`. The parse lives in the
`usb_receive_get_custom_light_all` slot, and this build was compiled with Qt's
`-reduce-relocations`, so the moc tables hold no absolute pointers — the class
name and every method-name string appear in the file **zero** times as absolute
pointers, which is why the slot could not be located by string xref. The 41
`usb_receive_*` names are present in the moc string-data blob in an order that
does **not** track signal indices past `0x50` (§4.6), so the blob is not a safe
substitute either.

Shipping a colour-per-group write with the group ids unnamed would mean
colouring a set of keys the user never selected. Per the audit rule in §11, that
stays documented-only.

### 8.12 The app's data model is in the binary, verbatim

`GameKeyboard.exe` ships a SQLite schema and persists its entire configuration
model through it — profiles, keymap, lighting, macros, triggers and device
parameters are all stored in a local `.db`. The `CREATE TABLE` and `INSERT`
statements are **plain ASCII strings in `.rdata`**, so the app's own column names
for every record it sends are recoverable without guessing.

The binding code then ties each column to a byte offset. For example, in the
macro insert, `:type` is bound from `byte [rax+0x0]`, `:state` from `[rax+0x1]`,
`:lValue` from `[rax+0x2]`, `:hValue` from `[rax+0x3]` and `:time` from
`movzx edx, WORD PTR [rax+0x4]` — a **16-bit** read, which is what makes the
record 6 bytes rather than 5 and independently confirms `LEN = 6*count + 2`.

The macro block repeats **exactly ten times** in that function, matching both the
ten macro slots and the ten-entry dispatch table at `0x1400aab14` found in §8.10.

| Table | Columns (excluding `id`) |
|---|---|
| `product_table` | serialNumber, vendorId, productId, interface, productName, productData, **triggerMin, triggerMax, qttMin, qttMax, qrtMin, qrtMax**, width, height, strCol, keyNumber |
| `device_table` | serialNumber, vendorId, productId, interface, version, manufacturer, productStr, path |
| `key_position_table` | keyNumber, keyItem, **posItem**, flag, row, col, left, top, width, height |
| `keyboard_default_table` | serialNumber, keyItem, type, hValue, lValue, label |
| `keyboard_default_fn1_table` | referenced by a `SELECT ... WHERE serialNumber = :serialNumber`; DDL not a `.rdata` literal |
| `custom_light_table` | keyItem, **light**, colorR, colorG, colorB |
| `keyboard_fn_table` | keyItem, type, hValue, lValue |
| `keyboard_fn1_table` | keyItem, type, hValue, lValue |
| `high_key_table` | item, attribute, data |
| `key_trigger_table` | keyItem, **trigger, model, quick, quickTrigger, resetTrigger** |
| `config_table` | configName |
| `params_table` | reserve, touchOptimize, deadDown, deadUp, pollingRate, shakeLevel, calibration, sportsMode, currentLayer |
| `effect_light_table` | item, functionFlag, light, speed, **fullColor**, colorR, colorG, colorB |
| `key_macro_table` | macroIndex, item, type, state, lValue, hValue, time |

`lValue`/`hValue` appear in three tables and are consistently the low and high
bytes of a **16-bit HID usage code** — the same value `keyboard_fn_table` binds
to a key. That is what lets a macro step name a key.

#### 8.12.1 Macro record — fully named

```
struct : [ type:u8 | state:u8 | lValue:u8 | hValue:u8 | time:u16le ]   6 bytes
wire   : [ state | type | lValue | hValue | timeLo | timeHi ]
```

`state` is 1 for key down, 0 for key up. `time` is a delay in milliseconds, up
to 65535. `macroIndex` is the slot and is sent separately in payload byte 0;
`item` is the step index within the macro and is not part of the record.

This closes the last gap in §8.10 and replaces the app's raw hex editor with a
real keystroke list: key picker, down/up, and a delay field per step.

#### 8.12.2 `0x13` bytes 3 and 4 — resolved

§6.3.2 recorded these two as firmware-owned and unnamed, on the evidence that all
three UI handlers pass them through untouched. They are named after all:
`effect_light_table` binds `item` from byte 0, `functionFlag` from byte 1, `light`
from byte 2, `speed` from byte 3, `fullColor` from byte 4 and RGB from 5-7.

Applying the §6.2 wire permutation `[0,2,3,4,1,5,6,7]` to that struct order
gives the wire bytes:

| Wire | Struct | Column | Status |
|---:|---:|---|---|
| 0 | 0 | `item` | effect index — already solved |
| 1 | 2 | `light` | brightness — already solved |
| 2 | 3 | `speed` | speed — already solved |
| **3** | 4 | **`fullColor`** | **was unnamed** |
| **4** | 1 | **`functionFlag`** | **was unnamed** |
| 5-7 | 5-7 | `colorR/G/B` | colour — already solved |

Every one of the three earlier findings is reproduced exactly, which is a strong
check that the column order really is the struct order and not merely a
plausible reading of it. `LIGHT_UNNAMED` is now empty: the driver rewrites all
eight bytes, none of them by guesswork.

`fullColor` is the useful one. It reads as a boolean — light the board with
`colorR/G/B` instead of the effect's own colours — which is the setting a user
expects to find behind "use a custom colour on this effect". The Windows app
never sets it from the colour path (§6.3.1), which is why it read as opaque.

#### 8.12.3 Trigger record — field names recovered

`key_trigger_table` binds `keyItem` from byte 0, `trigger` from a **16-bit** read
at byte 2, `model` from byte 4, `quick` from byte 5, `quickTrigger` from a
16-bit read at byte 6 and `resetTrigger` from a 16-bit read at byte 8.

This lands squarely on §8.9's open question. That section found the actuation
point as a u16 in payload bytes 0-1, and an 8-byte blob at `sender+0x25E` whose
bytes 0-1 and 4-7 were unnamed. With `trigger` at struct byte 2 read as a u16,
payload byte 0 is struct byte 2 — the two agree, and the blob's bytes 0-1 are
`keyItem` plus an unassigned byte, byte 4 is `model` and byte 5 is `quick`.
`quickTrigger` and `resetTrigger` sit past the 8-byte blob, so they live
elsewhere in the sender.

`triggerMin`/`triggerMax`/`qttMin`/`qttMax`/`qrtMin`/`qrtMax` in `product_table`
also explain the UI's 10-359 actuation range and give the board's own limits,
which no earlier phase had recovered.

Not yet acted on: the field order still mixes widths (u8, u8, u16, u8, u8, u16,
u16) across a record whose payload assembly is only partly recovered, so `0x26`
writes stay gated. But the names are no longer the unknown — only the packing.

### 8.13 What the schema predicts about record sizes

With the DDL in hand, the schema can be checked against the wire layouts already
recovered independently. It holds for three commands and fails for one, which is
worth recording either way.

| Command | Columns | Wire bytes/record | Relationship |
|---|---:|---:|---|
| `0x40` macro | 7 | **6** | `item` omitted — positional |
| `0x20`/`0x24` keymap | 4 | **3** | `keyItem` omitted — positional |
| `0x11` per-key colour | 5 | **4** + 1 head byte | `keyItem` sent once for the first entry (§8.13.2) |
| `0x14` effect-all | 8 | **8** | `item` **is** transmitted |
| `0x26` trigger | 6 | **10** | mixed widths — columns are not bytes |

Two conclusions, one of them negative.

**Confirmed.** For the macro record the schema independently reproduces the 6-byte
size found in §8.10 by a completely different route (`LEN = 6*count+2`), and the
positional-`item` reading is corroborated by the bind code itself, which binds
`:item` from the loop counter `esi` rather than from a record byte. The same
holds for the keymap: the builder emits exactly 3 bytes where the table has 4
columns.

**Not a law.** `0x14` transmits all 8 columns including `item`, so "the index
column is always positional" is wrong as a general rule. The commands that omit
it are the ones iterating a *fixed* list (every key, in order); `0x14` addresses
a *selected* set of effects, so it must send which one. Treat this as a shape
that recurs, not a formula.

And for the trigger record, column count and byte count diverge completely: the
bind reads `trigger`, `quickTrigger` and `resetTrigger` as 16-bit values, so six
columns occupy ten bytes. Any inference from column count alone would have been
wrong there.

#### 8.13.1 `0x11` setCustomLightAll — exact payload shape

The builder at `0x1400a66e7` gives the layout outright:

```
LEN  = 4 * count + 1              ; shl cl,0x2 ; inc cl
[6]  = the FIRST entry's byte 0   ; written once, guarded by `test edi,edi`
[7 + 4*i] = entry i byte 1        ; r14 starts at 7 and advances by 4
[8 + 4*i] = entry i byte 2
[9 + 4*i] = entry i byte 3
[10 + 4*i] = entry i byte 4
```

The source is `QMap<uint8, shared_ptr<Rec>>` at `sender+0xa0`, iterated through
its red-black tree, so entries arrive in ascending key order. `Rec` is five
bytes. Because the QMap is ordered and the command is "all keys", the key index
is implied by position and only the four colour columns travel — which is exactly
why `custom_light_table` has five columns and the wire carries four.

So `0x11` is a **columnar** write: one leading byte plus a colour quad per key,
not a list of five-byte records. That is a materially better description than the
earlier "per-record layout not established", and it is consistent with the 5-byte
figure §8.11 recorded without being able to explain it.

**This section previously said the leading byte was unknown.** It is not. See
8.13.2 — the short version is that it is the first entry's `keyItem`, and the
reasoning that called it a global flag was backwards.

#### 8.13.2 The leading byte is the first keyItem, not a flag

The instruction sequence that writes payload byte 0 is the *same* one `0x20`
uses, register allocation aside:

```
0x11                              0x20
0x1400a67c9: test   edi,edi        0x1400a88b9: test   esi,esi
0x1400a67cb: jne    0x1400a67db    0x1400a88bb: jne    0x1400a88cb
0x1400a67cd: mov    rax,[rbx+0x28] 0x1400a88bd: mov    rax,[rdi+0x28]
0x1400a67d5: movzx  eax,BYTE [rax] 0x1400a88c5: movzx  eax,BYTE [rax]
0x1400a67d8: mov    BYTE [rcx+6],al 0x1400a88c8: mov   BYTE [rcx+7],al
```

Both load the node's record pointer at `+0x28`, take **byte 0 of the record**, and
write it once, guarded by the loop counter. The loop then emits the rest:

```
0x1400a67e3: movzx eax, BYTE PTR [rax+0x1]   ; light
0x1400a67f3: movzx eax, BYTE PTR [rax+0x2]   ; colorR
0x1400a6804: movzx eax, BYTE PTR [rax+0x3]   ; colorG
0x1400a6815: movzx eax, BYTE PTR [rax+0x4]   ; colorB
0x1400a681e: add   r14,0x4
```

`custom_light_table` is `(keyItem, light, colorR, colorG, colorB)`. Bytes 1-4 are
therefore `light, R, G, B`, and **byte 0 is `keyItem`**.

#### 8.13.3 What the earlier reasoning got wrong

8.13.1 concluded the byte was "a global flag rather than a per-key value" because
"the schema does not name it: `keyItem`, which is already accounted for
positionally." Both halves are backwards:

- `keyItem` *is* the byte. Bytes 1-4 account for `light, R, G, B`; nothing else
  in the table is left for byte 0.
- Being positional does not mean a field is dropped. `0x20` was already recorded
  (§8.18.4) as sending its first entry's `keyItem` once, with only the later
  entries positional. The same construct appears here, and the two were never
  compared.

The conclusion this produced - "gated on an unnamed byte" - was wrong. The gate
has moved from *not understood* to *understood but never run*, which is a weaker
claim but a different one, and is stated as such in §12.

#### 8.13.4 `0x11` is paged — 14 records per frame

A full APEX200 table is 85 keys, so the payload is `4*85 + 1 = 341` bytes. That
cannot go in one report: the frame budget is 58 payload bytes, and `buildFrame`
refuses anything larger. The Windows app does not attempt it either. Its builder
`FUN_1400a66d0` computes each frame from four sender fields:

```
startIndex = sender+0x5a      ; frame offset 2 (param1), 1-based page number
endIndex   = sender+0x59      ; frame offset 3 (param2), last page number
pageSize   = sender+0x5b
recordCount= sender+0x5c

startOffset = (startIndex - 1) * pageSize
count       = (endIndex <= startIndex) ? recordCount - startOffset : pageSize
LEN         = 4*count + 1
```

and emits the records at `startOffset .. startOffset+count-1`, with the first
emitted record's `keyItem` in payload byte 0. The final page is therefore the one
where `startIndex == endIndex`; its `count` is the remainder. The device sees the
page number and the last-page number in the frame header, which is what lets it
acknowledge a multi-frame write.

`pageSize` is what bounds a page, and the frame budget bounds *it*:
`4*14 + 1 = 57` fits, `4*15 + 1 = 61` does not, so **14 records** is the maximum
whole page. The driver uses 14 and passes `1..N` / `N` as `param1`/`param2`,
matching the builder's own arithmetic. It writes all pages, then reads the table
back and compares every key, so a wrong page boundary fails loudly instead of
leaving half the board recoloured.

This also corrects the §5 summary row: the leading byte is **the page's first
`keyItem`**, not a record count.

### 8.14 Whole-parameter blob `0x50` / `0x5E` — solved

`params_table` names nine global settings, and the read path binds each column
with a distinct width, so the struct is fully determined:

```
+0x00 reserve        u8     +0x06 pollingRate   u8    +0x09 sportsMode    u8
+0x01 touchOptimize  u8     +0x07 shakeLevel    u8    +0x0A currentLayer  u8
+0x02 deadDown       u16 LE +0x08 calibration   u8
+0x04 deadUp         u16 LE
```

Two of the nine are 16-bit, which is what makes the struct 11 bytes rather than
nine, and is exactly the trap §8.13 warned about — column counts do not predict
byte counts.

`0x50 setWholeParam` at `0x1400ac499` then writes it as a 20-byte payload:

```
LEN  = 0x14 (20)
[0]      = 0xFF                 <- the reserve byte, hardcoded
[1..10]  = params[1..10]        <- note: params[0] is skipped
[11..19] = 0xFF x 9             <- padding, hardcoded
```

So the `reserve` column is never transmitted from its stored value: the app
writes a constant `0xFF` in its place, and pads the tail the same way. That is
consistent with the name.

`0x5E getWholeParam` is a bare request — `LEN = 0`, no payload at all. Its slot
wrapper `FUN_1400af870` sets `sender+0x59/+0x5A = 0x0101` and nothing else.

The set slot behind the form is `FUN_1400b14a0`: it sets the same `0x0101`
pair, then copies the caller's **11-byte struct** into the sender buffer at
`+0x90` byte for byte — `buf[0..1]`, a `u16` at `buf[2..3]`, a `u16` at
`buf[4..5]`, and bytes `buf[6..10]` — and calls the builder. The builder skips
`buf[0]` (the reserve) and hardcodes `0xFF` in its place. The form's slider
handler confirms the binding in the other direction: `FUN_14004a5c0` stores the
slider value as a `short` at `form+0x40`, which lands exactly in that second
`u16` field, then fires `FUN_14004f450`, which copies the form's `+0x3E` window
into the send buffer. Import replays through the same slot: the ImportConfigUtil
chain stages `params_table` at `+0x68` and calls `FUN_1400b14a0` with it
(§8.22, slot 3).

**What this buys.** Eight named, host-settable settings the WebHID app can now
expose: touch optimise, dead-key down and up, polling rate, shake level,
calibration, sports mode, current layer. `0x50` rewrites the whole blob, so the
driver reads `0x5E` first and carries the other seven bytes forward — the same
read-modify-write discipline the `0x13` effect path uses. Every write is read
back and reported.

**Readback caveat.** The device's `0x5E` answer never appeared in the live
captures (§7 pre-dates the whole-param work), so whether its payload is the
full 20-byte wire shape or a shorter field is not hardware-proven. The binary
gives one supporting hint and one limit. The hint: the receive side treats it
as the same space the form edits, and the import writes the identical struct
straight to `0x50`. The limit: if a firmware ever answers `0x5E` with **fewer
than 20 bytes**, `parseWholeParams` aborts with `RangeError` and the driver
sends nothing — a partial blob cannot be padded without guessing, and an
11-byte readback sent as the 20-byte wire would corrupt the tail. The app
would not hit this because its form buffer comes from its own synced state;
this driver only ever builds `0x50` from the device's own readback.

**What is deliberately not claimed.** The *encodings* are still unknown. Which
byte value means 500 Hz, and what `0` and `1` mean for the three switches, is not
in the binary — only which byte is called what. The UI therefore shows raw device
numbers rather than inventing a Hz list or on/off checkboxes. A decoded control
that guessed the mapping would be worse than a raw one that doesn't.

### 8.15 `0x20` and `0x24` are not the same command

§3.3 recorded these as "two distinct functions that the app logs under the same
name" and left open which one the app actually sends. Comparing the two builders
instruction by instruction shows the question was framed wrong: **they are not
variants of one command.**

| | `0x20` | `0x24` |
|---|---|---|
| builder | `0x1400a87a0` | `0x1400a9110` |
| `LEN` | `3*count + 2` | `count + 1` |
| prefix byte `[6]` | `sender+0xC0` = layer (§8.19) | `sender+0xC0` = layer |
| source | `QMap` at `sender+0xC8` (layer 0) / `sender+0xD0` (layer 1), walked with `QMap::begin` | caller-built byte buffer at `sender+0xD8` (data `+0xE0`, size `+0xE8`) |
| bytes per entry | **3**, permuted `rec[1], rec[3], rec[2]` = `type, lValue, hValue` (§8.18.3) | **1**, unpermuted - but it is a *list*, not a per-key column |

`LEN` for `0x20` is worth spelling out, because it is easy to misread:

```
movzx eax, r12b          ; eax = count
add   al, al             ; 2 * count
lea   ecx, [r12 + 2]     ; count + 2
add   cl, al             ; 3 * count + 2
mov   [buffer+5], cl     ; LEN
```

Both share the same leading byte, `sender+0xC0`. After that `0x20` sends the
first entry's `keyItem` once and then three bytes per key; `0x24` sends a
caller-built byte list with no positional column at all. That is a difference in
kind, not in opcode.

Against the schema, `keyboard_fn_table` and `keyboard_fn1_table` have identical
shapes - `keyItem, type, hValue, lValue` - four columns each. `0x20` is shaped
like one of those records plus a leading layer byte. `0x24` writes something the
schema does not describe: §8.21.4 shows every producer builds a **two-byte**
list (`[keyItem, 0xFF]`, `[0xFF, 0xFF]`, or a high-key's two partner keys), so
reading it as "one flag byte per key" was wrong.

**Both are sent; neither is a duplicate of the other.** The shared log string is
the app's own misnomer, and the pairing of opcode to database table is not
one-to-one.

Neither is exposed. `0x20` now has every byte named (layer at `[6]`, `type` /
`lValue` / `hValue` in each record), but a whole-layer rewrite has never been run
against hardware and the only recovery from a scrambled layer is a factory reset
(§8.19.3). `0x24` is fully decoded at the frame level (§8.21.4); what is still
unproven is what the device does with `0xFF` in each list position, so it stays
gated too.

### 8.16 The app's own names for the frame fields

Each Qt class that receives frames carries a moc string-data blob listing its
signals and their **parameter names**. The communication class's blob at
`0x1400d8201` begins:

```
usb_receive_error        error, source
usb_receive_set_custom_light  order, frame, total, length, uchar* data
usb_receive_set_custom_light_all
usb_receive_set_effect_light
...
```

So the app itself names the five frame fields **`order`, `frame`, `total`,
`length`, `data`** — and nothing else. In particular there is no `retry` field in
the receive path at all, which is worth stating because the *send* builders do
write one (§3.1).

This independently corroborates §4.5 from the other direction. That section
showed the receive log reads

```
"source:{...} ;order:{buf[1]} ;frame:{buf[2]} ;total:{buf[3]} ;length:{buf[5]}"
```

and concluded the labels are shifted by one, because `buf[1]` is the opcode. The
moc parameter names agree with that reading: the app really does think of these
five fields as order/frame/total/length/data, and really is filling them from
the wrong buffer indices. The framing is unaffected; only the log is misleading.

#### 8.16.1 SyncConfigUtil's slots, and the `layer` parameter

`SyncConfigUtil`'s blob at `0x1400da24c` lists ten receive slots, with
parameters where they exist:

```
sync_config_result            status, value
usb_communicate_error         source, order, error
usb_receive_product_info      current, total
usb_receive_config_info
usb_receive_whole_param
usb_receive_custom_light
usb_receive_set_effect_light_language
usb_receive_effect_light
usb_receive_keyboard_config   layer
usb_receive_high_key
usb_receive_macro_config      index
usb_receive_trigger_config
```

Two things fall out that no earlier phase had:

- **`0x2A getKeyboardConfig` carries a `layer` parameter.** The keymap read is
  layer-qualified - the board has more than one function layer, which lines up
  with the existence of `keyboard_fn_table` *and* `keyboard_fn1_table` (§8.12)
  and with `params_table`'s `currentLayer` field (§8.14). Three independent
  sources now agree there is a layer concept; none of them had been connected
  before.
- **`0x42 getMacroConfig` carries an `index` parameter**, matching the per-slot
  dispatch found in §8.10.

`usb_receive_custom_light` is confirmed as a **slot of `SyncConfigUtil`**, not of
`LightSetForm` - so the per-key colour readback is parsed by the sync/import
utility, which is why its population site is not in the lighting form.

#### 8.16.2 A negative result worth keeping

It seemed likely that Qt's `-reduce-relocations` had rewritten the moc pointers
into 32-bit offsets, which would have made the slot implementations reachable by
walking the method table. **That is not how this build stores them.** Searching
`.rdata` for any base B such that a 32-bit value at some position equals
`target - B` for the 138 known class and method strings turns up at most 1 hit
for the best-scoring candidate base, with several bases tied on a meaningless
score - the apparent 40 hits came from a voting loop that computed B from each
position and was therefore self-confirming. Trying the two real candidates
directly (offsets from the metaobject at `0x1400d5c70` and from its
`QMetaObjectData` at `0x1400b530`) gives zero hits each.

So these names are not reachable by pointer arithmetic from the metaobject. The
per-slot implementations stay behind the signal/slot layer, and the gates in
§8.13.1 and §8.15 stand.

### 8.17 Snapshot and backup (the WebHID counterpart to SyncConfigUtil)

`SyncConfigUtil` collects ten table **types** before the app pushes a
configuration back (§8.19). The WebHID app now does the same as an explicit
**Device snapshot**: one button reads them and offers them as JSON, with every
payload kept as a byte array so nothing is lost to formatting.

Three details follow the sync sequence exactly rather than a convenient
default:

- **Both keymap layers.** Sync reads `0x2A` layer 0 (`FUN_1400b5650`) and then
  layer 1 (`FUN_1400b5850`) before the high-key read, so the snapshot carries
  `keyboardConfig` (layer 0) and `keyboardConfig1` (layer 1) as separate
  sections - eleven reads for the ten table types.
- **The current effect, not effect 0.** Sync's `0x17` initiator is called with
  `0xFF` (`FUN_1400b5b80` -> `FUN_1400af540`), asking the board for the active
  effect's config; the snapshot records whatever effect the reply names.
- **The `0x18` name set** starts at page 1 with the English/default selector
  (§8.23.2); page 0's undecoded blob is not part of the vendor read.

All of the calls are reads. Nothing in the feature can write, which is the
point - the only recovery from a bad write on this board is a factory reset,
and this is the only record of the current state that can be made from the
host. It also adds a decoder the project did not have: `parseCustomLight`,
five bytes per key from `custom_light_table` (§8.12), which finally makes the
`0x16` readback readable.

#### 8.17.1 The snapshot keeps both views

The JSON carries two parallel sections, and this is deliberate:

- **`data`** - each payload as a byte array. Faithful, lossy-free, and the thing
  to trust if a decoder is ever wrong.
- **`decoded`** - this project's reading of those bytes, for the eight decoded
  sections (the keymap is one section per layer).

Keeping both rather than choosing matters. A backup that could only be read back
through the same decoder that produced it would be no backup at all - a decoder
bug would be invisible and unrecoverable. With both present, a disagreement
between them is *visible*, which is exactly the signal that something is wrong.

`decodeSnapshotSection` returns `null` for any table without a decoder, for a
failed read, and for malformed input. It never throws: a decoder must not be able
to fail a snapshot, because the raw bytes are the backup and a crash would
destroy them.

`decodeHighKeyRecords` was added for this and is worth a note. The `0x2B`
**readback** is not made of the variable-length `0x22` records: it is a sequence
of fixed 19-byte slots (§8.3.5). `FUN_140098b90` divides the payload length by 19
and advances with stride `0x13`. A page whose length is not a multiple of 19
produces a one-entry report carrying the reason, and an unknown type is marked
undecoded rather than being skipped or guessed at.

Note the asymmetry this makes explicit: the `0x16` **read** is 5 bytes per key
(`keyItem, light, R, G, B`) while the `0x11` **write** is columnar and
positional (§8.13.1). Read and write formats were never required to match, and
here they demonstrably do not.

### 8.18 The keymap record, named from assembly

The app's per-layer keymap is a four-byte record. This is now confirmed in
**both** directions from `procedure_assembly`, not inferred from the DDL text.

**Read - `sub_14008d7d0`** (`SELECT * FROM keyboard_fn_table`). Four consecutive
`QSqlQuery::value(int)` / `QVariant::toInt` pairs, each result stored one byte
into the record:

```
0x14008d8ea: call value@QSqlQuery(int)   ; r8d = 0
0x14008d8fc: mov  byte [r12],   al       ; -> keyItem
0x14008d918: call value@QSqlQuery(int)   ; r8d = 1
0x14008d92a: mov  byte [r12+1], al       ; -> type
0x14008d947: call value@QSqlQuery(int)   ; r8d = 2
0x14008d959: mov  byte [r12+2], al       ; -> hValue
0x14008d976: call value@QSqlQuery(int)   ; r8d = 3
0x14008d988: mov  byte [r12+3], al       ; -> lValue
```

**Write - `sub_140087bd0`** (`INSERT INTO keyboard_fn_table`). Each record byte is
loaded and bound to a *named* column symbol:

| load | column symbol | address |
|---:|---|---|
| `movzx edx, byte [rax]` | `aKeyitem` | `0x1400ed088` |
| `movzx edx, byte [rax+1]` | `aType` | `0x1400ed090` |
| `movzx edx, byte [rax+2]` | `aHvalue` | `0x1400ed098` |
| `movzx edx, byte [rax+3]` | `aLvalue` | `0x1400ed0a0` |

The column names are string symbols in the binary, so the record layout is read
directly, not guessed from the `CREATE TABLE` text.

#### 8.18.1 The two layer functions are the same function

`sub_1400b43d0` reads `keyboard_fn1_table`. An LCS diff of the two canonicalised
bodies gives **250 of 253 instructions identical**, and all eight differences are
the container pointer - not logic:

| | `sub_14008d7d0` | `sub_1400b43d0` |
|---|---|---|
| container | `lea r15, qword [rcx+0x88]` | `qword_140197068` + `add 0xb0` |
| clears | `mov rcx, r15` | `mov r15, qword [qword_140197068]` |

So the app treats the layers with one body and two table names. There is no
per-layer special-casing anywhere in the read path.

#### 8.18.2 Corrections this forced

`parseKeymap()` previously named the three wire bytes `modifier`, `layer` and
`usage`. **Two of those three names were wrong:**

- **`modifier`** - there is no modifier field. The column is `type`.
- **`layer`** - there is no per-record layer at all. The layer qualifies the
  *whole read* (8.16.1); a byte that looked like a layer index was not one.
- **`usage`** - this one is real, but it is `lValue`, and it is the third column
  of the record, not an unnamed "usage".

`parseKeymap` now exposes `type`, `hValue`, `lValue` and `keyItem`, and the
wrong names are gone rather than kept as aliases.

#### 8.18.3 The hValue discrepancy, and what actually resolved it

This section previously recorded an open contradiction. It is now resolved, and
the resolution is worth writing down because the cause was a wrong assumption
rather than missing information.

§8.12 concludes from `key_macro_table` that `hValue`/`lValue` are the high and low
bytes of a 16-bit HID usage. The keymap captures show byte 1 constant `0x01` and
byte 2 carrying the HID usage. Taking the wire to be *schema order with keyItem
dropped* gives `[type, hValue, lValue]`, so `hValue` would be `0x01` and
`lValue` the usage - and read as a 16-bit usage that is `0x01xx`, which is not a
HID usage for any key, since keyboard usage codes start at `0x04`.

**The assumption was wrong: the wire is not schema order.** §8.15 had already
recorded that `0x20` emits three bytes per entry *permuted*. Checking that
against the builder rather than against the DDL resolves it:

```
0x1400a88cb: mov  rax, qword [rdi+0x28]      ; the entry's 4-byte record
0x1400a88d3: movzx eax, byte [rax+1]
0x1400a88d7: mov  byte [r14+rcx],    al     ; wire byte 0 = rec[1] = type
0x1400a88e3: movzx eax, byte [rax+3]
0x1400a88e7: mov  byte [r14+rcx+1],  al     ; wire byte 1 = rec[3] = lValue
0x1400a88f4: movzx eax, byte [rax+2]
0x1400a88f8: mov  byte [r14+rcx+2],  al     ; wire byte 2 = rec[2] = hValue
0x1400a88fd: add  r14, 0x3                   ; stride 3
```

So the wire takes record bytes `rec[1], rec[3], rec[2]` - the permutation
is `[1, 3, 2]`, exported as `KEYMAP_WIRE_PERMUTATION` and checked against this
section by the test suite. The true wire order is **`[type, lValue, hValue]`**, and `hValue` is the byte
that carries the usage. `lValue` is the one that reads a constant `0x01`. The
`0x01xx` nonsense came from pairing the right constant with the wrong column.

Two consequences, both now in `parseKeymap`:

- The two bytes were swapped in the parser. The usage decode was unaffected -
  byte 2 is the usage either way - but the names were wrong, which is the kind of
  error that produces a confidently wrong answer later.
- §8.18's record order and the macro record's are *opposite*. The macro puts
  `lValue` before `hValue` (8.12.1) and sends schema order; the keymap sends them
  the other way round. Two tables, two conventions, both verified separately.

#### 8.18.4 keyItem is sent once, not omitted outright

§8.13 recorded `keyItem` as "omitted - positional" for `0x20`. The builder shows
that is only *mostly* true. Before the loop:

```
0x1400a88bd: mov  rax, qword [rdi+0x28]      ; first entry's record
0x1400a88c5: movzx eax, byte [rax]
0x1400a88c8: mov  byte [rcx+7], al           ; buf[7] on USB, buf[8] on BLE
```

so the **first** entry's `keyItem` is sent once, immediately after `LEN` and the
`sender+0xC0` byte, and only the remaining entries rely on position. Frame layout
for `0x20`:

| offset | content |
|---:|---|
| 0-4 | `FA`, opcode, order, frame, total |
| 5 | `LEN` = `3*count + 2` |
| 6 | **keymap layer**, 0 or 1 (§8.19) |
| 7 | **first entry's `keyItem`** |
| 8.. | `type`, `lValue`, `hValue` per entry |

`LEN` counts the two header bytes plus the body - the layer and the once-sent
`keyItem` - which is why it is `3*count + 2` and not `3*count + 3`.

`sender+0xC0` was unnamed when this was written; it is now named as the keymap
layer in §8.19.

#### 8.18.5 Four keymap tables, not two

Found while tracing the hValue question: there are **four** keymap tables, not
the two recorded until now.

| table | role |
|---|---|
| `keyboard_default_table` | stock keymap, `serialNumber`-qualified, with a `label` column |
| `keyboard_default_fn1_table` | stock keymap for the second layer |
| `keyboard_fn_table` | the user's current layer 0 keymap |
| `keyboard_fn1_table` | the user's current layer 1 keymap |

The two `*_fn*_table` readers (`sub_14008d7d0`, `sub_1400b43d0`) are byte-for-byte
the same body (8.18.1), so the current-layer tables are handled identically and
differ only in name. The stock tables are `serialNumber`-qualified, which is what
a factory keymap has to be - a board's defaults are not the same across models.

**This corrects a claim in 8.18.5.** That section said the stock defaults are not
available, and said so as a reason the keymap UI has to take a reference by hand.
The stock defaults are *not in the wire protocol* - the device does not serve them
and no opcode retrieves them - but the Windows app ships them in its own database,
so it can always say what a key was supposed to be. A WebHID host has no access
to that database, which is why the reference-diff UI is still the right answer for
this app; the correction is to the claim's scope, not to the design.

Only `keyboard_default_table` has its `CREATE TABLE` as a `.rdata` literal
(`0x1400ed950`). `keyboard_default_fn1_table` is reached only through a `SELECT`
at `0x1400ed040`, so its column list is not independently verified here and is
deliberately not asserted above.

#### 8.18.6 A bug this uncovered

`renderKeymap()` marked a key "changed" when `usage !== index`. A HID usage code
and a record position are different quantities - record 0 on a factory-fresh
board holds Escape, usage `0x29` - so that test would have flagged nearly every
key on an unmodified board.

There is no correct way to answer "is this key remapped" from a single read: the
record carries no changed flag, and the stock defaults are not in the protocol.
The UI now compares against a **reference** the user takes explicitly (read, set
reference, change something, read again) and says plainly that it cannot tell
without one.

### 8.19 `sender+0xC0` is the keymap layer

This is the byte that §8.13.1 and §8.15 both recorded as unnamed, and the single
item gating `0x20`. It is the **keymap layer**, with exactly two legal values.

All three keymap-family commands put it at payload byte 0:

| opcode | builder | reads | validates |
|---|---|---|---|
| `0x2A` get keymap | `0x1400a3398` | `[rsi+0xc0]` -> `buf[6]` | no |
| `0x20` set keymap | `0x1400a8844` | `[rbx+0xc0]` -> `buf[6]` | **yes, 0 or 1 only** |
| `0x24` set keymap (flat) | `0x1400a91ac` | `[rbx+0xc0]` -> `buf[6]` | no |

The `0x20` builder is where the semantics are visible, because it *acts* on the
value instead of just forwarding it:

```
0x1400a8844: movzx eax, BYTE PTR [rbx+0xc0]
0x1400a884b: mov    BYTE PTR [rcx+6], al      ; payload byte 0
0x1400a884e: movzx eax, BYTE PTR [rbx+0xc0]
0x1400a8855: test   al, al
0x1400a8857: jne    0x1400a8969
0x1400a885d: lea    r15, [rbx+0xc8]           ; layer 0 -> first container
...
0x1400a8969: cmp    al, 0x1
0x1400a896b: jne    0x1400a8a74               ; >= 2 -> body left empty
0x1400a8971: lea    r15, [rbx+0xd0]           ; layer 1 -> second container
```

A layer above 1 is not a third layer. It falls through to `0x1400a8a74`, which
builds the `QByteArray` and calls the same send routine as the success path - so
the frame still goes out, carrying only the header and no records.

#### 8.19.1 What is established, and what is only corroborated

**From assembly:** the wire position, the 0-or-1 validation, and the fact that the
value selects between two containers 8 bytes apart.

**Not proven:** that `+0xc8` is specifically `keyboard_fn_table`. Those two
containers are members of a block of sixteen 8-byte-spaced containers cleared
together by `sub_14008ae60` (`+0x78` through `+0xf0`, each `sub_14002f1e0`), so
they are adjacent members of a larger table, not a dedicated pair.

**Corroboration:** exactly two identically-shaped keymap tables exist -
`keyboard_fn_table` and `keyboard_fn1_table` (8.18.1) - and `keyboard_fn_table`
and `keyboard_fn1_table` are precisely the two the app reads (8.18.1). A two-valued
selector matching a two-table structure is strong, and it is recorded as a naming
with stated evidence rather than as a proven identity.

#### 8.19.2 The `0x20` payload, fully named

Every byte the write touches now has a name:

| offset | content |
|---:|---|
| 0 | layer (`sender+0xC0`), 0 or 1 |
| 1 | first entry's `keyItem`, sent once |
| 2.. | `type`, `lValue`, `hValue` per entry (8.18.3) |
| LEN | `3*count + 2` |

The LEN formula and the payload length agree independently: two header bytes plus
three per key is exactly `3*count + 2`, which is the same value the builder
computes with `add al,al` / `add cl,al` at `0x1400a8830`-`37`. A test asserts they
match for 1, 2, 10 and 85 keys.

`buildKeymapPayload()` encodes this and **refuses** a layer outside 0..1 rather
than clamping it - clamping would send a valid-looking frame that edits the wrong
layer, which is worse than sending nothing.

#### 8.19.3 What this does and does not unblock

`0x24` stays gated. Its prefix byte is now named, but the single byte it sends
per key - read from the flat array at `sender+0xe0` - is still unnamed, so
exposing it would mean writing a byte whose meaning is unknown.

`0x20` has every byte named. That satisfies the naming rule, but **it is still not
exposed**, and the reason has changed: it is no longer "a byte is unnamed" but
"a whole-layer rewrite has never been exercised against hardware". That is a
weaker claim, and it is the one that should govern the decision, because the
failure mode is a scrambled keymap layer and the only recovery is a factory
reset.

### 8.20 Which class handles each response

The app logs `"=== <Class> usb_receive_<slot> ..."` inside each receive slot.
Pairing those 35 strings with the signal table gives the complete
response-to-handler map: which UI surface reacts to each device response.

That matters beyond bookkeeping. It is why `usb_receive_custom_light` never
appeared in `LightSetForm` despite being a lighting command - it belongs to
`SyncConfigUtil`, the configuration-import utility, which is also why its
population site was not findable in the lighting code.

| Resp | signal index | signal name | handling slot(s) |
|---:|---:|---|---|
| `0x90` | 1 | `set_custom_light` | `LightSetForm` |
| `0x91` | 2 | `set_custom_light_all` | `ImportConfigUtil` |
| `0x93` | 3 | `set_effect_light` | `LightSetForm` |
| `0x94` | 4 | `set_effect_light_all` | `ImportConfigUtil` |
| `0x96` | 5 | `get_custom_light_all` | `SyncConfigUtil` |
| `0x97` | 6 | `get_effect_light` | - |
| `0x99` | 7 | `select_effect_light` | `LightSetForm` |
| `0x98` | 8 | `get_effect_light_name` | - |
| `0xA0` | 9 | `set_key` | - |
| `0xA1` | 10 | `set_key_function` | - |
| `0xA2` | 11 | `set_high_key` | `ImportConfigUtil` |
| `0xA3` | 12 | `set_high_key_more` | - |
| `0xA4` | 13 | `set_key_default` | - |
| `0xA5` | 14 | `del_high_key` | - |
| `0xA6` | 15 | `set_trigger` | - |
| `0xA7` | 16 | `set_quick_trigger` | - |
| `0xA8` | 17 | `set_trigger_all` | - |
| `0xAA` | 18 | `get_key_config` | `SyncConfigUtil` |
| `0xAB` | 19 | `get_high_key_config` | - |
| `0xAC` | 20 | `get_trigger_config` | - |
| `0xC0` | 21 | `set_macro` | - |
| `0xC1` | 22 | `del_macro` | - |
| `0xC2` | 23 | `get_macro_all` | `SyncConfigUtil` |
| `0xD0` | 24 | `set_whole_config` | - |
| `0xD1` | 25 | `start_calibration` | - |
| `0xD2` | 26 | `start_calibration_config` | - |
| `0xD3` | 27 | `open_calibration_time` | - |
| `0xD4` | 28 | `save_calibration` | `AlignSetForm` |
| `0xD5` | 29 | `get_calibration_adc` | - |
| `0xD6` | 30 | `set_current_config_table` | - |
| `0xD7` | 31 | `set_config_table_info` | - |
| `0xD8` | 32 | `get_config_table` | - |
| `0xD9` | 33 | `add_config_table` | `MainWindow` |
| `0xDB` | 34 | `del_configure_table` | - |
| `0xDE` | 35 | `get_whole_config` | `SyncConfigUtil` |
| `0xE0` | 36 | `fireware_download` | `OtherSetForm` |
| `0xE1` | 37 | `reset` | `OtherSetForm` |
| `0xE2` | 38 | `get_product_info` | - |
| `0xE3` | 39 | `fireware_download_end` | `OtherSetForm` |
| `0xF1` | 40 | `config_change` | `MainWindow` |

Two patterns are visible:

- **`ImportConfigUtil` handles every *write* acknowledgement** it recognises -
  `set_custom_light_all`, `set_effect_light_all`, `set_high_key`,
  `set_keyboard_config`, `set_macro_config`, `set_trigger_config_all`,
  `set_whole_param`. It is a bulk-configuration writer: one utility that pushes a
  whole profile to the device. That is the single most important hidden
  function in the app, and it has no UI of its own - it is driven by the profile
  import path.
- **The forms handle their own domain.** `LightSetForm` for lighting,
  `MacroSetForm` for macros, `AlignSetForm` for calibration, `KeySetForm` for the
  keymap, `HighKeyForm` for Fn-layer bindings, `OtherSetForm` for firmware and
  reset, `MainWindow` for profiles.

`SyncConfigUtil` is the odd one: it handles ten responses that are all *reads*
the host initiates on startup or on demand - product info, config info, whole
parameters, custom light, effect light, keymap, high keys, macros, trigger
config - plus the effect-language push. It is a whole-device snapshot collector.

#### 8.20.1 The moc blob order is the signal order

Checked exhaustively rather than assumed: for each of the 40 dispatched
responses, the signal index read out of the handler's `QMetaObject::activate`
call was compared against the name at that position in the blob at `0x1400d8201`.
**All 40 match.** Signal indices 7 and 8 are the only pair out of opcode order
(`0x99` is signal 7, `0x98` is signal 8), which is exactly what §4.1 records.

This is pinned by a test, so a future edit that breaks the correspondence fails
the suite rather than silently mis-naming a response.

### 8.21 The eleven gated opcodes, re-decoded with Ghidra

The original decode of this binary was done with a Hopper session whose
pseudocode dropped several byte-assembly blocks (§11.2). A second pass with
Ghidra 12.1.2 over the same artifact
(`sha256 8c8375bd4a7cee0c00fc8a0bf18f3618b8b4f9730a611998088c9c893e6f0c7d`)
recovered full function bodies and instruction-level evidence, and that closes
the packing questions for **all eleven** gated opcodes, including the `0x23` bulk
write that earlier revisions had misclassified as an exposed 1-byte command.
Nothing in this section is
inferred from the decompiler alone; every layout below is read out of
`procedure_assembly`.

One structural finding underpins the rest. Every sender is dispatched from
`FUN_14009dca0`, which switches on `sender+0x31` - the **response** opcode, i.e.
`request | 0x80` - and calls the matching builder:

```
14009dca0:  movzx eax, byte [rcx+0x31]
            sub   eax, 0x90
            cmp   eax, 0x56
            ja    default
            jmp   [jump_table + eax*4]
  case 0x90 -> FUN_1400a60e0   ; 0x10
  case 0xA0 -> FUN_1400a87a0   ; 0x20
  case 0xA3 -> FUN_1400a7b40   ; 0x23
  case 0xA4 -> FUN_1400a9110   ; 0x24
  case 0xA6 -> FUN_1400ab700   ; 0x26
  case 0xA7 -> FUN_1400aab70   ; 0x27
  case 0xA8 -> FUN_1400abcb0   ; 0x28
  case 0xD3 -> FUN_1400ab230   ; 0x53
  case 0xD4 -> FUN_1400a51a0   ; 0x54
  case 0xD6 -> FUN_1400a5b20   ; 0x56
```

Every builder reads its paging state from the same four sender fields -
`+0x59` last frame, `+0x5A` current frame, `+0x5B` page stride, `+0x5C` record
count - which the wrapper sets before dispatch. That is why the length formulas
below are all of the form `stride * remaining + prefix`.

| Op | Payload (after the 6-byte header) | LEN | Page stride | Status |
|---|---|---:|---:|---|
| `0x10` | `[brightness][R][G][B]` + key-index list | `N + 4` | `frameMax - 4` = 124 | frame decoded; group-expanded keys |
| `0x14` | `N` x 8-byte effect record, permuted `[0,2,3,4,1,5,6,7]`, **no prefix** | `8N` | `frameMax / 8` = 16 | frame decoded; never run |
| `0x20` | `[layer][firstKeyItem]` + `N` x `[type,lValue,hValue]` | `3N + 2` | `(frameMax-2)/3` = 42 | all bytes named; never run |
| `0x23` | `N` x fixed 19-byte high-key slot | `19N` | `frameMax/19` = 3 | decoded; config-import only, never run (§8.21.8) |
| `0x24` | `[layer]` + caller-built byte list | `N + 1` | `frameMax - 1` = 127 | frame decoded; list meaning unproven |
| `0x26` | `[trigger lo][trigger hi]` + key-index list | `N + 2` | `frameMax - 2` = 126 | packing decoded; never run |
| `0x27` | `N` x 8 `[keyItem,0,model,quick,qt,rt]` | `8N` | `frameMax / 8` = 16 | packing decoded; never run |
| `0x28` | `[firstKeyItem][count]` + `N` x 8 `[trigger,model,quick,qt,rt]` | `8N + 2` | `frameMax / 8` = 16 | packing decoded; never run |
| `0x53` | one boolean byte (`sender+0x298`) | `1` | - | decoded; calibration safety gate |
| `0x54` | *(none)* | `0` | - | decoded; calibration safety gate |
| `0x56` | `[selector]` + UTF-8 name, zero-padded | `30` fixed | - | decoded; device meaning unverified |

`frameMax` is `DAT_140194994`, the report size read from the HID descriptor.

#### 8.21.1 `0x14` has no header bytes

Earlier revisions said "8 bytes/record confirmed, header bytes unnamed". There
are no header bytes at all: the payload begins with the first record.

```
1400a7442: movzx r9d, byte [rbx+0x5b]   ; page stride
1400a7460: movzx edx, byte [rbx+0x5a]   ; current frame
1400a7466: shl   cl, 3                  ; LEN = 8 * remaining
1400a7479: lea   r15, [rbx+0xb8]        ; source QMap
1400a74xx: mov   byte [rcx+6],  al      ; rec[0]
            mov   byte [rcx+7],  al      ; rec[2]
            mov   byte [rcx+8],  al      ; rec[3]
            mov   byte [rcx+9],  al      ; rec[4]
            mov   byte [rcx+10], al      ; rec[1]
            mov   byte [rcx+11], al      ; rec[5]
            mov   byte [rcx+12], al      ; rec[6]
            mov   byte [rcx+13], al      ; rec[7]
```

The permutation is exactly the `0x13` one, so `0x14` is "apply these effect
records" - the same 8 bytes `0x13` sends for one effect, repeated for a set of
effects. Wrapper `FUN_1400b09a0` sets the stride to `frameMax / 8` and copies a
whole `QMap` into `sender+0xB8`. The old "header bytes unnamed" gate was a
decompiler artefact; the real gate is that a multi-record effect write has never
been run against a board.

#### 8.21.2 `0x10` - prefix is brightness/R/G/B, records are key indices

The builder at `0x1400a60e0` writes four prefix bytes and then copies the byte
vector verbatim:

```
1400a617c: movzx eax, byte [rbx+0x242]  ; payload[0]
1400a618a: movzx eax, byte [rbx+0x245]  ; payload[1]
1400a6198: movzx eax, byte [rbx+0x246]  ; payload[2]
1400a61a6: movzx eax, byte [rbx+0x247]  ; payload[3]
1400a61d0: mov   rax, [rbx+0x230]       ; data pointer
1400a61db: movzx eax, byte [r8+rax]     ; payload[4+i] = key index
```

and the wrapper `FUN_1400b0660` unpacks a 64-bit packed value into exactly those
slots:

```
1400b068c: mov rax, r9 ; shr rax, 0x10  ; -> +0x242
1400b0699: mov rax, r9 ; shr rax, 0x28  ; -> +0x245
1400b06a6: mov rax, r9 ; shr rax, 0x30  ; -> +0x246
1400b06b3: shr r9, 0x38                 ; -> +0x247
```

The producer `FUN_140037b30` packs `{0xFF, 0, brightness, 0, 0, R, G, B}`, so the
prefix is `brightness,R,G,B` - the same struct slots `0x13` uses (§6.3), which is
why the two agree.

The key list comes from `FUN_140034b00`, and its group rule is now proven at
instruction level:

```
140034bb0: movzx edx, byte [rbx]        ; selected key
140034bfb: mov   r13, [rcx+0x28]        ; its Entry
140034c75: movzx eax, byte [r13+1]      ; Entry+1 = group id
140034c7a: cmp   byte [rcx+1], al       ; same group?
140034c82: mov   byte [rsp+0x90], al    ; append Entry+0 = key index
```

So `Entry+1` is the group id and `Entry+0` is the key index. `0x10` cannot
address one key; it addresses the selected key's whole group. That - not an
unknown byte - is why the write stays gated.

#### 8.21.3 `0x20` - both layer containers confirmed

```
1400a8844: movzx eax, byte [rbx+0xc0]   ; payload[0] = layer
1400a8857: jne   1400a8969              ; layer != 0
1400a885d: lea   r15, [rbx+0xc8]        ; layer 0 map
1400a8969: cmp   al, 1
1400a896b: jne   1400a8a74              ; layer >= 2 -> empty body
1400a8971: lea   r15, [rbx+0xd0]        ; layer 1 map
```

Both branches use the identical packing: payload[1] is the first entry's
`keyItem`, then every entry emits `[rec[1], rec[3], rec[2]]` =
`[type, lValue, hValue]`. LEN is built as `3*count + 2` (§8.15). Wrapper
`FUN_1400b0b80` sets the stride to `(frameMax-2)/3` and **replaces** the selected
layer's map with the map it was handed, so every `0x20` send is a whole-layer
write, not a patch.

The KeySetForm producer (`FUN_14002f9c0`, type 1) builds one entry and it is the
"clear this key" record:

```
14002fb99: movzx eax, byte [r13+0x68]   ; keyItem
14002fba2: mov   byte [rcx], al
14002fba4: mov   word [rcx+1], 0xFFFF   ; type = FF, hValue = FF
14002fbaa: mov   byte [rcx+3], 0xFF     ; lValue = FF
```

#### 8.21.4 `0x24` - a caller-built byte list, two bytes in every observed path

The builder is exact:

```
1400a9153 region:
  payload[0] = sender+0xC0              ; layer
  LEN        = remaining + 1            ; lea ecx,[r9+1]
  payload[1+i] = [sender+0xE0][startOffset+i]
```

`sender+0xD8` is a three-qword owning buffer (`owner`, `data` at `+0xE0`, `size`
at `+0xE8`), and wrapper `FUN_1400b0cb0` sets the stride to `frameMax - 1`.

The earlier note that `+0xE0` was a "per-key array with one byte per key" was
wrong: the size is whatever the producer built, and every producer builds **two
bytes**:

| producer | vector | meaning |
|---|---|---|
| `KeySetForm` type 0 (`0x14002fa6f`) | `[keyItem, 0xFF]` | clear this key |
| `KeySetForm` type 2 (`0x14002fc87`) | `[0xFF, 0xFF]` | clear all keys |
| `HighKeyForm` slot (`0x140040fc0`), types 0-2 | `[d0, 0xFF]` | one key |
| `HighKeyForm` slot, types 3-5 | `[d0, d1]` | two keys (the partners) |

The append is the `FUN_14002e920` helper, which appends exactly one byte when its
size hint matches the current size - that is why the decompiler's
`FUN_14002e920(arr, size, &0xFF)` looked like a resize and is not one.

The response name for `0xA4` is `set_keyboard_default` (§8.20), which matches the
`KeySetForm` producers. **The frame is fully decoded.** The one thing still not
proven is what the device does with `0xFF` in each position - "no key", "all
keys", or "layer flag" all read consistently with the producer code. That, plus
the absence of a hardware run, is why `0x24` stays gated.

#### 8.21.5 `0x26` / `0x27` / `0x28` - trigger packing closed

The field names come from `key_trigger_table` (§8.12.3): `keyItem` at 0,
`trigger` u16 at 2, `model` at 4, `quick` at 5, `quickTrigger` u16 at 6,
`resetTrigger` u16 at 8. That is a ten-byte struct, and all three builders are
slices of it.

**`0x26` - trigger depth for a key list**

```
1400ab78d: lea   ecx, [r9+2]            ; LEN = remaining + 2
1400ab79c: movzx eax, byte [rbx+0x260]  ; payload[0]
1400ab7aa: movzx eax, byte [rbx+0x261]  ; payload[1]
1400ab7d0: mov   rax, [rbx+0x270]       ; data pointer
1400ab7db: movzx eax, byte [r8+rax]     ; payload[2+i] = key index
```

Wrapper `FUN_1400b1280` copies a ten-byte record into `sender+0x25E`, so
`+0x260`/`+0x261` are record bytes 2 and 3 - the `trigger` u16. The body is the
key list. `0x26` therefore writes **only** the actuation point, addressed to the
keys in the list.

**`0x27` - quick/reset trigger, one record per key**

```
1400aac30: mov   rax, [rbx+0x288]       ; vector data
1400aac3f: movzx eax, byte [rax]        ; payload[6] = rec[0]  keyItem
1400aac49: mov   byte [rax+rdx+1], 0    ; payload[7] = literal 0
1400aac5d: movzx eax, byte [rax+4]      ; model
1400aac74: movzx eax, byte [rax+5]      ; quick
1400aac8b: movzx eax, byte [rax+6]      ; quickTrigger lo
1400aaca2: movzx eax, byte [rax+7]      ; quickTrigger hi
1400aacb9: movzx eax, byte [rax+8]      ; resetTrigger lo
1400aacd0: movzx eax, byte [rax+9]      ; resetTrigger hi
```

Wire record: `[keyItem, 0x00, model, quick, quickTrigger u16, resetTrigger u16]`.
The zero is written as a literal, not copied - the producer `FUN_14004b1d0`
zeroes the source record's `trigger` field, so `0x27` never carries an actuation
point. Stride `frameMax / 8` = 16.

**`0x28` - the full record for all keys**

```
1400abd47: shl   cl, 3                  ; LEN = 8*remaining
1400abd4a: add   cl, 2                  ;      + 2
1400abdb8: movzx eax, byte [rax]        ; payload[6] = first entry's keyItem
1400abdc2: mov   byte [rax+7], r12b     ; payload[7] = page record count
1400abdce: movzx eax, byte [rax+2]      ; trigger lo
1400abde1: movzx eax, byte [rax+3]      ; trigger hi
1400abdf1: movzx eax, byte [rax+4]      ; model
1400abe01: movzx eax, byte [rax+5]      ; quick
1400abe11: movzx eax, byte [rax+6]      ; quickTrigger lo
1400abe21: movzx eax, byte [rax+7]      ; quickTrigger hi
1400abe31: movzx eax, byte [rax+8]      ; resetTrigger lo
1400abe41: movzx eax, byte [rax+9]      ; resetTrigger hi
```

Wire record: `[trigger u16, model, quick, quickTrigger u16, resetTrigger u16]`,
prefixed by the first entry's `keyItem` and the page's record count. Source is a
`QMap` at `sender+0x200` (wrapper `FUN_1400b13c0`).

The packing question in §8.9 and §8.12.3 is therefore **closed**. What remains
is not static: none of the three has ever been written to a board, and a
mispacked actuation slot is only recoverable by factory reset.

#### 8.21.6 `0x53` and `0x54`

```
0x53: payload[0] = sender+0x298        ; LEN = 1, stride = frameMax
0x54: (no payload)                     ; LEN = 0
```

Wrapper `FUN_1400b1240` sets `sender+0x298` from its fourth argument, then
`+0x5C = 1`, `+0x5B = frameMax`, and frame/order = 1/1. The four call sites pass
`0` (start) and `1` (stop), so the byte is a boolean. `0x54` is the matching
"save" step with an empty body.

Both stay gated for the original reason: a wrong calibration value is a
factory-reset recovery, and the reads (`0x52`, `0x5B`) remain exposed.

#### 8.21.7 `0x56` - the 30-byte config block is a name write

```
1400a5b94: mov   byte [rax+5], 0x1E     ; LEN = 30, fixed
1400a5b9c: movzx eax, byte [rbx+0x208]  ; payload[0] = selector
1400a5ba3: mov   byte [rcx+6], al
1400a5bd0: cmp   ebx, 0x1C              ; copy while index < 28
1400a5be7: mov   byte [rdi+rcx+7], al   ; payload[1+i] = UTF-8 name byte
```

The source is a `QString` at `sender+0x210`. Both producers
(`FUN_140021780`, `FUN_14008e240`) pass selector `0` and a name read from the
profile list / `SELECT * FROM config_table`, so this is `setConfigInfo` in the
ordinary sense: a **config-table entry's name**.

There is an off-by-one in the app worth recording: LEN is 30 but the loop writes
at most 28 name bytes at `payload[1..28]`, leaving `payload[29]` as the zero fill
from the memset. A compatible implementation must reproduce the 30-byte block,
not 29.

This evidence **does not support** the §12 hypothesis that `0x56` is the wireless
transport switch - the response name is `set_config_table_info` and the only
producer is a rename dialog. It stays gated because the device's interpretation
of the selector byte and the name has never been observed.

#### 8.21.8 `0x23` - a paged 19-byte bulk write, used only by config import

Earlier revisions listed `0x23` as `1B: 0xC0` and called it an exposed
per-keyboard-config write. That was wrong. The builder is `FUN_1400a7b40`
(called from dispatcher case `0xA3` at `FUN_14009dca0`), and it emits a **paged
array of fixed 19-byte high-key slots**:

```
[0]=0xFA [1]=0x23 [2]=page [3]=lastPage [4]=0 [5]=LEN
[6..]=count * 19-byte slots          LEN = 19 * count
```

The wrapper `FUN_1400b0a70` sets the page state:

```
param_1[0x31] = 0xA3          ; internal opcode = wire 0x23 | 0x80
param_1[0x30] = 3             ; source/table selector
param_1[0x5A] = 1             ; first page
param_1[0x5B] = 58 / 19 = 3   ; slots per frame on a 64-byte report
param_1[0x59] = ceil(count/3) ; last page
```

`DAT_140194990`/`DAT_140194994` are initialised to `0x40`/`0x3A` (64/58) and, on
the real HID path, overwritten from the product tuple's report size
(`FUN_140095b40`). The APEX200's 64-byte vendor report therefore carries **three
slots per frame** (57 bytes), not the six a 128-byte buffer would allow.

The source is an array of 16-byte `QByteArray` descriptors at `sender+0xF0`
(data pointer at `+0xF8`, count at `+0x100`); each descriptor points at a 19-byte
record. The builder copies type-specific bytes and leaves the rest of the slot
zero:

| Type | Modifier | Slot bytes copied from source | Slot bytes 2..18 |
|---:|---|---|---|
| `0` | TGL | `[2..5]` | 4 data, 13 zero |
| `1` | MT | `[2..6]`, `[8]`, `[7]`, `[9]`, `[0xA]`, `[0xB]` | 10 data, 7 zero |
| `2` | DKS | `[2..0x12]` | 17 data, 0 zero |
| `3` | RS | `[2..3]` | 2 data, 15 zero |
| `4` | OKS | `[2..3]` | 2 data, 15 zero |
| `5` | SOCD | `[2..4]` | 3 data, 14 zero |

Slot byte 0 is the key, byte 1 is the type. The type-1 swap is the same
`0x252`/`0x251` hazard as §8.3.4: the internal struct stores the two fields in
the opposite order from the wire.

**`0x22` and `0x23` are not interchangeable.** `0x22` is variable-length
(`6/11/19/4/4/5`) and its MT record declares `LEN=11`, so the 10th MT data byte
at its frame offset 11 is unreachable. `0x23` uses a fixed 19-byte slot, so the
same 10th byte (`src[0xB]`) **does** go on the wire. The meaning of that byte is
unproven; a faithful `0x23` builder must still copy it.

**Attribution.** The builder is reached only from the config-import worker:

```
MainWindow importButton (string "on_importButton_clicked", 0x1400dfb28)
  -> FUN_140022d00            QFileDialog::getOpenFileName + progress dialog
  -> ImportConfigUtil ctor    FUN_14008a780 (QSqlDatabase at +0x10)
  -> Qt slot 7                FUN_140090630  (qt_metacall FUN_140015230)
  -> FUN_14008eec0            collect QMap values into the slot array
  -> FUN_1400b0a70            set page state, call builder
  -> FUN_1400a7b40            build frame, hid_write
  -> FUN_14009bc10            response ACK: next page while frame < lastPage
```

The interactive `HighKeyForm` uses `0x22`/`0x25`; no UI path sends `0x23`
except Import. The response is `0xA3`; `FUN_14009bc10` stops the one-second timer,
reads the ACK's frame/total, and re-enters the builder for the next page. A
`hid_write` failure goes through `FUN_140019810` for the retry path.

The command remains **Gated**: the full frame is now decoded, but the only way
to prove the page ACK, the 19-byte slot padding, and the MT 10th byte is a
hardware run. A wrong high-key table can silently change bindings, so the first
test must read the table, write it back byte-for-byte unchanged, and read it
again. The WebHID helper is `setHighKeys()` in `js/driver.js`, behind both the
normal write gate and `allowBulkWrite`.

### 8.22 Config import (`ImportConfigUtil`) - the complete write chain

§8.12 recovered the database schema and §8.20.1 proved that the moc blob's
signal order is the declaration order. This section joins the two: every table
`ImportConfigUtil::run()` (`FUN_14008e240`) reads, the staging offset it lands
in, the opcode that later sends it, and the exact signal chain that orders the
writes.

`run()` is a **reader**. It opens the decrypted SQLite file, stages every record
set in its own object, and then calls `FUN_1400b0610` once. That call is the
only frame `run()` sends itself; it is `0x56`, and it starts the chain. Every
later write is issued by a slot that runs when the previous write's **last
page** is acknowledged.

#### 8.22.1 Table -> staging -> opcode

| # | SQL source | Staged at | Sent by | Wire |
|---:|---|---|---|---|
| 1 | `SELECT * FROM product_table` | `+0x58` | not sent; product id checked against `DAT_140197068+0x10` | - |
| 2 | `SELECT * FROM config_table` | `+0x40` | name field of `0x56` | `0xD6` |
| 3 | `SELECT * FROM params_table` | `+0x68` (11-byte struct) | slot 3 | `0x50` |
| 4 | `SELECT * FROM params_table` again | `+0x68` (same) | same | `0x50` |
| 5 | `custom_light_table` | `+0x78` | slot 4 | `0x11` |
| 6 | `effect_light_table` | `+0x80` | slot 5 | `0x14` |
| 7 | `keyboard_fn_table` | `+0x88` | slot 6 | `0x20` layer 0 |
| 8 | `keyboard_fn1_table` | `+0x90` | slot 7 phase 1 | `0x20` layer 1 |
| 9 | `high_key_table` | `+0x98` (QMap key -> record) | slot 7 phase 2 | `0x23` |
| 10 | `key_macro_table WHERE macroIndex=N ORDER BY item ASC`, N=0..9 | `+0xA0 + 8N` (10 QMaps) | slots 8-9 | `0x40` slot N |
| 11 | `key_trigger_table` | `+0xF0` | slot 9 | `0x28` |

The loaders, in the order `run()` calls them:

- `FUN_14008db90` - `product_table` -> `+0x58`.
- `run()` inline - `SELECT * FROM config_table`, first row's first column ->
  `+0x40`. That string is the profile name later handed to `0x56`.
- `FUN_14008de60` - `params_table` -> `+0x68`; an 11-byte packed struct
  (`char, bool, short, short, char, char, bool, bool, char`). It is called
  **twice**, back to back. Both return values are checked with the same error
  (`0xffffffe7`); the row is not changed in between, so the second read is
  redundant, but it is what the binary does.
- `FUN_14008b430` - `custom_light_table` -> `+0x78`.
- `FUN_14008b830` - `effect_light_table` -> `+0x80`.
- `FUN_14008d7d0` - `keyboard_fn_table` -> `+0x88`.
- `FUN_14008d410` - `keyboard_fn1_table` -> `+0x90`.
- `FUN_14008bcb0` - `high_key_table` -> `+0x98`, as a QMap keyed by key item.
- `FUN_14008c1b0` - `key_macro_table`, ten queries
  (`WHERE macroIndex=:macroIndex ORDER BY item ASC`, `:macroIndex` 0..9) ->
  ten QMaps at `+0xA0`..`+0xE8`.
- `FUN_14008cff0` - `key_trigger_table` -> `+0xF0`.

Then `run()` calls `FUN_1400b0610` with the `+0x40` name. The product-table
check happens before any frame is built: the first `short` of the staged
product record must equal the first `short` of the running config
(`DAT_140197068+0x10`), or the import aborts with `0xffffffe8`.

#### 8.22.2 The chain, response by response

The UsbCommunicateUtil metaobject at `0x1400d5fb0` (string table
`0x1400e22d4`, data `0x1400e18c0`) has 48 method entries of 6 ints each
(`name, argc, parameters, tag, flags, metaTypeOffset`), 45 signals and 3 slots.
The nine signal names used by the import are therefore exact, not inferred:

| Signal index | Name |
|---:|---|
| `0x04` | `usb_receive_config_info` |
| `0x10` | `usb_receive_set_config_info` |
| `0x11` | `usb_receive_set_whole_param` |
| `0x12` | `usb_receive_set_custom_light_all` |
| `0x13` | `usb_receive_set_effect_light_all` |
| `0x14` | `usb_receive_set_keyboard_config` |
| `0x16` | `usb_receive_set_high_key` |
| `0x17` | `usb_receive_set_macro_config` |
| `0x18` | `usb_receive_set_trigger_config_all` |

The response dispatcher `FUN_1400af890` switches on the response opcode and
calls one `FUN_14009...` handler. That handler emits the matching signal, and
the constructor `FUN_14008a780` connects the signal to the slot. Both edges are
direct calls in the binary, so the chain below is read off the code:

| Ack | Handler | Emits | Slot | Slot sends |
|---:|---|---|---|---|
| `0xD6` | `FUN_14009a9c0` | `0x10` | `FUN_140090200` | `0x57` |
| `0xD7` | `FUN_140096270` | `0x04` | `FUN_1400900e0` | `0x50` |
| `0xD0` | `FUN_14009d000` | `0x11` | `FUN_140090ad0` | `0x11` |
| `0x91` | `FUN_14009aec0` | `0x12` | `FUN_140090300` | `0x14` |
| `0x94` | `FUN_14009b3e0` | `0x13` | `FUN_140090410` | `0x20` layer 0 |
| `0xA0` | `FUN_14009bea0` | `0x14` | `FUN_140090630` | `0x20` layer 1, then `0x23` |
| `0xA3` | `FUN_14009bc10` | `0x16` | `FUN_140090540` | `0x40` slot 0 |
| `0xC0` | `FUN_14009c5c0` | `0x17` | `FUN_140090770` | `0x40` slot N+1, then `0x28` |
| `0xA8` | `FUN_14009cd70` | `0x18` | `FUN_1400908a0` | none; commit |

In full:

1. **`0x56`** - `FUN_1400b0610` copies the `config_table` name into
   `UsbCommunicateUtil+0x210`, sets the flag byte `+0x208` to 0 and page state
   `+0x59=+0x5A=1`, then calls builder `FUN_1400a5b20`. `0xD6` ack ->
   signal `0x10`.
2. **`0x57`** - slot 2 (`FUN_140090200`) calls `FUN_1400af4c0`; the `0xD7` ack
   emits signal `0x04`. This is a read, not a write: the app refreshes the
   config table it just named.
3. **`0x50`** - slot 3 (`FUN_1400900e0`) calls `FUN_1400b14a0` with `+0x68`;
   `0xD0` ack -> signal `0x11`.
4. **`0x11`** - slot 4 (`FUN_140090ad0`) calls `FUN_1400b07c0` with `+0x78`;
   `0x91` ack -> signal `0x12`.
5. **`0x14`** - slot 5 (`FUN_140090300`) calls `FUN_1400b09a0` with `+0x80`;
   `0x94` ack -> signal `0x13`.
6. **`0x20` layer 0** - slot 6 (`FUN_140090410`) clears `+0xF8`, then calls
   `FUN_1400b0b80` with `+0x88` and layer 0; `0xA0` ack -> signal `0x14`.
7. **`0x20` layer 1** - slot 7 (`FUN_140090630`) sees `+0xF8 == 0`, sets it
   to 1 and calls `FUN_1400b0b80` with `+0x90` and layer 1; `0xA0` ack ->
   signal `0x14` again.
8. **`0x23`** - the same slot sees `+0xF8 == 1` and calls `FUN_14008eec0`,
   which flattens the `+0x98` QMap into 19-byte slots and calls
   `FUN_1400b0a70`; `0xA3` ack -> signal `0x16`.
9. **`0x40` slot 0** - slot 8 (`FUN_140090540`) sets `+0xF9=0` and calls
   `FUN_14008f390`, which selects the `+0xA0` QMap, builds the item list and
   calls `FUN_1400b0e20` with slot index 0; `0xC0` ack -> signal `0x17`.
10. **`0x40` slots 1-9** - slot 9 (`FUN_140090770`) increments `+0xF9` and
    calls `FUN_14008f390` again. Each `0x40` write pages internally; the slot
    only advances when the ack is for the last page. After slot 9,
    `+0xF9 == 10`, and the slot calls `FUN_1400b13c0` with `+0xF0`.
11. **`0x28`** - the `0xA8` ack emits signal `0x18`; slot 10
    (`FUN_1400908a0`) sends nothing. It raises progress to 100 and copies the
    staged state into the application's global config (`DAT_140197068`) via
    `FUN_1400aef50`, `FUN_1400ad030`, `FUN_1400ad0e0`, `FUN_1400ad130`,
    `FUN_1400ad8b0`, `FUN_1400ad860`, `FUN_1400ad950` and `FUN_1400aef00`.

#### 8.22.3 The last-page rule

Every one of the nine slots guards its action with the same test:

```
if (*param_4 <= *param_3)   // total <= frame, i.e. this is the last page
```

The response handler emits the completion signal on **every** page and, when
`frame < total`, re-enters the page builder itself:

| Command | Handler re-entry |
|---|---|
| `0x23` | `FUN_14009bc10` sets `page+1` and `lastPage`, clears `+0x48`, calls `FUN_1400a7b40` |
| `0x40` | `FUN_14009c5c0` sets `page+1` and `lastPage`, clears `+0x48`, calls `FUN_1400a96a0` |

So the chain advances exactly once per command, after the final page, even
though the signal fires on every page. A WebHID reimplementation must preserve
this: treating the first page ack as "command done" would start the next write
while the device is still receiving the current one.

#### 8.22.4 What the importer does not do

- It never sends `0x55` (`switch_config_table`). The import reaches the profile
  only through the `0x56` name frame; `0x55` is a separate profile action.
- The only `0x57` in the chain is the slot-2 read after `0x56`. The importer
  does not run the standalone profile-list read-back.
- It does not send `0x24`, `0x26`, `0x27`, `0x53` or `0x54`; those are separate
  UI actions, not part of a profile import.
- The ten macro writes are **one per macro slot**, each with its own paging, in
  index order. The importer does not merge them into one `0x40` frame.
- The high-key write is **one** paged `0x23` write built from the whole
  `high_key_table` map; it is not one write per key.

This maps the entire import onto the WebHID driver surface already documented in
§8.21: `setWholeParams` (`0x50`), `setCustomLightAll` (`0x11`),
`setEffectLightAll` (`0x14`), `setKeymap` (`0x20`), `setHighKeys` (`0x23`),
`setMacro` (`0x40`) and `setTriggerConfig` (`0x28`). Profile import remains
gated until each of those writes has been hardware-validated; the first test is
still read -> write byte-identical -> read and compare.

### 8.23 Read framing and per-object payloads

Four reads take a one-byte sub-object selector at frame[6]. It comes from a
fixed sender field, never from the page counter:

| Cmd | Read | Field | Source | Verified values |
|---:|---|---|---|---|
| `0x17` | effect config | effect index | `+0xB0` | 0..11 |
| `0x18` | effect names | name-set selector | `FUN_14005ea80(DAT_140197008)` | 0, 1, 7 |
| `0x2A` | keymap | layer | `+0xC0` | 0 or 1 |
| `0x42` | macro | macro slot | `+0x108` | 0..9 |

Each has its own builder (`FUN_1400a2410`, `FUN_1400a2900`, `FUN_1400a3320`,
`FUN_1400a3810` respectively), and each writes `LEN=1` with the value at
frame[6]. `0x2B`, `0x57`, `0x5B`, `0x5E` and `0x62` use different shapes; `0x62`
is covered in §8.23.3.

#### 8.23.1 Read page numbering is 1-based

Every read initiator sets `sender+0x59/+0x5A = 0x0101` before the first builder
call; `FUN_1400af5d0` is the `0x2B` instance. The wrapper sweep over every
sender slot confirms it is not an accident of one command — the same two byte
stores appear in all of them:

| Wrapper | Sends | Builder |
|---|---|---|
| `FUN_1400af4c0` | `0x57` profiles | `FUN_1400a1ab0` |
| `FUN_1400af500` | `0x16` custom light | `FUN_1400a1f60` |
| `FUN_1400af590` | `0x18` effect names | `FUN_1400a2900` |
| `FUN_1400af6a0` | `0x42` macro (slot 0..9 enforced) | `FUN_1400a3810` |
| `FUN_1400af810` | `0x62` product info | `FUN_1400a3d00` |
| `FUN_1400af830` | `0x2C` trigger config | `FUN_1400a4350` |
| `FUN_1400af870` | `0x5E` whole param | `FUN_1400a4820` |
| `FUN_1400b14a0` | `0x50` whole param write | `FUN_1400ac480` |
| `FUN_1400af1b0` | `0x58` add profile | `FUN_14009de90` |
| `FUN_1400af240` | `0x59` del profile | `FUN_14009ed10` |
| `FUN_1400b15c0` | `0x55` switch profile | `FUN_1400acb40` |

`FUN_1400af6a0` also proves the macro-slot range: slot 0..9 each pick a distinct
staging buffer (`+0x110`..`+0x1E8`), and slot 10 emits the communicator's error
signal instead of sending. The builder copies `+0x5A` to frame[2] and `+0x59` to
frame[3], so the first request is page **1**, total **1**.

On a reply the handler reads the response frame and total. When `frame < total`
it sets `+0x5A = frame + 1`, `+0x59 = total`, clears `+0x48`, and calls the
builder directly:

| Cmd | Handler | Next-page action |
|---:|---|---|
| `0x2B` | `FUN_140098b90` | `+0x5A = frame+1`, `+0x59 = total`, call `FUN_1400a2e50` |
| `0x23` | `FUN_14009bc10` | `+0x5A = frame+1`, `+0x59 = total`, call `FUN_1400a7b40` |
| `0x40` | `FUN_14009c5c0` | `+0x5A = frame+1`, `+0x59 = total`, call `FUN_1400a96a0` |

`readAll()` mirrors this: request 1/1, then page = response frame + 1 and total
= response total. The CLI's page-0 probe and the vendor app's page-1 request
are different sequences; §7 explains why the driver follows the app.

#### 8.23.2 `0x18`'s byte is a name-set selector

`FUN_14005ea80` maps the app's language setting to 1, 2 or 3:

```
setting 1 -> 1
setting 2 -> 2
setting 3 -> 3
otherwise QLocale::language:
  0x3A  -> 1
  0x4B  -> 2      (English)
  0x136 -> 3
  other -> 2
```

`FUN_1400a2900` then maps that result to the wire byte:

```
result 2 -> 0
result 3 -> 7
otherwise -> 1
```

English/default therefore sends **0**; the other two selectable sets are 1 and
7. This byte is not an effect index and not a page number. The driver exposes
it as `readEffectNames(nameSet)` / `getEffectLightName(nameSet)` and rejects
values outside 0/1/7.

#### 8.23.3 `0x62`'s request is the host clock

`FUN_1400a3d00` writes `LEN=7`:

```
frame[6]  = 0
frame[7]  = (year & 0xff) + 0x30, truncated to 8 bits
frame[8]  = month
frame[9]  = day
frame[10] = hour
frame[11] = minute
frame[12] = second
```

The assembly is literally `QDate::year` in EAX, `ADD AL,0x30`, store AL. It is
**not** ASCII and not the full year: for 2026 it sends `26` (0x1A), not `'J'`
and not `0x4A`. Month through second are plain binary. The response (`0xE2`) is
the 56-byte product-info block in §7.

### 8.24 Profile actions — `0x57` / `0x55` / `0x58` / `0x59`

Profiles are read with `0x57` (`sendGetConfigInfo`, `FUN_1400a1ab0`) and written
with three one-byte commands. Each write slot sets the paging pair and the
payload byte directly:

```
FUN_1400af1b0  0x58 add      s[0x88] = arg; s[0x5A/+0x59] = 0x0101; FUN_14009de90
FUN_1400af240  0x59 del      same; FUN_14009ed10
FUN_1400b15c0  0x55 switch   same; FUN_1400acb40
```

All three builders (`FUN_14009de90`/`FUN_14009ed10`/`FUN_1400acb40`) emit the
same shape — `LEN = 1`, `frame[7] = s[0x88]` — and the debug line's
`index={s[0xB0]}` is the mislabelled log field of §4.5, not the wire byte. The
UI caller of `0x55` is `MainWindow::onSelectionChanged` (`FUN_140022610`): it
takes the selected row of the profile list (`QStandardItem::row`), stores it in
`+0xA0`, and **skips the send when that row already equals the device's current
config index** (`DAT_140197068+0x80`). `0x58` is called from the add button
(`FUN_140022830`) with the **currently selected profile's index** — the new
profile is keyed to the selection, and what the board derives from it is its own
choice. `0x59` is called from the delete button (`FUN_1400228a0`) behind a
guard: **it only sends when the profile count is > 1** — the app never deletes
the last remaining profile.

The deletes come from the same selection row, so `index` throughout is the
zero-based position in the `0x57` list. The WebHID UI mirrors all three
behaviours: byte-payload writes (`addProfile`/`delProfile`/`switchProfile`),
a delete guard that counts profile pages from `0x57` before sending, and a note
that switch always sends because the current-config byte is not cheaply
knowable there.

### 11.1 How the frame inventory was built

`objdump -d` over `.text`, then a script that looks for the `0xFA` magic store
followed by an immediate store at offset `+1`. That finds every frame builder.
Two things had to be got right or the output is garbage:

- **The BLE variant is a second builder one branch away.** Its magic sits at
  offset `+1`, not `+0`, because of the leading zero byte. Collecting both
  branches into one offset map shifts every field by one and produces plausible,
  wrong numbers.
- **Attribute by the `"... send data result="` string, not the `"err_string"`
  one.** Both live in the same function and differ by 0x40 bytes. Taking
  whichever is alphabetically first assigns the neighbouring function's name.

Names then come from the string table at `0x1400f7388`–`0x1400f91b0`; function
boundaries from `resolve_containing_procedure`, which is what disambiguates
`0x20`/`0x24` (two functions, one shared log name).

### 11.2 The decompiler lies, and it cost real time

**Hopper's pseudocode silently drops logic blocks.** In `sub_140037f80` and
`sub_1400380d0` — the two functions that build the `0x13` payload — the
decompiler emits a call taking only the effect index, omitting the byte-by-byte
assembly of the other seven bytes entirely.

That omission is what produced a *wrong* conclusion earlier in this work: that the
Windows app stored lighting settings as an opaque blob with no brightness
control. The conclusion was an artifact, not a fact. `procedure_assembly` shows
the real code:

```asm
movzx eax, byte [r9+0x38]   ; effect index
movzx eax, byte [r9+0x58]   ; brightness
movzx eax, byte [rcx+1]     ; record passthrough
```

**Every structural claim in this document is backed by `procedure_assembly`,**
not by pseudocode alone. Where a claim rests only on a method name it is labelled
as such (§3.5).

### 11.3 Cross-checks

Sections 3–6 and 8 were first recovered with `objdump` + manual `.rdata` string
annotation, then **independently re-derived with Hopper**. Hopper reproduced the
frame layout, the payload permutation and the wireless header shift exactly.

Sections 1, 2 and 9 come from the **real device** — `lsusb`, sysfs report
descriptors, the USB interface/endpoint tree — and corrected three earlier
assumptions: that `0xFA` was a report ID, that reports were 128 bytes, and hence
that the payload budget was 123 bytes.

Section 7 is **live capture**: read-only commands were sent to the keyboard and
the responses decoded.

### 11.4 Verifying in a browser

`node --check` proves a module parses. It cannot prove that a button has a
handler, that an id the script reaches for exists, or that a dropdown offers only
values the device accepts. Those are runtime properties of the *page*.

`test/run-all.sh` therefore runs two suites in a real browser
(`test/browser-smoke.html`, `test/dom-wiring.html`). Doing so found four real
defects that static checking had passed:

| Defect | Why static checks missed it |
|---|---|
| duplicate `id="trace"` on a `<section>` and a `<pre>` | `$('#trace')` silently returned the section; the log went to the wrong node |
| `btnGetLightName`, `btnCustom`, `btnReadHighKeys` dead | handlers lost during an earlier edit; the module still parsed |
| effect dropdown offered index 12 | `null` placeholder rendered as an option, but 12 is outside the validated 0-11 range |
| test asserted 12 effect names | the array correctly holds 13 slots — 12 decoded plus the undecoded one |

The third is the interesting one: a *test bug* surfaced a *product bug*, because
the assertion and the code disagreed and only one of them was wrong.

### 11.5 A note on what was actually sent

An earlier phase of this work wrote to the device on unverified assumptions and
damaged the Fn-layer key binding and RGB effect presets; recovery needed a
factory reset. Two guardrails came out of that and are now structural rather
than procedural:

- Every one of the 39 opcodes is classified `read` or `write` from the app's own
  method names (§3). Both frontends refuse an unclassified opcode outright and
  refuse a write unless the call site opts in.
- Every UI write path reads the device back afterwards and reports whether the
  change actually took. An accepted ack is not treated as proof.

Neither guardrail exists in the Windows app, which has no equivalent check.

## 12. Feature-parity audit

Every one of the 39 functions the Windows app can perform, and what the WebHID
app does with it. Built by taking each app method name from §4.6, mapping it to
its opcode, and checking whether the opcode reaches a driver helper that the UI
calls. **24 exposed, 11 deliberately gated, 4 refused as firmware** — no row is
blank, and every gated row names the thing that would have to be known first.

A row only moves from *Gated* to *Exposed* when every byte its write touches has
a name; a row moves the other way the moment one loses it. The test suite fails
if these counts stop matching the table, so the headline cannot drift away from
the rows underneath it.

### 12.1 The two fully-named writes that are not exposed

`0x20` and `0x24` now have **every** byte named, and both are still marked
Gated. That is deliberate, and the reason is no longer "a byte is unknown":

| opcode | last unnamed byte | resolved in |
|---|---|---|
| `0x20` `sendSetKeyboardConfig` | prefix byte = the keymap layer | §8.19 |
| `0x24` `sendSetKeyboardConfig` (B) | prefix byte = the keymap layer | §8.19 |

What remains is that **none of them has ever been executed against hardware**.
That is not a knowledge gap and no further static analysis will close it. It
needs a device.

**At the time of writing no keyboard is attached** - `/dev/hidraw*` is empty and
`lsusb` shows no `314b:*` device - so the check cannot be run from here. The
right check, when a board is available, is the least destructive one that still
proves the framing: read a layer, write it back **byte-for-byte unchanged**, read
again, and require the second read to equal the first. A write of unchanged data
cannot alter the keymap's meaning even if the framing were subtly wrong, which is
what makes it safe to run first.

Until that has happened once, naming every byte is not a licence to write, and
these rows stay Gated. §8.19.3 and §8.13.3 record the same point for the two
individual commands.

This table exists so the parity claim can be checked line by line rather than
taken on trust. Regenerating it is one script over `js/protocol.js`,
`js/driver.js` and `js/app.js`.

**And it is checked, every run.** The Node suite carries the 39 request opcodes
and 40 dispatched responses as *independent ground truth* - recovered from the
binary by the log-string pairing of §4.6 and the dispatch table at `0x140089a04`,
and hardcoded deliberately so the audit is not derived from the code it audits.
It then asserts that every request is classified read/write, that every opcode has
a name, that §3 and §12 each document all 39, that §4.1 documents all 40, and
that the response names agree between this file and `protocol.js` in both
directions.

This is not decoration. Deleting one row from the table, renaming a single
response in `protocol.js`, and removing one `COMMAND_CLASS` entry were each
injected as a test; all three were caught, most of them by more than one
assertion. Drift has been this project's recurring failure mode - stale counts, a
moc blob read as ground truth, two instructions of arithmetic dropped from a grep
- so the checks that would have caught it are now permanent rather than
remembered.

| Req | Windows app function | WebHID status |
|---|---|---|
| `0x10` | `sendSetCustomLight` | Gated — group-granular by construction (§8.11.2) |
| `0x11` | `sendSetCustomLightAll` | Exposed — driver helper + UI, read-modify-write + readback verification (§8.13.2) |
| `0x13` | `sendSetEffectLight` | Exposed — driver helper + UI |
| `0x14` | `sendSetEffectLightAll` | Gated — payload decoded, no header bytes (§8.21.1); never run against hardware |
| `0x16` | `sendGetCustomLight` | Exposed — driver helper + UI |
| `0x17` | `sendGetEffectLight` | Exposed — driver helper + UI |
| `0x18` | `sendGetEffectLightName` | Exposed — driver helper + UI |
| `0x19` | `sendSelectEffectLight` | Exposed — driver helper + UI |
| `0x20` | `sendSetKeyboardConfig` | Gated — every byte named (§8.19); whole-layer replace never run against hardware |
| `0x22` | `sendAddHighKey` | Exposed — driver helper + UI (HighKeyForm add) |
| `0x23` | `sendSetHighKey` | Gated — paged 19-byte bulk write used only by config import (§8.21.8); no UI, never run |
| `0x24` | `sendSetKeyboardConfig` | Gated — a different command from `0x20` (§8.15), every byte named (§8.21.4); never run |
| `0x25` | `sendDelHighKey` | Exposed — driver helper + UI (HighKeyForm delete) |
| `0x26` | `sendSetTriggerConfig` | Gated — actuation packing decoded (§8.21.5); never run against hardware |
| `0x27` | `sendSetQuickTriggerConfig` | Gated — quick/reset packing decoded (§8.21.5); never run |
| `0x28` | `sendSetTriggerConfigAll` | Gated — full-record packing decoded (§8.21.5); never run |
| `0x2A` | `sendGetKeyboardConfig` | Exposed — driver helper + UI |
| `0x2B` | `sendGetHighKey` | Exposed — driver helper + UI |
| `0x2C` | `sendGetTriggerConfig` | Exposed — driver helper + UI |
| `0x40` | `sendSetMacroConfig` | Exposed — driver helper + UI, record fully named (§8.12.1) |
| `0x41` | `sendDelMacroConfig` | Exposed — driver helper + UI |
| `0x42` | `sendGetMacroConfig` | Exposed — driver helper + UI |
| `0x50` | `sendSetWholeParam` | Exposed — 20-byte blob fully named, 8 settings (§8.14) |
| `0x52` | `sendGetCalibrationState` | Exposed — driver helper + UI |
| `0x53` | `sendSetReportCalibration` | Gated — calibration write; a wrong value needs a factory reset |
| `0x54` | `sendSaveCalibration` | Gated — calibration write; a wrong value needs a factory reset |
| `0x55` | `sendSwitchConfigTable` | Exposed — driver helper + UI |
| `0x56` | `sendSetConfigInfo` | Gated — starts the config-import chain with the profile name (§8.21.7, §8.22.2); device meaning unverified |
| `0x57` | `sendGetConfigInfo` | Exposed — driver helper + UI |
| `0x58` | `sendAddConfigTable` | Exposed — driver helper + UI |
| `0x59` | `sendDelConfigTable` | Exposed — driver helper + UI |
| `0x5B` | `sendGetCalibrationAdc` | Exposed — driver helper + UI |
| `0x5E` | `sendGetWholeParam` | Exposed — driver helper + UI |
| `0x60` | `sendDownloadFirewwareKeyboard` | Refused — firmware, `FORBIDDEN_COMMANDS` |
| `0x61` | `sendResetKeyboard` | Exposed — driver helper + UI |
| `0x62` | `sendGetProductInfo` | Exposed — driver helper + UI |
| `0x63` | `receiveDownloadFirewareKeyboardEnd` | Refused — firmware |
| `0x65` | `sendDownloadFirewareData` | Refused — firmware |
| `0x66` | `sendDownloadFirewareDataEnd` | Refused — firmware |

Two of the gates are worth calling out because they are safety decisions rather
than knowledge gaps:

- **`0x56 setConfigInfo` is the first frame of the config-import chain**
  (§8.22.2): it carries the name read from `config_table`, and the device
  answers it before the chain continues. §8.21.7 shows it is a name write, not
  the transport switch §8.4 once suspected. It stays gated because the device's
  interpretation — create, select or rename, and what it does to the currently
  active profile — is still unverified. Even with the 30-byte block decoded,
  this write stays behind an explicit acknowledgement.
- **`0x53`/`0x54` calibration writes** are gated because the record is not
  decoded, and a wrong actuation or timing value is only recoverable by factory
  reset. The matching **reads** (`0x52`, `0x5B`) are exposed.
