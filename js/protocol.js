// ANT ESPORTS APEX 200 — HID framing + command table.
//
// Reverse-engineered from GameKeyboard.exe (static analysis only).
// See ../PROTOCOL.md for the evidence behind every value here.

export const VID = 0x314b;
export const PID = 0x1026;

/**
 * Frame magic — the first byte of the vendor payload.
 *
 * This was originally assumed to be a HID *report ID*. The real report
 * descriptor proves otherwise: the vendor collection on hidraw0 declares
 **no ReportID items at all**, so 0xFA is a protocol magic byte and the
 * implicit report ID is 0.
 */
export const MAGIC = 0xfa;

/**
 * Actual report size from the device's report descriptor:
 *   UsagePage 0xFF02, Usage 0x0002, INPUT 8bit x64, OUTPUT 8bit x64
 *
 * The Windows app allocates 128 (`gUsbFrameMaxsize`) and writes 129 bytes; the
 * APEX200's vendor report is only 64. Either the app over-writes harmlessly, or
 * the binary targets larger reports on other models in the family. **Unverified**
 * until a frame round-trips on real hardware.
 */
export const REPORT_SIZE = 64;

/** Largest payload a single frame can carry: 64 - 6. */
export const MAX_PAYLOAD = REPORT_SIZE - 6;

/**
 * HID transfer for WebHID. With no ReportID items, `sendReport` takes reportId 0
 * and the whole 64-byte payload goes in `data`.
 */
export const WEBHID_REPORT_ID = 0;

/** Field offsets, relative to the magic byte (offset 0 of the payload). */
export const OFF_MAGIC = 0;
export const OFF_CMD = 1;
export const OFF_PARAM1 = 2;
export const OFF_PARAM2 = 3;
export const OFF_RESERVED = 4;
export const OFF_LENGTH = 5;
export const OFF_DATA = 6;

/** Response opcodes are the request opcode with this bit set. */
export const RESPONSE_FLAG = 0x80;

/** Request commands, exactly as found in UsbCommunicateUtil. */
export const CMD = {
  SET_CUSTOM_LIGHT: 0x10,
  SET_CUSTOM_LIGHT_ALL: 0x11,
  SET_EFFECT_LIGHT: 0x13,
  SET_EFFECT_LIGHT_ALL: 0x14,
  GET_CUSTOM_LIGHT: 0x16,
  GET_EFFECT_LIGHT: 0x17,
  GET_EFFECT_LIGHT_NAME: 0x18,
  SELECT_EFFECT_LIGHT: 0x19,
  // 0x20 and 0x24 are two DISTINCT functions that the Windows app logs under the
  // same name "sendSetKeyboardConfig". They are not interchangeable; see
  // PROTOCOL.md 3.3. Until that is resolved, neither is exposed as a control.
  SET_KEYBOARD_CONFIG_A: 0x20,
  ADD_HIGH_KEY: 0x22,
  SET_HIGH_KEY: 0x23,
  SET_KEYBOARD_CONFIG_B: 0x24,
  DEL_HIGH_KEY: 0x25,
  SET_TRIGGER_CONFIG: 0x26,
  SET_QUICK_TRIGGER_CONFIG: 0x27,
  SET_TRIGGER_CONFIG_ALL: 0x28,
  GET_KEYBOARD_CONFIG: 0x2a,
  GET_HIGH_KEY: 0x2b,
  GET_TRIGGER_CONFIG: 0x2c,
  SET_MACRO_CONFIG: 0x40,
  DEL_MACRO_CONFIG: 0x41,
  GET_MACRO_CONFIG: 0x42,
  SET_WHOLE_PARAM: 0x50,
  GET_CALIBRATION_STATE: 0x52,
  SET_REPORT_CALIBRATION: 0x53,
  SAVE_CALIBRATION: 0x54,
  SWITCH_CONFIG_TABLE: 0x55,
  SET_CONFIG_INFO: 0x56,
  GET_CONFIG_INFO: 0x57,
  ADD_CONFIG_TABLE: 0x58,
  DEL_CONFIG_TABLE: 0x59,
  GET_CALIBRATION_ADC: 0x5b,
  GET_WHOLE_PARAM: 0x5e,
  DOWNLOAD_FIRMWARE_KEYBOARD: 0x60,
  RESET_KEYBOARD: 0x61,
  GET_PRODUCT_INFO: 0x62,
  FIRMWARE_KEYBOARD_END: 0x63,
  DOWNLOAD_FIRMWARE_DATA: 0x65,
  DOWNLOAD_FIRMWARE_DATA_END: 0x66,
};

/**
 * Read/write classification for every opcode the Windows app can send.
 *
 * Derived from the app's own method names after locating all 39 frame builders
 * (PROTOCOL.md section 3). 13 READ, 26 WRITE, none unclassified.
 *
 * `request()` refuses to send anything classified WRITE unless the caller passes
 * `allowWrite: true`. This is the guard that prevents an unclassified sweep from
 * reaching the board.
 */
export const COMMAND_CLASS = {
  [CMD.GET_CUSTOM_LIGHT]: 'read',
  [CMD.GET_EFFECT_LIGHT]: 'read',
  [CMD.GET_EFFECT_LIGHT_NAME]: 'read',
  [CMD.GET_KEYBOARD_CONFIG]: 'read',
  [CMD.GET_HIGH_KEY]: 'read',
  [CMD.GET_TRIGGER_CONFIG]: 'read',
  [CMD.GET_MACRO_CONFIG]: 'read',
  [CMD.GET_CALIBRATION_STATE]: 'read',
  [CMD.GET_CONFIG_INFO]: 'read',
  [CMD.GET_CALIBRATION_ADC]: 'read',
  [CMD.GET_WHOLE_PARAM]: 'read',
  [CMD.GET_PRODUCT_INFO]: 'read',
  [CMD.FIRMWARE_KEYBOARD_END]: 'read',

  [CMD.SET_CUSTOM_LIGHT]: 'write',
  [CMD.SET_CUSTOM_LIGHT_ALL]: 'write',
  [CMD.SET_EFFECT_LIGHT]: 'write',
  [CMD.SET_EFFECT_LIGHT_ALL]: 'write',
  [CMD.SELECT_EFFECT_LIGHT]: 'write',
  [CMD.SET_KEYBOARD_CONFIG_A]: 'write',
  [CMD.ADD_HIGH_KEY]: 'write',
  [CMD.SET_HIGH_KEY]: 'write',
  [CMD.SET_KEYBOARD_CONFIG_B]: 'write',
  [CMD.DEL_HIGH_KEY]: 'write',
  [CMD.SET_TRIGGER_CONFIG]: 'write',
  [CMD.SET_QUICK_TRIGGER_CONFIG]: 'write',
  [CMD.SET_TRIGGER_CONFIG_ALL]: 'write',
  [CMD.SET_MACRO_CONFIG]: 'write',
  [CMD.DEL_MACRO_CONFIG]: 'write',
  [CMD.SET_WHOLE_PARAM]: 'write',
  [CMD.SET_REPORT_CALIBRATION]: 'write',
  [CMD.SAVE_CALIBRATION]: 'write',
  [CMD.SWITCH_CONFIG_TABLE]: 'write',
  [CMD.SET_CONFIG_INFO]: 'write',
  [CMD.ADD_CONFIG_TABLE]: 'write',
  [CMD.DEL_CONFIG_TABLE]: 'write',
  [CMD.DOWNLOAD_FIRMWARE_KEYBOARD]: 'write',
  [CMD.RESET_KEYBOARD]: 'write',
  [CMD.DOWNLOAD_FIRMWARE_DATA]: 'write',
  [CMD.DOWNLOAD_FIRMWARE_DATA_END]: 'write',
};

/**
 * Payload shapes recovered from the frame builders, cross-checked against the
 * app's own SQL schema (PROTOCOL.md 8.13).
 *
 * `headerBytes` is the count of bytes emitted once before the record loop;
 * `positional` names a column the wire omits because record order implies it;
 * `gated` records why a command is still not writable. A command with no
 * `gated` entry is either exposed or a plain fixed/record write handled above.
 */
export const PAYLOAD_SHAPES = {
  0x11: {
    name: 'set_custom_light_all',
    kind: 'columnar',
    headerBytes: 1,
    record: 4,
    lenFormula: '4 * count + 1',
    positional: 'key index, implied by ascending QMap order',
    gated: null,
  },
  0x14: {
    name: 'set_effect_light_all',
    kind: 'record',
    headerBytes: 0,
    record: 8,
    lenFormula: '8 * count',
    positional: null,
    gated: 'header bytes unnamed',
  },
  0x20: {
    name: 'set_keyboard_config',
    kind: 'record',
    headerBytes: 2,
    record: 3,
    wireOrder: [1, 3, 2],
    lenFormula: '3 * count + 2',
    source: 'QMap at sender+0xC8, walked in ascending key order',
    positional: 'keyItem',
    gated: 'prefix byte (sender+0xC0) and record byte 0 have no names',
  },
  0x24: {
    name: 'set_keyboard_config_1',
    kind: 'columnar',
    headerBytes: 1,
    record: 1,
    wireOrder: null,
    lenFormula: '1 * count + 1',
    source: 'flat byte array at sender+0xE0',
    positional: 'key index, implied by array position',
    gated: 'a different command from 0x20; no field names yet',
  },
  0x40: {
    name: 'set_macro_config',
    kind: 'record',
    headerBytes: 2,
    record: 6,
    lenFormula: '6 * count + 2',
    positional: 'item',
    gated: null,
  },
};

