// WebHID transport for the ANT ESPORTS APEX 200.
//
// The device speaks interrupt IN/OUT reports only (no feature reports), which is
// exactly what WebHID supports, so a plain browser page can drive it.

import {
  VID, PID, VENDOR_USAGE_PAGE, WEBHID_REPORT_ID, REPORT_SIZE, MAGIC, CMD,
  buildFrame, frameToWebHidData, parseResponse, opcodeName, pagedPayloadSize,
  parseEffectNameSlots,
  commandClass, commandClass as _commandClass, FORBIDDEN_COMMANDS,
  buildEffectConfig, parseEffectConfig, buildColourConfig, buildHighKeyBinding,
  buildSocdRecord, decodeHighKeyRecords,
  buildSetHighKeyPages, HIGH_KEY_SLOT_LEN, HIGH_KEY_SLOT_PAGE_SIZE,
  pageMacroPayloads, parseMacroRecords, MACRO_SLOT_MIN, MACRO_SLOT_MAX,
  responseOpcode, awaitsResponse, RESPONSE_DISPATCH, isUnsolicited,
  parseWholeParams, buildWholeParams, parseCustomLight, buildCustomLightPayload,
  pageCustomLightPayloads, isValidKeymapLayer,
  BRIGHTNESS_MIN, BRIGHTNESS_MAX, SPEED_MIN, SPEED_MAX,
} from './protocol.js';

export function webHidSupported() {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

/**
 * The only interface that can answer `0x62`, `0x17`, `0x13` and friends.
 *
 * Filtering on `usagePage` matters: a VID/PID filter matches every HID interface
 * of this composite device, and opening a keyboard/mouse interface either fails
 * outright or succeeds against the wrong collection. Chrome matches filters
 * against top-level collections, and the config collection is the lone
 * `0xFF02` one (PROTOCOL.md §9).
 */
export const CONFIG_FILTER = Object.freeze({
  vendorId: VID,
  productId: PID,
  usagePage: VENDOR_USAGE_PAGE,
});

/** True when this HID interface carries the vendor config collection. */
export function isConfigInterface(device) {
  return (device?.collections ?? []).some((c) => c.usagePage === VENDOR_USAGE_PAGE);
}

/**
 * Pick the config interface out of whatever the picker returned.
 *
 * Chrome's chooser normally returns one interface, but returning several is
 * allowed. Never fall back to an arbitrary device: sending a 64-byte vendor
 * frame to a keyboard collection is at best a no-op and at worst a stray
 * keystroke, so an unmatched selection is an error, not something to guess at.
 */
export function selectConfigDevice(devices) {
  return (devices ?? []).find(isConfigInterface) ?? null;
}

/** Human-readable collection list for error messages. */
export function describeCollections(device) {
  const collections = device?.collections ?? [];
  if (!collections.length) return 'no top-level collections reported';
  return collections
    .map((c) => `usage page 0x${c.usagePage.toString(16)}, usage 0x${c.usage.toString(16)}`)
    .join('; ');
}

/**
 * Why `open()` can fail on an interface the page can otherwise see. WebHID
 * surfaces the same generic message for all of them, so name the usual causes.
 */
function openHint() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Linux/i.test(ua)) {
    return 'on Linux, install 70-apex.rules and replug the keyboard (see README); sandboxed snap/flatpak browsers may block hidraw too';
  }
  if (/Windows/i.test(ua)) {
    return 'close the ANT software and any other app using the keyboard, then replug it';
  }
  if (/Mac/i.test(ua)) {
    return 'close other apps that may hold the HID interface, then replug the keyboard';
  }
  return 'close other apps using the keyboard and replug it';
}