/**
 * `0x16` getCustomLight — per-key colour, 5 bytes per key.
 *
 * Record layout comes from the `custom_light_table` DDL the app ships
 * (PROTOCOL.md 8.12): `keyItem, light, colorR, colorG, colorB`. The read format
 * is the one thing about `0x10`/`0x11` that is fully determined - §8.13.1
 * establishes that the *write* is columnar and positional, which is a different
 * shape from this read.
 */
export const CUSTOM_LIGHT_RECORD_LEN = 5;

export const CUSTOM_LIGHT_FIELD = {
  KEY_ITEM: 0, LIGHT: 1, RED: 2, GREEN: 3, BLUE: 4,
};

/**
 * Decode `0x16` readback pages into per-key colour records.
 *
 * Any trailing bytes that do not form a whole record are reported rather than
 * dropped, so a format change shows up as an explicit error instead of a
 * silently shorter list.
 */
export function parseCustomLight(pages) {
  const flat = [];
  for (const p of pages) for (const b of p) flat.push(b);
  const out = [];
  const whole = Math.floor(flat.length / CUSTOM_LIGHT_RECORD_LEN);
  for (let i = 0; i < whole; i++) {
    const o = i * CUSTOM_LIGHT_RECORD_LEN;
    const rec = flat.slice(o, o + CUSTOM_LIGHT_RECORD_LEN);
    out.push({
      index: i,
      keyItem: rec[CUSTOM_LIGHT_FIELD.KEY_ITEM],
      light: rec[CUSTOM_LIGHT_FIELD.LIGHT],
      r: rec[CUSTOM_LIGHT_FIELD.RED],
      g: rec[CUSTOM_LIGHT_FIELD.GREEN],
      b: rec[CUSTOM_LIGHT_FIELD.BLUE],
      hex: '#' + [CUSTOM_LIGHT_FIELD.RED, CUSTOM_LIGHT_FIELD.GREEN, CUSTOM_LIGHT_FIELD.BLUE]
        .map((f) => rec[f].toString(16).padStart(2, '0')).join(''),
      bytes: rec,
    });
  }
  return {
    records: out,
    trailing: flat.length - whole * CUSTOM_LIGHT_RECORD_LEN,
  };
}

/* ------------------------------------------------------- snapshot decoding */

/**
 * Attach a decoded view to one snapshot section, leaving the raw bytes untouched.
 *
 * A backup is only useful if it can be read back, but it is only faithful if it
 * keeps the original bytes. So both are kept: `raw` is what the device actually
 * said, `decoded` is this project's reading of it. If the two ever disagree -
 * a decoder bug, or a firmware that means something else - the discrepancy is
 * visible instead of hidden behind a lossy summary.
 *
 * A section with no decoder yet gets `decoded: null` rather than a guess.
 */
export function decodeSnapshotSection(name, value) {
  if (!value || typeof value !== "object" || "error" in value) return null;
  const pages = value.pages ?? null;
  const frames = value.frames ?? null;
  try {
    switch (name) {
      case "wholeParam":
        return parseWholeParams(value.payload ?? value.joined);
      case "customLight":
        return pages ? parseCustomLight(pages) : null;
      case "effectLight": {
        const p = value.payload ?? value.joined;
        return p && p.length >= 8 ? parseEffectConfig(p) : null;
      }
      case "effectNames":
        return pages ? parseEffectNames(pages) : null;
      case "keyboardConfig":
        return pages ? parseKeymap(pages) : null;
      case "highKey":
        return pages ? decodeHighKeyRecords(pages) : null;
      case "macro":
        return frames
          ? frames.map((f) => (f.payload.length >= 2 ? parseMacroRecords(f.payload) : null))
            .filter(Boolean)
          : null;
      default:
        return null;
    }
  } catch {
    // A decoder must never be able to fail a snapshot. The raw bytes survive.
    return null;
  }
}

/**
 * High-key bindings, decoded one record at a time.
 *
 * Lives here rather than in the driver because the snapshot decoder needs it too,
 * and a snapshot must not depend on the transport layer being loaded.
 */
export function decodeHighKeyRecords(pages) {
  const out = [];
  pages.forEach((page, pageIndex) => {
    // Each high-key record is its own length (PROTOCOL.md 8.3), so walk the page
    // using the declared length rather than a fixed stride.
    let at = 0;
    while (at + 2 <= page.length) {
      const mod = page[at];
      const def = MODIFIER_BY_TYPE[mod];
      if (!def) {
        out.push({ page: pageIndex, offset: at, error: `unknown modifier type 0x${mod.toString(16)}` });
        break;
      }
      const len = def.recordLen;
      if (at + len > page.length) {
        out.push({ page: pageIndex, offset: at, error: `truncated ${def.name}: need ${len}, have ${page.length - at}` });
        break;
      }
      out.push({ page: pageIndex, offset: at, ...parseHighKeyRecord(page.subarray(at, at + len), def) });
      at += len;
    }
  });
  return out;
}

/* ------------------------------------------------------------ whole params */

/**
 * `0x50` setWholeParam / `0x5E` getWholeParam — SOLVED. See PROTOCOL.md 8.14.
 *
 * The payload is 20 bytes (`LEN = 0x14`). The builder at `0x1400ac499` writes
 * `[0xFF]`, then copies bytes 1..10 of the app's 11-byte params struct, then
 * pads with nine more `0xFF`s. The struct's own layout comes from reading
 * `params_table` out of SQLite:
 *
 *   +0 reserve  u8   +2 deadDown u16  +6 pollingRate u8   +8 calibration u8
 *   +1 touchOptimize u8  +4 deadUp u16  +7 shakeLevel  u8  +9 sportsMode  u8
 *                                                          +10 currentLayer u8
 *
 * So the fields the host can actually set are the eight named settings; the
 * `reserve` byte and the nine-byte tail are constants the Windows app writes as
 * `0xFF` and never varies.
 */
export const WHOLE_PARAM_LEN = 20;

export const WHOLE_PARAM_FIELD = {
  RESERVE: 0,
  TOUCH_OPTIMIZE: 1,
  DEAD_DOWN: 2, // u16 LE
  DEAD_UP: 4, // u16 LE
  POLLING_RATE: 6,
  SHAKE_LEVEL: 7,
  CALIBRATION: 8,
  SPORTS_MODE: 9,
  CURRENT_LAYER: 10,
};

/** Byte the Windows app always writes for the reserve byte and the tail. */
export const WHOLE_PARAM_FILL = 0xff;

/** Settings a caller may change, by wire offset. `reserve` and the tail are not here. */
export const WHOLE_PARAM_WRITABLE = Object.freeze([
  WHOLE_PARAM_FIELD.TOUCH_OPTIMIZE,
  WHOLE_PARAM_FIELD.DEAD_DOWN,
  WHOLE_PARAM_FIELD.DEAD_UP,
  WHOLE_PARAM_FIELD.POLLING_RATE,
  WHOLE_PARAM_FIELD.SHAKE_LEVEL,
  WHOLE_PARAM_FIELD.CALIBRATION,
  WHOLE_PARAM_FIELD.SPORTS_MODE,
  WHOLE_PARAM_FIELD.CURRENT_LAYER,
]);

const readU16 = (b, at) => (b[at] & 0xff) | ((b[at + 1] & 0xff) << 8);
const writeU16 = (b, at, v) => {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
};

/** Decode a `0x5E` response payload into named settings. */
export function parseWholeParams(payload) {
  if (!payload || payload.length < WHOLE_PARAM_LEN) {
    throw new RangeError(
      `whole-parameter payload is ${payload ? payload.length : 0} bytes, expected ${WHOLE_PARAM_LEN}`);
  }
  const deadDown = readU16(payload, WHOLE_PARAM_FIELD.DEAD_DOWN);
  const deadUp = readU16(payload, WHOLE_PARAM_FIELD.DEAD_UP);
  return {
    reserve: payload[WHOLE_PARAM_FIELD.RESERVE],
    touchOptimize: payload[WHOLE_PARAM_FIELD.TOUCH_OPTIMIZE],
    deadDown,
    deadUp,
    pollingRate: payload[WHOLE_PARAM_FIELD.POLLING_RATE],
    shakeLevel: payload[WHOLE_PARAM_FIELD.SHAKE_LEVEL],
    calibration: payload[WHOLE_PARAM_FIELD.CALIBRATION],
    sportsMode: payload[WHOLE_PARAM_FIELD.SPORTS_MODE],
    currentLayer: payload[WHOLE_PARAM_FIELD.CURRENT_LAYER],
    // Retained so a round trip is byte-identical even if a future firmware uses
    // bytes this decoding does not name.
    bytes: Array.from(payload).slice(0, WHOLE_PARAM_LEN),
  };
}

/**
 * Build a `0x50` payload, preserving every byte the caller did not ask to change.
 *
 * `readback` must come from `0x5E`. Anything not named in `changes` is copied
 * verbatim, so a single-setting change cannot silently reset the other seven —
 * the same read-modify-write discipline the `0x13` path uses.
 */