export class ApexHid {
  constructor() {
    /** @type {HIDDevice|null} */
    this.device = null;
    this.listeners = new Map();
    this.pending = new Map();
    this.nextToken = 1;
    this.trace = [];
    this.traceLimit = 500;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, detail) {
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(detail); } catch (err) { console.error(`listener for "${event}" threw`, err); }
    }
  }

  record(kind, detail) {
    this.trace.push({ kind, ...detail, t: Date.now() });
    if (this.trace.length > this.traceLimit) this.trace.shift();
    this.emit('trace', this.trace[this.trace.length - 1]);
  }

  /** Ask Chrome for the keyboard. Requires a user gesture. */
  async connect() {
    if (!webHidSupported()) throw new Error('WebHID is unavailable — use Chrome or Edge.');
    const devices = await navigator.hid.requestDevice({ filters: [CONFIG_FILTER] });
    if (!devices.length) {
      throw new Error('No APEX 200 config interface selected — connect it by USB (not the 2.4 GHz dongle) and pick the entry the picker offers.');
    }
    const device = selectConfigDevice(devices);
    if (!device) {
      throw new Error(
        `Selected interface is not the config channel (${describeCollections(devices[0])}). ` +
        'Reconnect and choose the entry whose usage page is 0xFF02.',
      );
    }
    await this.attach(device);
    return this.device;
  }

  /** Re-attach to a device permission was already granted for. */
  async restore() {
    if (!webHidSupported()) return null;
    const devices = await navigator.hid.getDevices();
    const match = devices.find(
      (d) => d.vendorId === VID && d.productId === PID && isConfigInterface(d),
    );
    if (match) await this.attach(match);
    return this.device;
  }

  async attach(device) {
    // Restore() and any future caller can hand us a granted interface that is
    // not the config channel. Check before open(): the failure mode is a board
    // that accepts reports and silently ignores them.
    if (!isConfigInterface(device)) {
      throw new Error(`Refusing non-config HID interface (${describeCollections(device)}).`);
    }
    if (!device.opened) {
      try {
        await device.open();
      } catch (err) {
        const e = new Error(`Failed to open HID device — ${openHint()}`);
        e.cause = err;
        throw e;
      }
    }
    this.device = device;

    device.addEventListener('inputreport', (event) => this.#onInput(event));
    navigator.hid.addEventListener('connect', (event) => {
      if (event.device.vendorId === VID && event.device.productId === PID) {
        this.emit('reconnect', event.device);
      }
    });
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === this.device) {
        this.emit('disconnect', event.device);
        for (const { reject } of this.pending.values()) {
          reject(new Error('device disconnected'));
        }
        this.pending.clear();
      }
    });

    this.emit('attach', device);
  }

  get collections() {
    return this.device?.collections ?? [];
  }

  #onInput(event) {
    // The vendor collection declares no ReportID items, so event.reportId is 0
    // and the whole 64-byte frame arrives in event.data.
    const parsed = parseResponse(event.data);
    this.record('in', {
      opcode: parsed.opcode,
      name: opcodeName(parsed.opcode),
      // Only three dispatched responses are never replies to something we sent:
      // 0xA1 and 0xD1 are handled-but-unsent leftovers, and 0xF1 is the
      // keyboard's own "state changed, re-read" push (PROTOCOL.md 4.2-4.3).
      unsolicited: isUnsolicited(parsed.opcode),
      dispatched: RESPONSE_DISPATCH[parsed.opcode] !== undefined,
      bytes: new Uint8Array(event.data.buffer ?? event.data),
    });
    if (!parsed.ok) {
      this.emit('protocol-error', parsed.reason);
      return;
    }
    // A push means our view of the device is stale. Surface it as its own event
    // rather than letting it fall through to the generic unsolicited handler.
    if (isUnsolicited(parsed.opcode)) {
      this.emit('device-push', parsed);
    }
    const waiter = this.pending.get(parsed.opcode);
    if (waiter) {
      this.pending.delete(parsed.opcode);
      waiter.resolve(parsed);
    } else {
      this.emit('unsolicited', parsed);
    }
  }

  /**
   * Send a request and wait for the matching response.
   *
   * @param {number} cmd request opcode
   * @param {Uint8Array} [payload]
   * @param {{param1?: number, param2?: number, timeoutMs?: number,
   *          expectResponse?: boolean, allowWrite?: boolean,
   *          allowForbidden?: boolean}} [opts]
   */
  async request(cmd, payload = new Uint8Array(0), opts = {}) {
    if (!this.device) throw new Error('Not connected.');
    const {
      // The Windows app's initiators set sender+0x59/+0x5A to 0x0101 before the
      // first frame, so every fresh request opens at page/order 1,1. Paged
      // callers override these with page/total (PROTOCOL.md 8.23).
      param1 = 1, param2 = 1, timeoutMs = 1000, expectResponse = true,
      allowWrite = false, allowForbidden = false,
    } = opts;

    // Safety gate. Every opcode is classified read/write from the Windows app's
    // own method names (PROTOCOL.md section 3). A write will not go out unless
    // the call site explicitly opts in, so an unclassified sweep cannot reach
    // the board. Unclassified opcodes are refused outright.
    const cls = commandClass(cmd);
    if (cls === 'unknown') {
      throw new Error(
        `refusing 0x${cmd.toString(16).padStart(2, '0')}: opcode is not in the ` +
        `classified command table (PROTOCOL.md section 3)`);
    }
    if (cls === 'write' && !allowWrite) {
      throw new Error(
        `refusing write 0x${cmd.toString(16).padStart(2, '0')} ${opcodeName(cmd)}: ` +
        `pass { allowWrite: true } to confirm you intend to mutate device state`);
    }
    if (FORBIDDEN_COMMANDS.has(cmd) && !allowForbidden) {
      throw new Error(
        `refusing 0x${cmd.toString(16).padStart(2, '0')} ${opcodeName(cmd)}: ` +
        `this command is factory-destructive and is not exposed by this driver.`);
    }

    const frame = buildFrame(cmd, payload, param1, param2);
    const data = frameToWebHidData(frame);
    this.record('out', { opcode: cmd, name: opcodeName(cmd), cls, bytes: data });

    // Response opcode is request + 0x80. Verified against all 37 request/reply
    // pairs in the binary with no exceptions (PROTOCOL.md section 4). The
    // firmware-data pair is the one exception: the app dispatches nothing for
    // 0x65/0x66, so waiting on 0xE5/0xE6 would hang. Fail loudly instead.
    const expect = responseOpcode(cmd);
    if (expect === null) {
      throw new Error(
        `0x${cmd.toString(16).padStart(2, '0')} ${opcodeName(cmd)} has no ` +
        `dispatched response in the Windows app; do not wait for a reply`);
    }
    let waiter = null;
    if (expectResponse) {
      waiter = new Promise((resolve, reject) => {
        this.pending.set(expect, { resolve, reject });
        setTimeout(() => {
          if (this.pending.delete(expect)) {
            reject(new Error(`timeout waiting for 0x${expect.toString(16)} ${opcodeName(expect)}`));
          }
        }, timeoutMs);
      });
    }

    await this.device.sendReport(WEBHID_REPORT_ID, data);
    if (!expectResponse) return null;
    return waiter;
  }

  // ---- High-level helpers -------------------------------------------------

  /**
   * Product info. `0x62`.
   *
   * The request is not empty: `FUN_1400a3d00` sends LEN=7 with the host clock:
   *
   *   [0]=0  [1]=year  [2]=month  [3]=day  [4]=hour  [5]=minute  [6]=second
   *
   * The year byte is the app's literal `(year & 0xff) + 0x30`, truncated to a
   * byte. For 2000..2047 that is years-since-2000 (2026 -> 26); the remaining
   * fields are plain binary values, not ASCII.
   *
   * @param {Date} [date] clock to report, default now
   */
  getProductInfo(date = new Date()) {
    const year = date.getFullYear();
    return this.request(CMD.GET_PRODUCT_INFO, Uint8Array.of(
      0,
      ((year & 0xff) + 0x30) & 0xff,
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    ), { timeoutMs: 3000 });
  }

  /**
   * Keymap read. `0x2A`, payload is the layer byte from sender+0xC0
   * (`FUN_1400a3320`). Layer 0 is the base layer.
   */
  getKeyboardConfig(layer = 0) {
    return this.request(CMD.GET_KEYBOARD_CONFIG, Uint8Array.of(layer & 0xff));
  }

  /**
   * Effect config read. `0x17`, payload is the effect index from sender+0xB0
   * (`FUN_1400a2410`).
   */
  getEffectLight(index = 0) {
    return this.request(CMD.GET_EFFECT_LIGHT, Uint8Array.of(index & 0xff));
  }

  /**
   * Effect-name page. `0x18`, payload is the one-byte name-set selector from
   * `FUN_1400a2900`: 0 for the default/English set, 1 for the fallback set and
   * 7 for the third set. The app derives it from the UI language.
   */
  getEffectLightName(nameSet = 0) {
    if (![0, 1, 7].includes(nameSet)) {
      throw new RangeError(`effect name set must be 0, 1 or 7, got ${nameSet}`);
    }
    return this.request(CMD.GET_EFFECT_LIGHT_NAME, Uint8Array.of(nameSet));
  }

  getCustomLight() { return this.request(CMD.GET_CUSTOM_LIGHT); }

  /**
   * Read everything the board holds, the way the Windows app's SyncConfigUtil
   * does before it pushes a configuration back (PROTOCOL.md 8.17).
   *
   * Every call here is a read. Nothing is written, so this is safe to run at any
   * time - which is the point: it is the backup to take *before* touching
   * anything, given that the only recovery from a bad write is a factory reset.
   *
   * Each reader is independent. One failing does not lose the other nine, so
   * the snapshot records the failure rather than aborting.
   */
  async snapshot() {
    const step = async (name, fn) => {
      try {
        // eslint-disable-next-line no-await-in-loop
        return { name, ok: true, value: await fn() };
      } catch (err) {
        return { name, ok: false, error: String(err.message ?? err) };
      }
    };
    const parts = await Promise.all([
      step('productInfo', () => this.getProductInfo()),
      step('configInfo', () => this.readConfigTables()),
      step('wholeParam', () => this.getWholeParam()),
      step('customLight', () => this.readAll(CMD.GET_CUSTOM_LIGHT)),
      // SyncConfigUtil's 0x17 initiator is called with 0xFF
      // (FUN_1400b5b80 -> FUN_1400af540); the device returns the current
      // effect's config rather than a table indexed by 0xFF.
      step('effectLight', () => this.getEffectLight(0xff)),
      step('effectNames', () => this.readEffectNamePages()),
      // FUN_1400b5650/FUN_1400b5850 read layer 0 and then layer 1 before the
      // high-key read, so a faithful snapshot carries both keymap layers.
      step('keyboardConfig', () => this.readKeyConfig(0)),
      step('keyboardConfig1', () => this.readKeyConfig(1)),
      step('highKey', () => this.readHighKeys()),
      step('macro', () => this.readAllMacros()),
      step('triggerConfig', () => this.readTriggerConfig()),
    ]);
    const out = {};
    for (const p of parts) out[p.name] = p.ok ? p.value : { error: p.error };
    return { parts: parts.map(({ name, ok, error }) => ({ name, ok, error })), data: out };
  }
  getTriggerConfig() { return this.request(CMD.GET_TRIGGER_CONFIG); }
  getConfigTable() { return this.request(CMD.GET_CONFIG_INFO); }
  getWholeParam() { return this.request(CMD.GET_WHOLE_PARAM, new Uint8Array(0), { timeoutMs: 3000 }); }

  /**
   * Change one or more global settings, preserving everything else.
   *
   * `0x50` rewrites all 20 bytes at once, so this reads `0x5E` first and rebuilds
   * from that. A caller that sent only the bytes it cared about would reset the
   * other seven settings to whatever happened to be in the buffer - the same
   * reason the `0x13` effect path carries the device's own bytes forward.
   *
   * @param {Record<string, number>} changes e.g. `{ pollingRate: 4 }`
   */
  async setWholeParam(changes) {
    const before = parseWholeParams((await this.getWholeParam()).payload);
    const payload = buildWholeParams(before.bytes, changes);
    const r = await this.request(CMD.SET_WHOLE_PARAM, payload, { allowWrite: true, timeoutMs: 3000 });
    const after = parseWholeParams((await this.getWholeParam()).payload);
    const wanted = buildWholeParams(before.bytes, changes);
    const matched = Array.from(payload).every((b, i) => after.bytes[i] === b);
    return { response: r, before, after, matched, payload: Array.from(payload), wanted: Array.from(wanted) };
  }

  // ---- Paged reads --------------------------------------------------------

  /**
   * Read every page of a paged command.
   *
   * The Windows app's initiators set sender+0x59/+0x5A to 0x0101, so the first
   * request carries page 1 and total 1. The reply reports the real total; every
   * later request carries the next page and that total. `FUN_140098b90` and the
   * other response handlers re-enter their builders in exactly that order.
   *
   * `payload` is for reads that identify a sub-object: effect index (`0x17`),
   * keymap layer (`0x2A`), macro slot (`0x42`) and effect-name set (`0x18`).
   *
   * Returns both the raw payloads (`pages`) and the whole response frames, so a
   * caller can inspect `frame`/`total` without re-reading.
   *
   * @param {number} cmd
   * @param {{payload?: Uint8Array, maxPages?: number, timeoutMs?: number}} [opts]
   * @returns {Promise<{pages: Uint8Array[], frames: object[], total: number,
   *                    joined: Uint8Array}>}
   */
  async readAll(cmd, opts = {}) {
    const {
      payload = new Uint8Array(0), maxPages = 32, timeoutMs = 1000,
    } = opts;
    const pages = [];
    const frames = [];
    let total = 1;
    for (let page = 1; page <= maxPages; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.request(cmd, payload, {
        param1: page, param2: total, timeoutMs,
      });
      pages.push(r.payload);
      frames.push(r);
      if (r.total > 0) {
        total = r.total;
        if (page >= r.total) break;
      } else {
        // Single-frame response: total is zero, so there is no page two.
        break;
      }
    }
    const size = pages.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(size);
    let at = 0;
    for (const p of pages) { joined.set(p, at); at += p.length; }
    return { pages, frames, total, joined };
  }

  /**
   * Raw `0x18` pages, for a faithful snapshot. The first request is page 1, so
   * page 0's 16-byte thirteenth-name blob is not requested.
   */
  readEffectNamePages(nameSet = 0) {
    if (![0, 1, 7].includes(nameSet)) {
      throw new RangeError(`effect name set must be 0, 1 or 7, got ${nameSet}`);
    }
    return this.readAll(CMD.GET_EFFECT_LIGHT_NAME, {
      payload: Uint8Array.of(nameSet),
    });
  }

  /**
   * Read all effect names, keyed by their global index.
   *
   * `0x18` takes a one-byte name-set selector (0 default/English, 1 fallback,
   * 7 third set); it is not an effect index.
   *
   * @param {0|1|7} [nameSet]
   * @returns {Promise<{index: number, name: string|null}[]>}
   */
  async readEffectNames(nameSet = 0) {
    const { pages } = await this.readEffectNamePages(nameSet);
    return parseEffectNameSlots(pages);
  }

  /** Per-key Hall-effect ADC calibration values (16-bit little-endian). */
  readCalibrationAdc() { return this.readAll(CMD.GET_CALIBRATION_ADC); }

  /** Per-key actuation / quick-trigger configuration (7-byte records). */
  readTriggerConfig() { return this.readAll(CMD.GET_TRIGGER_CONFIG); }

  /** Per-key remap table (3-byte records) for one layer (`0x2A`). */
  readKeyConfig(layer = 0) {
    if (!isValidKeymapLayer(layer)) {
      throw new RangeError(`keymap layer must be 0 or 1, got ${layer}`);
    }
    return this.readAll(CMD.GET_KEYBOARD_CONFIG, {
      payload: Uint8Array.of(layer),
    });
  }

  /** Profile names, e.g. "KeyLayer1". */
  readConfigTables() { return this.readAll(CMD.GET_CONFIG_INFO); }

  /* ---- profiles ---------------------------------------------------------- */

  /**
   * Profiles, read via `0x57 getConfigInfo`.
   *
   * The Windows app also has Export/Import profile actions. Export writes a
   * local file and import replays it through the same set/write opcodes, so
   * neither is a distinct protocol operation — they are host-side file
   * handling over the calls already here. Import is consequently as dangerous
   * as the writes it replays, and is not automated.
   */
  listProfiles() { return this.readAll(CMD.GET_CONFIG_INFO); }

  /**
   * Add a profile. Payload is the one-byte config-table index the Windows app
   * takes from the currently selected profile row (FUN_140022830 -> s[0x88]).
   */
  addProfile(index) {
    return this.request(CMD.ADD_CONFIG_TABLE, Uint8Array.of(index & 0xff), {
      allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Delete a profile. Irreversible for that profile's bindings.
   *
   * The Windows app refuses to delete the last remaining profile
   * (FUN_1400228a0 sends only when its profile count is > 1); the UI applies
   * the same guard before reaching this call.
   */
  delProfile(index) {
    return this.request(CMD.DEL_CONFIG_TABLE, Uint8Array.of(index & 0xff), {
      allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Make a profile current. This is the "switch profile" action. The Windows
   * app skips this send when the selected row already is the device's current
   * profile (FUN_140022610); this driver always sends what it is asked to send.
   */
  switchProfile(index) {
    return this.request(CMD.SWITCH_CONFIG_TABLE, Uint8Array.of(index & 0xff), {
      allowWrite: true, timeoutMs: 2000,
    });
  }

  /* ---- Fn / high-key layer ---------------------------------------------- */

  /**
   * The high-key (Fn layer) bindings. Read via `0x2B getHighKey`.
   *
   * This is where the six advanced modifiers live: DKS, MT, TGL, RS, SOCD and
   * OKS are all stored in these bindings, not in the plain keymap. A driver
   * that only exposes plain keycodes cannot represent them and is not
   * feature-complete against the Windows app.
   */
  readHighKeys() { return this.readAll(CMD.GET_HIGH_KEY); }

  /**
   * Add a high-key binding. `0x22`.
   *
   * `FUN_14009e380` builds a variable-length record:
   *
   *   [0] = sender+0x24A   the key item
   *   [1] = sender+0x24B   type, selects the record shape
   *   [2..] = type-specific data
   *
   *   type 0 TGL  -> len 6  (4 data bytes)
   *   type 1 MT   -> len 11 (9 data bytes on the wire; a 10th is past LEN)
   *   type 2 DKS  -> len 19 (17 data bytes)
   *   type 3 RS   -> len 4  (2 data bytes)
   *   type 4 OKS  -> len 4  (2 data bytes)
   *   type 5 SOCD -> len 5  (3 data bytes)
   *
   * Pass `{modifier, key, data}` with a name from `KEY_MODIFIERS`; the builder
   * supplies the type code and enforces the verified length. The frame header
   * is fixed single-page (`[2]=1 [3]=1`), matching the builder.
   *
   * @param {{modifier: string, key: number, data?: number[]|Uint8Array}} binding
   */
  addHighKey(binding) {
    const { record } = buildHighKeyBinding(binding);
    return this.request(CMD.ADD_HIGH_KEY, record, {
      param1: 1, param2: 1, allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Add a SOCD (type 5) binding. Fully decoded: key, type, key1, key2, mode.
   * @param {{key: number, key1?: number, key2?: number, mode?: number}} opts
   */
  addSocd(opts) {
    const record = buildSocdRecord(opts);
    return this.request(CMD.ADD_HIGH_KEY, record, {
      param1: 1, param2: 1, allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Decode a `0x2B` readback into modifier + key + data.
   *
   * The response is a sequence of fixed 19-byte slots - `FUN_140098b90` divides
   * the payload length by 19 and walks stride 0x13 - not variable `0x22`
   * records. Shared with the snapshot decoder, which needs the same layout.
   *
   * @param {Uint8Array[]} pages raw payloads from `readHighKeys()`
   */
  static decodeHighKeyPages(pages) {
    return decodeHighKeyRecords(pages);
  }

  /**
   * Set per-key colours via `0x11 setCustomLightAll`.
   *
   * Every byte is named from assembly (§8.13.2): byte 0 is the first entry's
   * keyItem, followed by (light, R, G, B) for each key in ascending QMap order.
   * This is exposed with read-modify-write + readback verification because a
   * colour mistake is recoverable by rewriting colours, unlike keymap layout or
   * actuation records.
   *
   * The full table does **not** fit one report: 85 keys is 341 bytes against a
   * 58-byte budget, so it is split the way the app splits it - 14 records per
   * frame, each frame carrying `param1` = page number (1-based) and `param2` =
   * last page number. The builder at `0x1400a66d0` derives the per-frame count
   * from those two fields and LEN as `4*count + 1`; the final page is the one
   * where `param1 == param2`, whose count is the remainder.
   *
   * @param {{all?: {light:number,r:number,g:number,b:number},
   *          keys?: Record<number,{light:number,r:number,g:number,b:number}>}} opts
   */
  async setCustomLight(opts = {}) {
    const before = parseCustomLight((await this.readAll(CMD.GET_CUSTOM_LIGHT)).pages);
    const changes = opts.keys ?? {};
    const all = opts.all ?? null;
    const merged = before.records.map((rec) => {
      const c = changes[rec.keyItem] ?? all;
      if (!c) return rec;
      return {
        keyItem: rec.keyItem,
        light: c.light ?? rec.light,
        r: c.r ?? rec.r,
        g: c.g ?? rec.g,
        b: c.b ?? rec.b,
      };
    });
    const pages = pageCustomLightPayloads(merged);
    const sent = [];
    for (const p of pages) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.request(CMD.SET_CUSTOM_LIGHT_ALL, p.payload, {
        param1: p.page,
        param2: p.totalPages,
        allowWrite: true,
        timeoutMs: 3000,
      });
      sent.push({
        page: p.page,
        totalPages: p.totalPages,
        count: p.count,
        len: p.payload.length,
        responseBytes: r ? r.payload.length : 0,
      });
    }
    const after = parseCustomLight((await this.readAll(CMD.GET_CUSTOM_LIGHT)).pages);
    const matched = merged.every((m, i) => {
      const a = after.records[i];
      if (!a) return false;
      return a.keyItem === m.keyItem && a.light === m.light && a.r === m.r && a.g === m.g && a.b === m.b;
    });
    return { before, after, merged, matched, pages: sent, payload: Array.from(pages[0].payload) };
  }

  /**
   * Bulk-replace the high-key table. `0x23`.
   *
   * This is **not** the 1-byte keyboard-config write an earlier revision
   * described. `FUN_1400a7b40` builds paged, fixed 19-byte slots:
   *
   *   [0xFA][0x23][page][lastPage][0][19 * count][slot...]
   *
   * with `count <= floor((reportSize - 6) / 19)` - three slots per frame on the
   * APEX200's 64-byte report. The only sender is the Windows app's config-import
   * worker (`ImportConfigUtil`, started by MainWindow's Import button), not the
   * interactive HighKeyForm, which uses `0x22`/`0x25`. See PROTOCOL.md 8.21.8.
   *
   * Gated twice: the normal write gate plus an explicit `allowBulkWrite`, and
   * still wired to no UI. The first hardware test must read the table, write it
   * back byte-for-byte unchanged, and read it again.
   *
   * @param {Array<Uint8Array|{key: number, type: number, data?: number[]}>} records
   * @param {{allowBulkWrite?: boolean}} [opts]
   */
  async setHighKeys(records, { allowBulkWrite = false } = {}) {
    if (!allowBulkWrite) {
      throw new Error(
        'refusing 0x23 setHighKey: this is a bulk table write used only by ' +
        'config import. Pass { allowBulkWrite: true } only after a byte-identical ' +
        'readback test on hardware (PROTOCOL.md 8.21.8).');
    }
    const pages = buildSetHighKeyPages(records);
    const replies = [];
    for (const { payload, page, lastPage } of pages) {
      replies.push(await this.request(CMD.SET_HIGH_KEY, payload, {
        param1: page, param2: lastPage, allowWrite: true, timeoutMs: 2000,
      }));
    }
    return replies;
  }

  /**
   * Remove a high-key binding. `0x25`.
   *
   * `FUN_14009f200` sends exactly one payload byte, sender+0x24A: the same key
   * item as record byte 0 of a `0x22` write and slot byte 0 of a `0x2B`
   * readback. It is **not** an array index into the table. Header [2]/[3] are
   * fixed at 1/1, as in the builder.
   */
  delHighKey(key) {
    return this.request(CMD.DEL_HIGH_KEY, Uint8Array.of(key & 0xff), {
      param1: 1, param2: 1, allowWrite: true, timeoutMs: 2000,
    });
  }

  /* ---- macros ------------------------------------------------------------ */

  /**
   * Read one macro slot. `0x42`, payload is the slot byte from sender+0x108
   * (`FUN_1400af6a0`). The Windows app sends one request per slot; it does not
   * ask for all ten in one frame.
   *
   * @param {number} slot 0..9 (M1..M10)
   */
  readMacros(slot) {
    if (!Number.isInteger(slot) || slot < MACRO_SLOT_MIN || slot > MACRO_SLOT_MAX) {
      throw new RangeError(
        `macro slot must be ${MACRO_SLOT_MIN}..${MACRO_SLOT_MAX} (M1..M10), got ${slot}`);
    }
    return this.readAll(CMD.GET_MACRO_CONFIG, { payload: Uint8Array.of(slot) });
  }

  /**
   * Read all ten macro slots, one `0x42` request each. Used by the device
   * snapshot; the editor reads the one selected slot instead.
   *
   * @returns {Promise<{slots: object[], frames: object[], pages: Uint8Array[],
   *                    joined: Uint8Array}>}
   */
  async readAllMacros() {
    const slots = [];
    const frames = [];
    const pages = [];
    for (let slot = MACRO_SLOT_MIN; slot <= MACRO_SLOT_MAX; slot += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.readMacros(slot);
      slots.push({ slot, ...r });
      frames.push(...r.frames);
      pages.push(...r.pages);
    }
    const size = pages.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(size);
    let at = 0;
    for (const p of pages) { joined.set(p, at); at += p.length; }
    return { slots, frames, pages, joined };
  }

  

  /**
   * Write macro records. `0x40`.
   *
   * The record is 6 bytes with bytes 0 and 1 transposed on the wire; this applies
   * that. The six bytes' *meanings* are recovered (see `decodeMacroRecord`), but
   * records are still carried verbatim so a read -> write round trip is
   * byte-identical.
   *
   * A macro is **paged**: `FUN_1400b0e20` puts 9 records per frame, sets page 1
   * and total = ceil(count / 9), and the `0xC0` handler advances one page per
   * ack. This method sends the pages in order and waits for each ack. An empty
   * list is refused: the Windows app takes a signal-only branch and sends no
   * `0x40` frame; use `delMacro` to clear a slot.
   *
   * @param {{slot: number, records: (number[]|Uint8Array)[]}} opts
   * @returns {Promise<object[]>} one response per page
   */
  async setMacro({ slot, records = [] }) {
    const pages = pageMacroPayloads({ slot, records });
    const replies = [];
    for (const p of pages) {
      // eslint-disable-next-line no-await-in-loop
      replies.push(await this.request(CMD.SET_MACRO_CONFIG, p.payload, {
        param1: p.page, param2: p.lastPage, allowWrite: true, timeoutMs: 2000,
      }));
    }
    return replies;
  }

  /** Delete a macro slot. `0x41`. */
  delMacro(index) {
    return this.request(CMD.DEL_MACRO_CONFIG, Uint8Array.of(index & 0xff), {
      allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Calibration state / per-key calibration flags.
   *
   * Confirmed on hardware to respond to opcode `0xD2` (`start_calibration_config`),
   * not the `0xD1` the static mapping suggested.
   */
  readCalibrationState() { return this.readAll(CMD.GET_CALIBRATION_STATE); }

  /**
   * Write a paged record set.
   *
   * Guarded: the caller must pass `{ allowWrite: true }` through, otherwise
   * `request()` refuses. Per-record layouts for several of these opcodes are
   * still unverified, so `pagedPayloadSize` only warns on a mismatch.
   */
  writePaged(cmd, start, end, payload, opts = {}) {
    const size = pagedPayloadSize(cmd, payload.length);
    if (size !== null && payload.length !== size) {
      console.warn(
        `payload of ${payload.length} bytes does not match the expected ${size} ` +
        `for 0x${cmd.toString(16)} over the given range — sending anyway`,
      );
    }
    return this.request(cmd, payload, {
      param1: start, param2: end, timeoutMs: 3000, ...opts,
    });
  }

  /**
   * Apply an RGB effect. See PROTOCOL.md section 6 — this layout is solved.
   *
   * `0x13` payload:
   *   [0] effect index 0..11   (device rejects anything else, status 07)
   *   [1] brightness 0..100    sent raw, unscaled — this is a percentage
   *   [2] speed 1..100         an interval; higher is slower
   *   [3..7] opaque device record bytes, passed through unchanged
   *
   * Bytes 3-7 are owned by the device. If you do not pass `readback`, they go
   * out as zero, which resets whatever the firmware keeps in them. Read with
   * `getEffectLight()` first and pass the result back in.
   *
   * @param {{effect: number, brightness?: number, speed?: number,
   *          readback?: Uint8Array|null}} opts
   */
  setEffectLight({ effect, brightness = 100, speed = 100, readback = null } = {}) {
    const payload = buildEffectConfig({ effect, brightness, speed, readback });
    return this.request(CMD.SET_EFFECT_LIGHT, payload, { allowWrite: true, timeoutMs: 2000 });
  }

  /**
   * Read back one effect config and return it in field form.
   * Safe to call before any `setEffectLight` to seed `readback`.
   *
   * @param {number} [effect] effect index to query (the `0x17` payload byte)
   */
  async readEffectConfig(effect = 0) {
    const r = await this.getEffectLight(effect);
    const p = r.payload;
    if (p.length >= 8) return parseEffectConfig(p);
    // The device may return a shorter form depending on how many effects it
    // reports. Fall back to reading each effect index individually.
    return null;
  }

  /**
   * Raw escape hatch: send eight literal bytes as the `0x13` payload.
   * Still gated as a write; kept for differential testing against the builder.
   *
   * @param {number[]|Uint8Array} bytes exactly 8
   */
  setEffectLightRaw(bytes) {
    if (bytes.length !== 8) throw new RangeError('lighting config must be exactly 8 bytes');
    return this.request(CMD.SET_EFFECT_LIGHT, Uint8Array.from(bytes), { allowWrite: true });
  }

  /**
   * Select which effect is active. `0x19` payload is the effect index.
   * A zero-length payload selects effect 0 ("Close") — this is a real write,
   * not a query. The Windows app gates it behind `allowWrite` for the same
   * reason this driver does.
   */
  selectEffectLight(index) {
    return this.request(CMD.SELECT_EFFECT_LIGHT, Uint8Array.of(index & 0xff), {
      allowWrite: true, timeoutMs: 2000,
    });
  }

  /**
   * Set effect / brightness / speed and then prove it took.
   *
   * `0x13` acknowledges with a status byte, but an accepted status is not proof
   * that the firmware stored what we sent. This reads the config back through
   * `0x17` and compares the three fields we control.
   *
   * @returns {{write: object, before: object|null, after: object|null, match: boolean}}
   */
  async setEffectLightVerified({ effect, brightness = 100, speed = 100,
                                  red = null, green = null, blue = null } = {}) {
    const before = await this.readEffectConfig(effect);
    const readback = before ? Uint8Array.of(0, 0, 0, ...before.opaque) : null;
    const write = await this.setEffectLight({ effect, brightness, speed, red, green, blue, readback });
    const after = await this.readEffectConfig(effect);
    const wantColour = red !== null || green !== null || blue !== null;
    const colourOk = !wantColour || !!after && (
      (red === null || after.colour.r === red) &&
      (green === null || after.colour.g === green) &&
      (blue === null || after.colour.b === blue));
    const match = !!after &&
      after.effect === effect &&
      after.brightness === brightness &&
      after.speed === speed &&
      colourOk;
    return { write, before, after, match };
  }

  /**
   * Set only this effect's colour, preserving brightness, speed and the two
   * unnamed bytes. This is the exact shape of the Windows app's colour path at
   * `0x140037cd0`, which passes record[1..4] through and substitutes only RGB.
   *
   * @param {{effect: number, red: number, green: number, blue: number}} opts
   */
  async setEffectColour({ effect, red, green, blue }) {
    const before = await this.readEffectConfig(effect);
    const readback = before ? Uint8Array.of(0, 0, 0, ...before.opaque) : null;
    const payload = buildColourConfig({ effect, red, green, blue, readback });
    const write = await this.request(CMD.SET_EFFECT_LIGHT, payload, {
      allowWrite: true, timeoutMs: 2000,
    });
    const after = await this.readEffectConfig(effect);
    const match = !!after && after.colour.r === red && after.colour.g === green && after.colour.b === blue;
    return { write, before, after, match };
  }

  /**
   * Run a write, then re-read with `readCmd` and compare raw payloads.
   *
   * Used for the profile and Fn-layer bindings, where the field semantics of the
   * records are not yet decoded: even without knowing what the bytes mean, we can
   * assert the device now returns what we sent rather than something else.
   *
   * @param {() => Promise<object>} doWrite
   * @param {number} readCmd
   * @param {(before: Uint8Array, after: Uint8Array) => boolean} compare
   */
  async verifyByReadback(doWrite, readCmd, compare) {
    const before = (await this.readAll(readCmd)).frames.map((f) => f.payload);
    const write = await doWrite();
    const after = (await this.readAll(readCmd)).frames.map((f) => f.payload);
    return { write, before, after, match: compare(before, after) };
  }

  /** True when `needle` appears somewhere in the concatenated page payloads. */
  static containsBytes(pages, needle) {
    const flat = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of pages) { flat.set(p, o); o += p.length; }
    outer: for (let i = 0; i + needle.length <= flat.length; i++) {
      for (let j = 0; j < needle.length; j++) if (flat[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }

  /** Compare two page lists for equality, byte for byte. */
  static pagesEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((p, i) => {
      const q = b[i];
      return p.length === q.length && p.every((v, j) => v === q[j]);
    });
  }

  /**
   * FACTORY RESET. Not exposed through the UI and not called anywhere in this
   * driver by default; `request()` refuses it unless `allowForbidden` is set.
   * This exists so the CLI and a human can do it deliberately, never by accident.
   */
  resetKeyboard() {
    return this.request(CMD.RESET_KEYBOARD, new Uint8Array(0), { allowForbidden: true });
  }
}

export { WEBHID_REPORT_ID, REPORT_SIZE, VID, PID, MAGIC };