export function buildWholeParams(readback, changes = {}) {
  const out = Uint8Array.from(parseWholeParams(readback).bytes);
  // Accept `pollingRate` or `POLLING_RATE`; the caller's spelling should not be
  // a second way to get this wrong.
  const byName = new Map(Object.entries(WHOLE_PARAM_FIELD)
    .map(([name, off]) => [name.toLowerCase().replace(/_/g, ''), off]));
  for (const [key, value] of Object.entries(changes)) {
    const field = byName.get(key.toLowerCase().replace(/_/g, ''));
    if (field === undefined) throw new RangeError(`unknown whole-parameter field "${key}"`);
    if (!WHOLE_PARAM_WRITABLE.includes(field)) {
      throw new RangeError(`"${key}" is not a host-settable field (offset ${field})`);
    }
    const width = field === WHOLE_PARAM_FIELD.DEAD_DOWN || field === WHOLE_PARAM_FIELD.DEAD_UP ? 2 : 1;
    if (!Number.isInteger(value) || value < 0 || value > (width === 2 ? 0xffff : 0xff)) {
      throw new RangeError(
        `${key} must be an integer 0..${width === 2 ? 0xffff : 0xff}, got ${value}`);
    }
    if (width === 2) writeU16(out, field, value);
    else out[field] = value & 0xff;
  }
  return out;
}

export function commandClass(cmd) {
  return COMMAND_CLASS[cmd] ?? 'unknown';
}

/**
 * Receive dispatch — verified from assembly, PROTOCOL.md section 4.
 *
 * The Windows app indexes a 98-byte table at `opcode - 0x90`, then jumps
 * through a 40-entry jump table. Values 0x00-0x27 are all live handler slots and
 * each is used exactly once; 0x28 is the only sentinel and is the default entry.
 * So there are 40 dispatched responses, not 39, and no opcode is silently
 * ignored.
 */
export const RESPONSE_DISPATCH = {
  0x90: 'set_custom_light',
  0x91: 'set_custom_light_all',
  0x93: 'set_effect_light',
  0x94: 'set_effect_light_all',
  0x96: 'get_custom_light_all',
  0x97: 'get_effect_light',
  0x98: 'get_effect_light_name',
  0x99: 'select_effect_light',
  0xa0: 'set_key',
  0xa1: 'set_key_function',
  0xa2: 'set_high_key',
  0xa3: 'set_high_key_more',
  0xa4: 'set_key_default',
  0xa5: 'del_high_key',
  0xa6: 'set_trigger',
  0xa7: 'set_quick_trigger',
  0xa8: 'set_trigger_all',
  0xaa: 'get_key_config',
  0xab: 'get_high_key_config',
  0xac: 'get_trigger_config',
  0xc0: 'set_macro',
  0xc1: 'del_macro',
  0xc2: 'get_macro_all',
  0xd0: 'set_whole_config',
  0xd1: 'start_calibration',
  0xd2: 'start_calibration_config',
  0xd3: 'open_calibration_time',
  0xd4: 'save_calibration',
  0xd5: 'set_current_config_table',
  0xd6: 'set_config_table_info',
  0xd7: 'get_config_table',
  0xd8: 'add_config_table',
  0xd9: 'del_configure_table',
  0xdb: 'get_calibration_adc',
  0xde: 'get_whole_config',
  0xe0: 'fireware_download',
  0xe1: 'reset',
  0xe2: 'get_product_info',
  0xe3: 'fireware_download_end',
  0xf1: 'config_change',
};

/**
 * Responses the app dispatches but never asks for. `0xF1` is the device's own
 * "state changed, re-read" push; `0xA1` and `0xD1` are handled-but-unsent
 * leftovers. None of these should ever be awaited.
 */
export const UNSOLICITED_RESPONSES = new Set([0xa1, 0xd1, 0xf1]);

/**
 * Requests the app can build that get *no* dispatched reply. The firmware
 * download-data pair fall through to the default handler, so a driver that
 * blocks on 0xE5 or 0xE6 hangs forever.
 */
export const REQUESTS_WITHOUT_RESPONSE = new Set([0x65, 0x66]);

/**
 * Response opcode for a request: `request + 0x80`.
 *
 * Verified on all 37 requests that have a dispatched reply, with no exceptions.
 * Returns null for the two firmware-data requests, which are answered by
 * nothing the app dispatches.
 */
export function responseOpcode(cmd) {
  if (REQUESTS_WITHOUT_RESPONSE.has(cmd)) return null;
  return (cmd + 0x80) & 0xff;
}

/** True when `cmd` is expected to be answered by the device. */
export function awaitsResponse(cmd) {
  const r = responseOpcode(cmd);
  return r !== null && RESPONSE_DISPATCH[r] !== undefined;
}

/** True when `opcode` is a device-initiated push rather than a reply. */
export function isUnsolicited(opcode) {
  return UNSOLICITED_RESPONSES.has(opcode);
}

/**
 * Opcodes the app deliberately never exposes to its own UI. Kept here so the
 * driver can refuse them by name rather than only by number.
 *
 *  - RESET_KEYBOARD is the FACTORY RESET: fixed payload 5A A5. Nothing else
 *    recovers a corrupted configuration.
 *  - The firmware-download family writes bootloader state.
 */
export const FORBIDDEN_COMMANDS = new Set([
  CMD.RESET_KEYBOARD,
  CMD.DOWNLOAD_FIRMWARE_KEYBOARD,
  CMD.DOWNLOAD_FIRMWARE_DATA,
  CMD.DOWNLOAD_FIRMWARE_DATA_END,
]);

/**
 * The six advanced per-key modifiers implemented by the Windows app's
 * HighKeyForm, with the record type code each one writes.
 *
 * The type code is NOT in the same order as the labels. Established by
 * disassembling each add-dialog's descriptor initialiser:
 *
 *   QTglAddDialog   mov DWORD [rdi+0x40],0xffff00ff  -> byte1 = 0
 *   QMtAddDialog    mov DWORD [rdi+0x40],0x000001ff  -> byte1 = 1
 *   QDksAddDialog   mov DWORD [rdi+0x40],0x00ff02ff  -> byte1 = 2
 *   QRsoAddDialog   mov DWORD [rdi+0x40],0x000003ff  -> byte1 = 3
 *   QOksAddDialog   mov DWORD [rdi+0x40],0x000004ff  -> byte1 = 4
 *   QSocdAddDialog  mov DWORD [rdi+0x40],0x000005ff  -> byte1 = 5
 *
 * Byte 0 of each initialiser is 0xFF, meaning "no key selected yet". Byte 2 is
 * 0xFF in all of them, and the SOCD dialog additionally writes 0xFF at +0x43 and
 * a mode 0..3 at +0x44.
 *
 * Record length by type comes from the branch table in the `0x22` frame builder.
 */
export const KEY_MODIFIERS = {
  TGL: { id: 0x00, name: 'tgl', label: 'Toggle', dialog: 'QTglAddDialog', recordLen: 6, dataLen: 4 },
  MT: { id: 0x01, name: 'mt', label: 'Hold / Click', dialog: 'QMtAddDialog', recordLen: 11, dataLen: 9 },
  DKS: { id: 0x02, name: 'dks', label: 'Dynamic Key Stroke', dialog: 'QDksAddDialog', recordLen: 19, dataLen: 17 },
  RS: { id: 0x03, name: 'rs', label: 'Radial Sensing', dialog: 'QRsoAddDialog', recordLen: 4, dataLen: 2 },
  OKS: { id: 0x04, name: 'oks', label: 'Key Override on Release', dialog: 'QOksAddDialog', recordLen: 4, dataLen: 2 },
  SOCD: { id: 0x05, name: 'socd', label: 'Simultaneous Opposing Cardinal Directions', dialog: 'QSocdAddDialog', recordLen: 5, dataLen: 3 },
};

/** Reverse lookup: type code -> modifier spec. */
export const MODIFIER_BY_TYPE = Object.fromEntries(
  Object.values(KEY_MODIFIERS).map((m) => [m.id, m]),
);

/**
 * `0x22 addHighKey` total record length (including the 2-byte key+type prefix)
 * by modifier type. Recovered from the frame builder's branch on sender+0x24B.
 * Type 3 was not extracted and is deliberately absent: guessing its length would
 * produce a malformed frame. See PROTOCOL.md 8.3.1.
 */
export const HIGH_KEY_LENGTH = {
  0: 6,
  1: 11,
  2: 19,
  3: 4,
  4: 4,
  5: 5,
};

/**
 * Build an `0x22` high-key record.
 *
 * @param {{key: number, type: number, data?: number[]|Uint8Array}} binding
 * @returns {Uint8Array} exactly HIGH_KEY_LENGTH[type] bytes
 */
export function buildHighKeyRecord({ key, type, data = [] }) {
  const total = HIGH_KEY_LENGTH[type];
  if (total === undefined) {
    throw new RangeError(
      `high-key type ${type} has no decoded record shape ` +
      `(known: ${Object.keys(HIGH_KEY_LENGTH).join(', ')})`);
  }
  const payload = new Uint8Array(2 + data.length);
  payload[0] = key & 0xff;
  payload[1] = type & 0xff;
  payload.set(Uint8Array.from(data), 2);
  if (payload.length !== total) {
    throw new RangeError(
      `type ${type} needs ${total} bytes total (${total - 2} data bytes), got ${payload.length}`);
  }
  return payload;
}

/**
 * Build an `0x22` high-key record for a named modifier.
 *
 * @param {{modifier: keyof KEY_MODIFIERS, key: number,
 *          data?: number[]|Uint8Array}} binding
 * @returns {{record: Uint8Array, type: number, modifier: object}}
 */
export function buildHighKeyBinding({ modifier, key, data = [] }) {
  const spec = KEY_MODIFIERS[modifier] ?? KEY_MODIFIERS[String(modifier).toUpperCase()];
  if (!spec) {
    throw new RangeError(
      `unknown modifier "${modifier}"; expected one of ${Object.keys(KEY_MODIFIERS).join(', ')}`);
  }
  const record = buildHighKeyRecord({ key, type: spec.id, data });
  return { record, type: spec.id, modifier: spec };
}

/**
 * Build a SOCD record. This one is fully decoded.
 *
 * Layout, from `QSocdAddDialog` initialising `[rdi+0x40] = 0x5ff` (byte 0 = 0xFF
 * for "no key", byte 1 = 0x05 for the type) and then writing `0xFF` to `+0x43`
 * and the mode to `+0x44`:
 *
 *   [0] key     the bound key
 *   [1] 0x05    SOCD type
 *   [2] key1    0xFF when unset
 *   [3] key2    0xFF when unset
 *   [4] mode    0..3
 *
 * @param {{key: number, key1?: number, key2?: number, mode?: number}} opts
 */
export function buildSocdRecord({ key, key1 = 0xff, key2 = 0xff, mode = 0 }) {
  if (!SOCD_MODES.some((m) => m.id === mode)) {
    throw new RangeError(`SOCD mode must be 0..3, got ${mode}`);
  }
  const spec = KEY_MODIFIERS.SOCD;
  return buildHighKeyRecord({
    key, type: spec.id,
    data: [key1 & 0xff, key2 & 0xff, mode & 0xff],
  });
}

/** Byte layout of a decoded `0x22` record, for interpreting a `0x2B` readback. */
export function parseHighKeyRecord(rec) {
  if (!rec || rec.length < 2) throw new RangeError('need at least 2 bytes');
  const type = rec[1];
  const spec = MODIFIER_BY_TYPE[type] ?? null;
  return {
    key: rec[0],
    type,
    modifier: spec ? spec.name : `unknown_${type}`,
    label: spec ? spec.label : `unknown type ${type}`,
    length: rec.length,
    expectedLength: spec ? spec.recordLen : null,
    lengthOk: spec ? rec.length === spec.recordLen : null,
    data: Array.from(rec.subarray(2)),
  };
}

/** The four SOCD resolution modes offered by QSocdAddDialog. */
export const SOCD_MODES = [
  { id: 0, label: 'Last key wins' },
  { id: 1, label: 'Key1 wins' },
  { id: 2, label: 'Key2 wins' },
  { id: 3, label: 'Both pressed, neither triggers' },
];

/**
 * `0x40 setMacroConfig` record — decoded (PROTOCOL.md 8.10).
 *
 * Frame:
 *   [0]=0xFA [1]=0x40 [2]=order [3]=frame [4]=0x00 [5]=LEN
 *   [6]=sender+0x108   the macro SLOT, 0..9 (M1..M10)
 *   [7]=count of records in this page
 *   [8..]=count records, 6 bytes each
 *
 * `LEN = 6 * count + 2`, computed as `((count*3)*2) + 2` in the builder — which is
 * itself proof the record is 6 bytes and not the 16 the sender's stride suggests.
 *
 * Each record's bytes 0 and 1 are **transposed** on the wire. All ten slot
 * dispatch blocks emit the identical permutation, so this is a property of the
 * command, not of any slot.
 */
export const MACRO_SLOT_MIN = 0;
export const MACRO_SLOT_MAX = 9;
export const MACRO_RECORD_LEN = 6;

/** Wire index -> sender record index. */
export const MACRO_WIRE_ORDER = [1, 0, 2, 3, 4, 5];

/**
 * Named fields of the 6-byte macro record, in *struct* order.
 *
 * Recovered from the `key_macro_table` DDL in the binary, which the app uses to
 * persist this exact data, cross-checked by binding each column to the byte it
 * reads (PROTOCOL.md 8.12). `time` is the one field that is not a single byte:
 * it is a 16-bit little-endian value at offset 4, which is why the record is 6
 * bytes and not 5.
 */
export const MACRO_FIELD = {
  TYPE: 0, STATE: 1, LVALUE: 2, HVALUE: 3, TIME_LO: 4, TIME_HI: 5,
};

/** `state` values: 1 = key down, 0 = key up. */
export const MACRO_STATE = { UP: 0, DOWN: 1 };

/** Largest delay a `time` field can express (u16, milliseconds). */
export const MACRO_TIME_MAX = 0xffff;

/**
 * Decode one 6-byte macro record (struct order) into named fields.
 *
 * `usage` is the reconstructed 16-bit HID code: `hValue << 8 | lValue`. This is
 * the same low/high split the app uses for `keyboard_fn_table`, so it is a HID
 * usage, not two unrelated bytes.
 */
export function decodeMacroRecord(rec) {
  const b = Array.from(rec);
  if (b.length !== MACRO_RECORD_LEN) {
    throw new RangeError(`macro record is ${b.length} bytes, expected ${MACRO_RECORD_LEN}`);
  }
  const lValue = b[MACRO_FIELD.LVALUE];
  const hValue = b[MACRO_FIELD.HVALUE];
  return {
    bytes: b,
    type: b[MACRO_FIELD.TYPE],
    state: b[MACRO_FIELD.STATE],
    lValue,
    hValue,
    usage: (hValue << 8) | lValue,
    time: b[MACRO_FIELD.TIME_LO] | (b[MACRO_FIELD.TIME_HI] << 8),
  };
}

/**
 * Build one 6-byte macro record (struct order) from named fields.
 *
 * `usage` is taken whole and split here, so a caller cannot build a record whose
 * `lValue`/`hValue` disagree with the usage it believes it sent.
 */
export function encodeMacroRecord({ type = 0, state = MACRO_STATE.DOWN, usage = 0, time = 0 }) {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new RangeError(`macro type must be 0..255, got ${type}`);
  }
  if (!Number.isInteger(state) || state < 0 || state > 0xff) {
    throw new RangeError(`macro state must be 0..255, got ${state}`);
  }
  if (!Number.isInteger(usage) || usage < 0 || usage > 0xffff) {
    throw new RangeError(`macro usage must be 0..65535, got ${usage}`);
  }
  if (!Number.isInteger(time) || time < 0 || time > MACRO_TIME_MAX) {
    throw new RangeError(`macro delay must be 0..${MACRO_TIME_MAX} ms, got ${time}`);
  }
  return [
    type & 0xff, state & 0xff, usage & 0xff, (usage >> 8) & 0xff,
    time & 0xff, (time >> 8) & 0xff,
  ];
}

/**
 * Build an `0x40` payload for `count` macro records.
 *
 * The record's six bytes are passed through in struct order; this function
 * applies the transposition. The six bytes are now named - see
 * {@link decodeMacroRecord} - so build records with `encodeMacroRecord` and this
 * function will carry them across unchanged.
 *
 * @param {{slot: number, records: (number[]|Uint8Array)[]}} opts
 * @returns {Uint8Array}
 */
export function buildMacroPayload({ slot, records = [] }) {
  if (!Number.isInteger(slot) || slot < MACRO_SLOT_MIN || slot > MACRO_SLOT_MAX) {
    throw new RangeError(
      `macro slot must be ${MACRO_SLOT_MIN}..${MACRO_SLOT_MAX} (M1..M10), got ${slot}`);
  }
  if (records.length > 255) throw new RangeError('at most 255 records per frame');
  for (const [i, r] of records.entries()) {
    if (r.length !== MACRO_RECORD_LEN) {
      throw new RangeError(
        `record ${i} is ${r.length} bytes; macro records are exactly ${MACRO_RECORD_LEN}`);
    }
  }
  const payload = new Uint8Array(2 + records.length * MACRO_RECORD_LEN);
  payload[0] = slot & 0xff;
  payload[1] = records.length & 0xff;
  records.forEach((rec, i) => {
    for (let j = 0; j < MACRO_RECORD_LEN; j++) {
      payload[2 + i * MACRO_RECORD_LEN + j] = rec[MACRO_WIRE_ORDER[j]] & 0xff;
    }
  });
  return payload;
}

/** Invert {@link MACRO_WIRE_ORDER}, turning a `0x42` readback back into struct order. */
export function parseMacroRecords(payload) {
  if (!payload || payload.length < 2) throw new RangeError('need a slot and a count byte');
  const slot = payload[0];
  const count = payload[1];
  const body = payload.subarray(2);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = i * MACRO_RECORD_LEN;
    if (off + MACRO_RECORD_LEN > body.length) {
      out.push({ error: `truncated: record ${i} needs ${MACRO_RECORD_LEN}, have ${body.length - off}` });
      break;
    }
    const rec = new Uint8Array(MACRO_RECORD_LEN);
    for (let j = 0; j < MACRO_RECORD_LEN; j++) rec[j] = body[off + MACRO_WIRE_ORDER[j]];
    // Every byte of the record is named, so surface the fields alongside the raw
    // bytes. `bytes` stays available for round-tripping a record whose `type` this
    // app has no name for yet.
    out.push({ slot, index: i, ...decodeMacroRecord(rec) });
  }
  return { slot, count, records: out };
}

/**
 * HID usage IDs for the keys this board exposes, mapped to the names the
 * Windows app uses in `data/tip_file_en.ini`.
 *
 * The keymap read by `0x2A` is a table of 3-byte records; the third byte is a
 * HID usage ID. This is the subset worth naming — the rest fall through to a
 * numeric label rather than being silently wrong.
 */
export const KEY_NAMES = {
  0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F', 0x0a: 'G',
  0x0b: 'H', 0x0c: 'I', 0x0d: 'J', 0x0e: 'K', 0x0f: 'L', 0x10: 'M', 0x11: 'N',
  0x12: 'O', 0x13: 'P', 0x14: 'Q', 0x15: 'R', 0x16: 'S', 0x17: 'T', 0x18: 'U',
  0x19: 'V', 0x1a: 'W', 0x1b: 'X', 0x1c: 'Y', 0x1d: 'Z',
  0x1e: '1', 0x1f: '2', 0x20: '3', 0x21: '4', 0x22: '5', 0x23: '6', 0x24: '7',
  0x25: '8', 0x26: '9', 0x27: '0',
  0x28: 'Enter', 0x29: 'Esc', 0x2a: 'BackSpace', 0x2b: 'Tab', 0x2c: 'Space',
  0x2d: '-', 0x2e: '=', 0x2f: '[', 0x30: ']', 0x31: '\\', 0x33: ';', 0x34: "'",
  0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/', 0x39: 'CapsLock',
  0x3a: 'F1', 0x3b: 'F2', 0x3c: 'F3', 0x3d: 'F4', 0x3e: 'F5', 0x3f: 'F6',
  0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11', 0x45: 'F12',
  0x46: 'PrintScreen', 0x47: 'Lock', 0x48: 'Pause', 0x49: 'Insert',
  0x4a: 'Home', 0x4b: 'PageUp', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'PageDown',
  0x4f: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up',
  // Keypad usages repeat the main-block labels, so they are prefixed to keep a
  // <select> unambiguous. 0x53 NumLock keeps its own name; 0x57 is the keypad
  // plus key and has no separate HID usage.
  0x53: 'NumLock', 0x54: 'Num /', 0x55: 'Num *', 0x56: 'Num -', 0x57: 'Num +',
  0x58: 'Num Enter', 0x59: 'Num1', 0x5a: 'Num2', 0x5b: 'Num3', 0x5c: 'Num4',
  0x5d: 'Num5', 0x5e: 'Num6', 0x5f: 'Num7', 0x60: 'Num8', 0x61: 'Num9',
  0x62: 'Num0', 0x63: 'Num .', 0x64: 'Menu',
  0xe0: 'LeftCtrl', 0xe1: 'LeftShift', 0xe2: 'LeftAlt', 0xe4: 'LeftWin',
  0xe5: 'RightCtrl', 0xe6: 'RightShift', 0xe7: 'RightAlt', 0xe8: 'RightWin',
};

/** Best-effort name for a HID usage ID. Never wrong: unknown codes stay numeric. */
export function keyName(code) {
  return KEY_NAMES[code] ?? `0x${(code & 0xff).toString(16).padStart(2, '0')}`;
}

/**
 * Named keys as `{code, name}` pairs, sorted by name, for a `<select>`.
 *
 * Only keys in {@link KEY_NAMES} appear. An unmapped usage is still writable as
 * a raw number, but it is not offered as a named choice - inventing a label for
 * a usage the app never names would be worse than omitting it.
 */
export function keyOptions() {
  // Sorted by usage code, not by name: that is HID's own order, so the list
  // reads as modifiers, letters, digits, punctuation, then function keys.
  return Object.keys(KEY_NAMES)
    .map((k) => ({ code: Number(k), name: KEY_NAMES[k] }))
    .sort((a, b) => a.code - b.code);
}

/** True when every label in {@link keyOptions} is unique, so a picker is unambiguous. */
export function keyLabelsUnique() {
  const seen = new Set();
  for (const { name } of keyOptions()) {
    if (seen.has(name)) return false;
    seen.add(name);
  }
  return true;
}

/**
 * Decode a `0x2A` keymap readback into per-key records.
 *
 * Records are 3 bytes. The third byte is the HID usage ID — confirmed on
 * hardware by the run `0x29, 0x3a, 0x3b, 0x3c … 0x42`, which is exactly the
 * standard usage-ID sequence for `) : ; < = > ? @ A B`.
 *
 * @param {Uint8Array[]} pages payloads from `readKeyConfig()`
 * @param {number} [recordSize]
 */
export const KEYMAP_RECORD_LEN = 3;

/**
 * Which record byte lands in which wire byte.
 *
 * The 0x20 builder at 0x1400a87a0 writes rec[1], rec[3], rec[2] and advances by
 * 3, so the wire is schema order *permuted* - not schema order with keyItem
 * dropped. Exported as data so the spec can be checked against it rather than
 * re-described in prose that can drift.
 */
export const KEYMAP_WIRE_PERMUTATION = Object.freeze([1, 3, 2]);

/** Record index sent once, for the first entry only, immediately after LEN. */
export const KEYMAP_KEYITEM_ONCE = 0;

/** `custom_light_table` is (keyItem, light, colorR, colorG, colorB). */
export const CUSTOM_LIGHT_WRITE_RECORD_LEN = 4;

/**
 * Build a `0x11` payload: one leading byte, then a colour quad per key.
 *
 * The leading byte is **the first entry's `keyItem`**, not a flag. The builder at
 * `0x1400a66e7` emits exactly the same construct `0x20` uses:
 *
 *   0x1400a67c9: test   edi,edi
 *   0x1400a67cb: jne    0x1400a67db
 *   0x1400a67cd: mov    rax, QWORD PTR [rbx+0x28]   ; the entry's record
 *   0x1400a67d5: movzx  eax, BYTE PTR [rax]          ; its byte 0
 *   0x1400a67d8: mov    BYTE PTR [rcx+0x6], al       ; payload byte 0
 *   0x1400a67e3: movzx  eax, BYTE PTR [rax+0x1]      ; then bytes 1..4 per key
 *
 * and the loop advances by 4, emitting bytes 1,2,3,4 = light, R, G, B.
 *
 * PROTOCOL.md 8.13.1 previously called this byte "a global flag" on the grounds
 * that `keyItem` was already accounted for positionally. That reasoning is
 * backwards: `0x20` demonstrates the app *does* send the first entry's keyItem as
 * a header byte even when every later entry is positional. An earlier revision of
 * this file carried the same wrong claim.
 */
export function buildCustomLightPayload(records) {
  if (!records.length) throw new RangeError('a custom-light write needs at least one key');
  const out = new Uint8Array(1 + records.length * CUSTOM_LIGHT_WRITE_RECORD_LEN);
  out[0] = records[0].keyItem;
  records.forEach((r, i) => {
    const at = 1 + i * CUSTOM_LIGHT_WRITE_RECORD_LEN;
    out[at] = r.light;
    out[at + 1] = r.r;
    out[at + 2] = r.g;
    out[at + 3] = r.b;
  });
  return out;
}

/** The LEN byte `0x11` writes: `shl cl,0x2 ; inc cl`. */
export function customLightPayloadLen(count) {
  return 4 * count + 1;
}

/**
 * Keymap layer: the byte at `sender+0xC0`, sent as payload byte 0 by all three
 * keymap commands - `0x2A` get, `0x20` set, `0x24` set-flat.
 *
 * This is the byte previously recorded as "unnamed" at `sender+0xC0`, the single
 * item gating `0x20` (PROTOCOL.md 8.15). It is the layer, and it has exactly two
 * legal values.
 *
 * Evidence, from `sub_1400a87a0`:
 *   0x1400a8844: movzx eax, BYTE PTR [rbx+0xc0]
 *   0x1400a884b: mov    BYTE PTR [rcx+6], al   ; payload byte 0, USB
 *   0x1400a8857: jne   0x1400a8969              ; non-zero -> other container
 *   0x1400a885d: lea   r15, [rbx+0xc8]          ; layer 0 container
 *   0x1400a8969: cmp   al, 0x1
 *   0x1400a896b: jne   0x1400a8a74              ; anything >= 2 leaves the body empty
 *   0x1400a8971: lea   r15, [rbx+0xd0]          ; layer 1 container
 *
 * `0x2A` (0x1400a3398) and `0x24` (0x1400a91ac) read the same field and forward it
 * to the same payload position; `0x24` performs no validation, `0x20` rejects
 * values above 1.
 *
 * Corroboration rather than proof: exactly two identically-shaped keymap tables
 * exist, `keyboard_fn_table` and `keyboard_fn1_table` (8.18.1), and the two
 * containers it selects are 8 bytes apart. Those two containers are members of a
 * larger block of 16 cleared together by `sub_14008ae60`, so they are not a
 * dedicated pair and this project has *not* proven `+0xC8` is `keyboard_fn_table`
 * specifically. The naming rests on the wire position, the 0/1 validation, and the
 * two-table structure.
 */
export const KEYMAP_LAYER_MIN = 0;
export const KEYMAP_LAYER_MAX = 1;

/** True for a layer the app will actually send. Values above 1 empty the body. */
export function isValidKeymapLayer(layer) {
  return Number.isInteger(layer) && layer >= KEYMAP_LAYER_MIN && layer <= KEYMAP_LAYER_MAX;
}

/**
 * Build a `0x20` payload.
 *
 * Layout, from the same builder:
 *   [0]      layer
 *   [1]      first entry's keyItem, sent once
 *   [2..]    type, lValue, hValue per entry, in KEYMAP_WIRE_PERMUTATION order
 *
 * and `LEN` is `3*count + 2`, which is exactly the payload length - the two
 * header bytes plus three per key. Computed rather than trusted:
 * `add al,al` / `add cl,al` at 0x1400a8830-37.
 */
export function buildKeymapPayload(records, layer) {
  if (!isValidKeymapLayer(layer)) {
    throw new RangeError(`keymap layer must be ${KEYMAP_LAYER_MIN}..${KEYMAP_LAYER_MAX}, got ${layer}`);
  }
  if (!records.length) throw new RangeError('a keymap write needs at least one key');
  const out = new Uint8Array(2 + records.length * KEYMAP_RECORD_LEN);
  out[0] = layer;
  out[1] = records[0].keyItem;
  records.forEach((r, i) => {
    const at = 2 + i * KEYMAP_RECORD_LEN;
    out[at] = r.type;
    out[at + 1] = r.lValue;
    out[at + 2] = r.hValue;
  });
  return out;
}

/** The LEN byte `0x20` writes, derived rather than assumed. */
export function keymapPayloadLen(count) {
  return 3 * count + 2;
}

/**
 * Column name for each wire byte, indexed by wire position.
 *
 * Indexed by WIRE position, not record index - that distinction is the whole
 * finding, so the table is written in wire order to make the swap impossible to
 * read past.
 */
export const KEYMAP_WIRE_FIELD = Object.freeze(["type", "lValue", "hValue"]);

/**
 * Decode `0x2A` keymap pages.
 *
 * The app's own record for a keymap entry is four bytes -
 * `keyItem, type, hValue, lValue` - and that order is confirmed in both
 * directions from assembly (PROTOCOL.md 8.19): `sub_14008d7d0` reads the four
 * columns in DDL order into `[r12+0..3]`, and `sub_140087bd0` binds
 * `[rax+0..3]` back to `aKeyitem`/`aType`/`aHvalue`/`aLvalue`.
 *
 * On the wire the remaining three bytes are **permuted**, not in schema order:
 * the 0x20 builder writes `rec[1], rec[3], rec[2]`, so byte 1 is `lValue` and
 * byte 2 is `hValue` (8.18.5). `keyItem` is sent once, for the first entry only,
 * and is otherwise implied by position (8.13).
 *
 * These names replaced `modifier`/`layer`/`usage`, which were guesses and two of
 * which were actively wrong. There is no per-record *layer*: the layer is a
 * parameter of the whole read, so a byte that looked like a layer index was not
 * one. There is no per-record *modifier* either.
 *
 * `hValue` carries the HID usage ID, which is what `keyName` reads. `lValue` is
 * observed constant `0x01`. Reading the wire as the DDL minus keyItem would put
 * the usage in `lValue` and make a 16-bit usage of `0x01xx`, which is not a HID
 * usage for any key - the permutation is what resolves that (8.18.3).
 */
export function parseKeymap(pages, recordSize = KEYMAP_RECORD_LEN) {
  const flat = [];
  for (const p of pages) for (const b of p) flat.push(b);
  const out = [];
  for (let i = 0; i + recordSize <= flat.length; i += recordSize) {
    // Wire order is NOT schema order. The 0x20 builder emits the three
    // non-keyItem bytes as rec[1], rec[3], rec[2] (PROTOCOL.md 8.18.5), and the
    // bind code puts rec[2] = hValue and rec[3] = lValue. So byte 1 is lValue
    // and byte 2 is hValue - the reverse of reading the DDL and dropping
    // keyItem, which is what an earlier version of this parser did.
    const type = flat[i];
    const lValue = flat[i + 1];
    const hValue = flat[i + 2];
    out.push({
      // Position is the keyItem the record is bound to. 0x20 sends the FIRST
      // entry's keyItem once, right after LEN, and leaves the rest positional.
      keyItem: i / recordSize,
      index: i / recordSize,
      raw: [type, lValue, hValue],
      type,
      lValue,
      hValue,
      usage: hValue,
      name: keyName(hValue),
    });
  }
  return out;
}

/** Effect index range the device validates. Anything else is rejected with status 07. */
export const EFFECT_MIN = 0;
export const EFFECT_MAX = 11;

/** Brightness is a percentage, not a 0-255 level. PROTOCOL.md section 6. */
export const BRIGHTNESS_MIN = 0;
export const BRIGHTNESS_MAX = 100;

/** Speed is an interval: the slider range is setRange(1, 100) and higher is slower. */
export const SPEED_MIN = 1;
export const SPEED_MAX = 100;

/**
 * Requests whose response opcode has no handler in the Windows app, so replies
 * land in the default branch and stay unnamed. These are the two firmware-data
 * opcodes; the matching 0xE5 / 0xE6 slots appear in UNHANDLED_RESPONSES.
 */
export const ORPHAN_REQUESTS = [CMD.DOWNLOAD_FIRMWARE_DATA, CMD.DOWNLOAD_FIRMWARE_DATA_END];

/** Human-readable names, keyed by opcode (request and response share a namespace). */
export const OPCODE_NAME = {
  0x10: 'set_custom_light',
  0x11: 'set_effect_light_all',
  0x13: 'set_effect_light',
  0x14: 'set_effect_light_all_2',
  0x16: 'get_custom_light',
  0x17: 'get_effect_light',
  0x18: 'get_effect_light_name',
  0x19: 'select_effect_light',
  0x20: 'set_keyboard_config',
  0x22: 'add_high_key',
  0x23: 'set_high_key',
  0x24: 'set_keyboard_config_2',
  0x25: 'del_high_key',
  0x26: 'set_trigger_config',
  0x27: 'set_quick_trigger_config',
  0x28: 'set_trigger_config_all',
  0x2a: 'get_keyboard_config',
  0x2b: 'get_high_key',
  0x2c: 'get_trigger_config',
  0x40: 'set_macro_config',
  0x41: 'del_macro_config',
  0x42: 'get_macro_config',
  0x50: 'set_whole_param',
  0x52: 'get_calibration_state',
  0x53: 'set_report_calibration',
  0x54: 'save_calibration',
  0x55: 'switch_config_table',
  0x56: 'set_config_info',
  0x57: 'get_config_info',
  0x58: 'add_config_table',
  0x59: 'del_config_table',
  0x5b: 'get_calibration_adc',
  0x5e: 'get_whole_param',
  0x60: 'download_firmware_keyboard',
  0x61: 'reset_keyboard',
  0x62: 'get_product_info',
  0x63: 'firmware_keyboard_end',
  0x65: 'download_firmware_data',
  0x66: 'download_firmware_data_end',

  0x90: 'set_custom_light',
  0x91: 'set_custom_light_all',
  0x93: 'set_effect_light',
  0x94: 'set_effect_light_all',
  0x96: 'get_custom_light_all',
  0x97: 'get_effect_light',
  0x98: 'get_effect_light_name',
  0x99: 'select_effect_light',
  0xa0: 'set_key',
  0xa1: 'set_key_function',
  0xa2: 'set_high_key',
  0xa3: 'set_high_key_more',
  0xa4: 'set_key_default',
  0xa5: 'del_high_key',
  0xa6: 'set_trigger',
  0xa7: 'set_quick_trigger',
  0xa8: 'set_trigger_all',
  0xaa: 'get_key_config',
  0xab: 'get_high_key_config',
  0xac: 'get_trigger_config',
  0xc0: 'set_macro',
  0xc1: 'del_macro',
  0xc2: 'get_macro_all',
  0xd0: 'set_whole_config',
  0xd1: 'start_calibration',
  0xd2: 'start_calibration_config',
  0xd3: 'open_calibration_time',
  0xd4: 'save_calibration',
  0xd5: 'set_current_config_table',
  0xd6: 'set_config_table_info',
  0xd7: 'get_config_table',
  0xd8: 'add_config_table',
  0xd9: 'del_configure_table',
  0xdb: 'get_calibration_adc',
  0xde: 'get_whole_config',
  0xe0: 'firmware_download',
  0xe1: 'reset',
  0xe2: 'get_product_info',
  0xe3: 'firmware_download_end',
  0xf1: 'config_change',
};

/** Requests with no observed handler. */
export const UNHANDLED_RESPONSES = new Set([
  0x92, 0x95, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa9, 0xad, 0xae, 0xaf,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb,
  0xbc, 0xbd, 0xbe, 0xbf, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xda, 0xdc, 0xdd, 0xdf, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xf0,
]);

/** Hall-effect ranges from the product table (`trigger`/`qtt`/`qrt`). */
export const LIMITS = {
  trigger: { min: 10, max: 359 },
  quickTriggerRelease: { min: 4, max: 330 },
  quickTriggerReset: { min: 4, max: 330 },
};

/** APEX product record from `gameboard.db3`. */
export const PRODUCT = {
  key: 'APEX',
  serialNumber: 1028,
  keyNumber: 85,
  trigger: LIMITS.trigger,
};

/**
 * Response paging. The device does **not** stream a multi-page answer: it sends
 * page `n` only when asked for it. `param1` is the zero-based page number, and the
 * response header's `frame`/`total` fields report the progress.
 *
 * Observed on real hardware:
 *   - `0x18` (effect names):   4 pages, page 0 is a 16-byte blob, pages 1..3 carry
 *                              3 names each in 18-byte fields
 *   - `0x16` (custom light):   6 pages
 *   - `0x2A` (key config):     5 pages, 3-byte records `[keycodeHi? ...]`
 *   - `0x2C` (trigger config): 12 pages, 7-byte records; first byte of each page
 *                              is `page * 7`
 *   - `0x5B` (calibration ADC):3 pages, 16-bit little-endian ADC per key
 *   - `0x57` (config table):   5 pages, profile names, e.g. "KeyLayer1"
 *
 * Page 0 of several commands returns a single byte `0x0D` = 13, the effect /
 * profile count.
 */
export const PAGING = {
  END_INDEX: 0x59,
  START_INDEX: 0x5a,
  PAGE_SIZE: 0x5b,
  RECORD_COUNT: 0x5c,
};

/** Width of a name field in the `0x18` effect-name response. */
export const EFFECT_NAME_FIELD = 18;

/** Names per page in the `0x18` response (frames 1..n). */
export const EFFECT_NAMES_PER_PAGE = 3;

/**
 * Effect names read from the keyboard on 2026-10-17.
 *
 * Twelve of the thirteen were returned verbatim by `0x18`. Frame 0 is a 16-byte
 * non-ASCII blob and is still undecoded, so name index 12 is unknown; the count
 * reported by `0x17`/`0x16`/`0x57` is 13 (`0x0D`).
 *
 * `getEffectLightName()` should be preferred over this list at runtime.
 */
export const EFFECT_NAMES = [
  'Close',
  'Static',
  'Layer',
  'Breath',
  'Star',
  'Flow L->R',
  'Flow R->L',
  'Flow Up->Dn',
  'Flow Dn->Up',
  'Dot(Press)',
  'Cross(Press)',
  'Ripple(Press)',
  null, // frame 0 — undecoded
];

/**
 * Parse the `0x18` effect-name payload for one page.
 *
 * Layout (measured on hardware):
 *   [0]      global index of the first name on this page (0, 3, 6, 9 …)
 *   [1]      name-field width, always 0x12 = 18
 *   [2..]    name fields of `width` bytes each, null-terminated, zero padded
 *
 * Page 0 does not follow this shape — it is a 16-byte non-ASCII blob and yields
 * no names.
 *
 * @param {Uint8Array} payload
 * @returns {{index: number, names: string[]}[]}
 */
export function parseEffectNamePage(payload) {
  if (payload.length < 2) return { index: 0, names: [] };
  const width = payload[1];
  if (width < 3 || width > EFFECT_NAME_FIELD) return { index: payload[0], names: [] };
  const base = payload[0];
  const decoder = new TextDecoder();
  const names = [];
  for (let i = 0; 2 + (i + 1) * width <= payload.length; i += 1) {
    const field = payload.subarray(2 + i * width, 2 + (i + 1) * width);
    const nul = field.indexOf(0);
    names.push(decoder.decode(nul === -1 ? field : field.subarray(0, nul)));
  }
  return { index: base, names };
}

/** Convenience wrapper returning just the names from one page. */
export function parseEffectNames(payload) {
  return parseEffectNamePage(payload).names;
}

/**
 * Per-command payload shape, from the decompiled frame builders. Keyed by opcode.
 *
 * `prefix`   fixed bytes emitted at payload start, before the record array.
 * `record`   bytes emitted per record.
 * `none`     the command takes no payload at all (length byte written as 0).
 *
 * The `prefix`/`record` descriptions are the *wire* layout; the source field
 * order within a record is recorded in PROTOCOL.md and is **not** reconstructed
 * here — building these payloads from raw device records is not yet supported.
 */
export const PAYLOAD = {
  [CMD.GET_CALIBRATION_STATE]: { name: 'get_calibration_state', kind: 'none' },
  [CMD.GET_CALIBRATION_ADC]: { name: 'get_calibration_adc', kind: 'none' },
  // 2 prefix bytes (sender +0x260, +0x261) then a run of raw bytes
  [CMD.SET_TRIGGER_CONFIG]: { name: 'set_trigger_config', kind: 'record', prefix: 2, record: 1 },
  // 8 bytes per record; source struct is 16 bytes with byte 1 written as zero
  [CMD.SET_QUICK_TRIGGER_CONFIG]: { name: 'set_quick_trigger_config', kind: 'record', prefix: 0, record: 8 },
  // [count] then 8 bytes per record taken from source offsets 2..9
  [CMD.SET_TRIGGER_CONFIG_ALL]: { name: 'set_trigger_config_all', kind: 'record', prefix: 1, record: 8 },
  // LEN = 3*count + 2: a prefix byte (sender+0xC0), the first record's byte 0,
  // then 3 bytes per record permuted 1,3,2. Source is a QMap at sender+0xC8.
  // See PROTOCOL.md 8.15 - 0x20 and 0x24 are different commands, not two opcodes
  // for one.
  [CMD.SET_KEYBOARD_CONFIG_A]: {
    name: 'set_keyboard_config_a', kind: 'record', prefix: 2, record: 3,
    wireOrder: [1, 3, 2], lenFormula: '3 * count + 2',
    gated: 'prefix byte and record byte 0 unnamed',
  },
  // [sender +0x242, +0x245, +0x246, +0x247] then one key index per key.
  // The trailing byte is NOT a colour: it is the per-key map entry's byte 0,
  // which the app uses as an index into the per-key table at singleton+0xb0.
  // See PROTOCOL.md 8.11.1. Writes stay gated because the app emits an index
  // for every entry in the selected key's *group*, so single-key addressing is
  // not available - see 8.11.2.
  [CMD.SET_CUSTOM_LIGHT]: {
    name: 'set_custom_light', kind: 'record', prefix: 4, record: 1,
    byteMeaning: 'key index', gated: 'group-granular, group ids unnamed',
  },
  // Both take a variable-length payload assembled in a loop. Their shapes are
  // now known from the builder (PROTOCOL.md 8.13) and the app's SQL schema, but
  // each is still missing one leading byte with no known legal values, so they
  // stay gated rather than being exposed with a guessed constant.
  [CMD.SET_CUSTOM_LIGHT_ALL]: {
    name: 'set_custom_light_all', kind: 'columnar',
    headerBytes: 1, record: 4, lenFormula: '4 * count + 1',
    positional: 'key index is implied by ascending QMap order',
    gated: null,
  },
  [CMD.SET_EFFECT_LIGHT_ALL]: {
    name: 'set_effect_light_all', kind: 'record',
    record: 8, lenFormula: '8 * count',
    gated: 'header bytes unnamed',
  },
  // fixed 8-byte packed config, no paging
  [CMD.SET_EFFECT_LIGHT]: { name: 'set_effect_light', kind: 'fixed', bytes: 8 },
};

/**
 * `0x13` set effect light — SOLVED. See PROTOCOL.md section 6.
 *
 * The Windows app stores the config as a little-endian uint64 unpacked across
 * eight byte slots, then writes them to the wire in a permuted order:
 *
 *   sender[0x240..0x247] = v & 0xFF, v>>8, v>>16, ... v>>56
 *   wire = [0x240, 0x242, 0x243, 0x244, 0x241, 0x245, 0x246, 0x247]
 *
 * so the uint64 byte order on the wire is the permutation [0,2,3,4,1,5,6,7].
 *
 * Field meanings, established by reading the byte-assembly block in the frame
 * builders (procedure_assembly — the decompiler drops this block entirely):
 *
 *   wire[0] = effect index, 0..11   (device rejects anything else, status 07)
 *   wire[1] = brightness, 0..100    sent RAW and UNSCALED
 *   wire[2] = speed, 1..100         an interval: higher value = slower
 *   wire[3..7] = opaque device record bytes, passed through unchanged
 *
 * Brightness is a percentage of the 0-100 slider, not a 0-255 level. "40%"
 * means wire[1] = 40.
 */
export const LIGHT_CONFIG_SENTINEL = 0xff;

/** uint64 byte index -> wire payload index, for 0x13. */
export const LIGHT_WIRE_ORDER = [0x240, 0x242, 0x243, 0x244, 0x241, 0x245, 0x246, 0x247];

/**
 * Wire payload index -> meaning, for `0x13`.
 *
 * Fully named except bytes 3 and 4. Proven by the colour change path at
 * `0x140037cd0`, which preserves record[1..4] and substitutes QColor's red,
 * green and blue into the top three uint64 bytes — which the permutation places
 * at wire positions 5, 6 and 7.
 *
 * The same function independently confirms bytes 1 and 2: it copies record[2]
 * into u2 and record[3] into u3, i.e. it preserves whatever the brightness and
 * speed sliders own, rather than overwriting them with colour.
 */
export const LIGHT_FIELD = {
  EFFECT: 0,
  BRIGHTNESS: 1,
  SPEED: 2,
  // Bytes 3 and 4 were carried through as unnamed for several phases on the
  // evidence that all three UI handlers pass them by untouched. The app's
  // `effect_light_table` DDL names them (PROTOCOL.md 8.12.2):
  //   byte 3 -> `fullColor`   byte 4 -> `functionFlag`
  FULL_COLOR: 3,
  FUNCTION_FLAG: 4,
  RED: 5,
  GREEN: 6,
  BLUE: 7,
};

/**
 * Bytes the host should rewrite rather than choose.
 *
 * Every byte of `0x13` is now named, so this list is empty: the driver reads the
 * record back and rewrites all of it. It is kept as a named export so a call
 * site can assert the invariant rather than discover a gap by reading a doc.
 */
export const LIGHT_UNNAMED = [];

/** `fullColor`: when set, the board lights with colorR/G/B instead of the effect's own colours. */
export const FULL_COLOR_OFF = 0;
export const FULL_COLOR_ON = 1;

/**
 * Build the 8-byte payload for `0x13`.
 *
 * Bytes 3-7 are device-owned. Pass the values read back from the device so a
 * brightness or speed change does not silently clobber them; `readback` is the
 * response payload from `0x17 getEffectLight`, or a previous `0x13` payload.
 *
 * @param {object} opts
 * @param {number} opts.effect     0..11
 * @param {number} [opts.brightness] 0..100, defaults to 100
 * @param {number} [opts.speed]      1..100, defaults to 100
 * @param {Uint8Array} [opts.readback] last known wire payload, for bytes 3..7
 * @returns {Uint8Array} 8 bytes
 */
export function buildEffectConfig({
  effect, brightness = 100, speed = 100,
  red = null, green = null, blue = null,
  readback = null,
} = {}) {
  if (!Number.isInteger(effect) || effect < EFFECT_MIN || effect > EFFECT_MAX) {
    throw new RangeError(`effect index must be ${EFFECT_MIN}..${EFFECT_MAX}, got ${effect}`);
  }
  if (!Number.isInteger(brightness) || brightness < BRIGHTNESS_MIN || brightness > BRIGHTNESS_MAX) {
    throw new RangeError(`brightness must be ${BRIGHTNESS_MIN}..${BRIGHTNESS_MAX}, got ${brightness}`);
  }
  if (!Number.isInteger(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
    throw new RangeError(`speed must be ${SPEED_MIN}..${SPEED_MAX}, got ${speed}`);
  }
  const chan = [red, green, blue];
  for (const [i, v] of chan.entries()) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 255)) {
      throw new RangeError(`colour channel ${i} must be 0..255, got ${v}`);
    }
  }
  const out = new Uint8Array(8);
  // Carry forward everything the caller did not explicitly set, so a brightness
  // change does not clobber colour and vice versa.
  if (readback && readback.length >= 8) out.set(readback.subarray(3, 8), 3);
  out[LIGHT_FIELD.EFFECT] = effect & 0xff;
  out[LIGHT_FIELD.BRIGHTNESS] = brightness & 0xff;
  out[LIGHT_FIELD.SPEED] = speed & 0xff;
  const targets = [LIGHT_FIELD.RED, LIGHT_FIELD.GREEN, LIGHT_FIELD.BLUE];
  chan.forEach((v, i) => {
    if (v !== null) out[targets[i]] = v & 0xff;
  });
  return out;
}

/**
 * Invert the 0x13 permutation, turning a wire payload back into the uint64 the
 * Windows app would hold. Useful for round-trip checks in tests.
 */
export function parseEffectConfig(payload) {
  if (!payload || payload.length < 8) throw new RangeError('need 8 payload bytes');
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(payload[i] & 0xff) << BigInt(i * 8);
  }
  return {
    value: v,
    effect: payload[LIGHT_FIELD.EFFECT],
    brightness: payload[LIGHT_FIELD.BRIGHTNESS],
    speed: payload[LIGHT_FIELD.SPEED],
    colour: {
      r: payload[LIGHT_FIELD.RED],
      g: payload[LIGHT_FIELD.GREEN],
      b: payload[LIGHT_FIELD.BLUE],
      hex: '#' + [LIGHT_FIELD.RED, LIGHT_FIELD.GREEN, LIGHT_FIELD.BLUE]
        .map((i) => (payload[i] & 0xff).toString(16).padStart(2, '0')).join(''),
    },
    fullColor: payload[LIGHT_FIELD.FULL_COLOR],
    functionFlag: payload[LIGHT_FIELD.FUNCTION_FLAG],
    // Retained for call sites that still treat 3-4 as opaque. Every byte is
    // named now, so prefer fullColor/functionFlag.
    unnamed: [],
    opaque: Array.from(payload.subarray(3, 8)),
  };
}

/**
 * Colour-only change, mirroring exactly what the Windows app's colour path does.
 *
 * The app's handler at `0x140037cd0` copies record[1], record[2], record[3] and
 * record[4] through unchanged and substitutes only the three colour bytes. That
 * means a colour change must **preserve the current brightness and speed** rather
 * than resetting them to the defaults — so this carries bytes 1 and 2 out of
 * `readback` when the caller does not name them.
 *
 * @param {{effect: number, red: number, green: number, blue: number,
 *          brightness?: number, speed?: number, readback?: Uint8Array|null}} opts
 */
export function buildColourConfig({
  effect, red, green, blue, brightness, speed, readback = null,
}) {
  const b = brightness ?? (readback && readback.length >= 3 ? readback[LIGHT_FIELD.BRIGHTNESS] : 100);
  const s = speed ?? (readback && readback.length >= 3 ? readback[LIGHT_FIELD.SPEED] : 100);
  return buildEffectConfig({ effect, brightness: b, speed: s, red, green, blue, readback });
}

/** Bytes a paged command will emit for `count` records, or null when not paged. */
export function pagedPayloadSize(cmd, count) {
  const spec = PAYLOAD[cmd];
  if (!spec || spec.kind !== 'record') return null;
  return spec.prefix + spec.record * count;
}

/**
 * Build a paged request frame.
 *
 * @param {number} cmd
 * @param {{start: number, end: number, payload?: Uint8Array}} opts
 */
export function buildPagedFrame(cmd, { start, end, payload = new Uint8Array(0) }) {
  return buildFrame(cmd, payload, start, end);
}

export function opcodeName(opcode) {
  return OPCODE_NAME[opcode] ?? `unknown_0x${opcode.toString(16).padStart(2, '0')}`;
}

export function isResponse(opcode) {
  return (opcode & RESPONSE_FLAG) !== 0;
}

/**
 * Build a complete 64-byte vendor frame.
 *
 *   [0]=0xFA [1]=cmd [2]=p1 [3]=p2 [4]=0x00 [5]=len [6..]=payload
 *
 * @param {number} cmd
 * @param {Uint8Array} [payload]
 * @param {number} [param1]
 * @param {number} [param2]
 * @returns {Uint8Array} exactly REPORT_SIZE bytes
 */
export function buildFrame(cmd, payload = new Uint8Array(0), param1 = 0, param2 = 0) {
  if (payload.length > MAX_PAYLOAD) {
    throw new RangeError(
      `payload of ${payload.length} bytes exceeds the ${MAX_PAYLOAD}-byte frame budget ` +
      `(${REPORT_SIZE}-byte report); page the request instead`,
    );
  }
  const frame = new Uint8Array(REPORT_SIZE);
  frame[OFF_MAGIC] = MAGIC;
  frame[OFF_CMD] = cmd & 0xff;
  frame[OFF_PARAM1] = param1 & 0xff;
  frame[OFF_PARAM2] = param2 & 0xff;
  frame[OFF_RESERVED] = 0x00;
  frame[OFF_LENGTH] = payload.length;
  frame.set(payload, OFF_DATA);
  return frame;
}

/**
 * Strip the header for `HIDDevice.sendReport()`.
 *
 * There is no report ID to remove: the whole frame body is the report, so this
 * returns the frame unchanged and exists only to document that fact.
 * @param {Uint8Array} frame
 * @returns {Uint8Array}
 */
export function frameToWebHidData(frame) {
  return frame;
}

/**
 * Parse a response frame.
 *
 * @param {DataView|Uint8Array} data the 64-byte `inputreport` payload
 * @returns {{ok: boolean, reason?: string, opcode: number, frame: number, total: number, payload: Uint8Array}}
 */
export function parseResponse(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data);
  if (bytes[OFF_MAGIC] !== MAGIC) {
    return {
      ok: false,
      reason: `unexpected magic 0x${bytes[OFF_MAGIC].toString(16)}, expected 0xfa`,
      opcode: -1, frame: 0, total: 0, payload: new Uint8Array(0),
    };
  }
  const opcode = bytes[OFF_CMD];
  const frame = bytes[OFF_PARAM1];
  const total = bytes[OFF_PARAM2];
  const length = bytes[OFF_LENGTH];
  const payload = bytes.subarray(OFF_DATA, OFF_DATA + length);
  return { ok: true, opcode, frame, total, payload: new Uint8Array(payload) };
}

export function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}