// Self-checks for the protocol layer. Run: node test/protocol.test.mjs
//
// These assert claims that came out of static analysis, so a future refactor
// that silently changes a byte order fails here rather than on the keyboard.

import {
  CMD, COMMAND_CLASS, commandClass, FORBIDDEN_COMMANDS,
  buildEffectConfig, parseEffectConfig, buildColourConfig, LIGHT_WIRE_ORDER, LIGHT_FIELD,
  PAYLOAD_SHAPES,
  parseWholeParams, buildWholeParams, WHOLE_PARAM_FIELD, WHOLE_PARAM_LEN, WHOLE_PARAM_WRITABLE,
  LIGHT_UNNAMED,
  buildHighKeyRecord, buildHighKeyBinding, buildSocdRecord, parseHighKeyRecord,
  KEY_MODIFIERS, HIGH_KEY_LENGTH,
  parseCustomLight, CUSTOM_LIGHT_RECORD_LEN, CUSTOM_LIGHT_FIELD,
  parseKeymap, KEYMAP_RECORD_LEN, KEYMAP_WIRE_PERMUTATION, KEYMAP_WIRE_FIELD,
  buildKeymapPayload, keymapPayloadLen, isValidKeymapLayer,
  buildCustomLightPayload, customLightPayloadLen, CUSTOM_LIGHT_WRITE_RECORD_LEN,
  pageCustomLightPayloads, CUSTOM_LIGHT_PAGE_RECORDS,
  KEYMAP_LAYER_MIN, KEYMAP_LAYER_MAX,
  keyName, KEY_NAMES,
  RESPONSE_DISPATCH, UNSOLICITED_RESPONSES, REQUESTS_WITHOUT_RESPONSE,
  OPCODE_NAME,
  responseOpcode, awaitsResponse, isUnsolicited,
  buildMacroPayload, parseMacroRecords, MACRO_WIRE_ORDER, MACRO_RECORD_LEN,
  MACRO_SLOT_MIN, MACRO_SLOT_MAX,
  decodeMacroRecord, encodeMacroRecord, MACRO_FIELD, MACRO_STATE, MACRO_TIME_MAX,
  decodeSnapshotSection, decodeHighKeyRecords,
  buildFrame, MAGIC, REPORT_SIZE, MAX_PAYLOAD,
  BRIGHTNESS_MIN, BRIGHTNESS_MAX, SPEED_MIN, SPEED_MAX,
  EFFECT_MIN, EFFECT_MAX, SOCD_MODES,
} from '../js/protocol.js';

let pass = 0, fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  ok(A === B, label, `got ${A} want ${B}`);
}

console.log('command classification');
{
  const kinds = {};
  for (const [name, code] of Object.entries(CMD)) {
    kinds[commandClass(code)] = (kinds[commandClass(code)] ?? 0) + 1;
    if (commandClass(code) === 'unknown') console.log(`  unclassified: ${name} 0x${code.toString(16)}`);
  }
  // PROTOCOL.md section 3: 39 opcodes, 13 read, 26 write
  eq(Object.keys(CMD).length, 39, 'CMD has 39 opcodes');
  eq(kinds.read, 13, '13 READ opcodes');
  eq(kinds.write, 26, '26 WRITE opcodes');
  ok(commandClass(0x00) === 'unknown', 'unclassified opcode reports unknown');
  ok(commandClass(0x13) === 'write', '0x13 is a write');
  ok(commandClass(0x17) === 'read', '0x17 is a read');
  ok(FORBIDDEN_COMMANDS.has(CMD.RESET_KEYBOARD), 'factory reset is forbidden');
  ok(!FORBIDDEN_COMMANDS.has(CMD.SET_EFFECT_LIGHT), 'set effect light is allowed');
}

console.log('0x13 effect config (PROTOCOL.md section 6)');
{
  const p = buildEffectConfig({ effect: 5, brightness: 40, speed: 50 });
  eq(p.length, 8, 'payload is 8 bytes');
  eq(p[LIGHT_FIELD.EFFECT], 5, 'wire[0] = effect index');
  eq(p[LIGHT_FIELD.BRIGHTNESS], 40, 'wire[1] = brightness, raw');
  eq(p[LIGHT_FIELD.SPEED], 50, 'wire[2] = speed');

  const back = parseEffectConfig(p);
  eq(back.effect, 5, 'round-trip effect');
  eq(back.brightness, 40, 'round-trip brightness');
  eq(back.speed, 50, 'round-trip speed');

  // The Windows app writes wire[i] = uint64 byte LIGHT_WIRE_ORDER[i].
  // Verify against a hand-computed uint64 rather than re-using the same table.
  const u = 5n | (40n << 16n) | (50n << 24n); // effect u0, brightness u2, speed u3
  const expected = [
    Number(u & 0xffn),
    Number((u >> 16n) & 0xffn),
    Number((u >> 24n) & 0xffn),
    0, 0, 0, 0, 0,
  ];
  eq(JSON.stringify([...p]), JSON.stringify(expected),
    'wire bytes match the uint64 permutation');

  // defaults
  const d = buildEffectConfig({ effect: 0 });
  eq(d[LIGHT_FIELD.BRIGHTNESS], BRIGHTNESS_MAX, 'default brightness is 100');
  eq(d[LIGHT_FIELD.SPEED], SPEED_MAX, 'default speed is 100');

  // unnamed + colour bytes survive a brightness-only change
  const rb = Uint8Array.of(0, 0, 0, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE);
  const q = buildEffectConfig({ effect: 2, brightness: 40, readback: rb });
  eq(JSON.stringify([...q.subarray(3, 8)]), JSON.stringify([0xAA, 0xBB, 0xCC, 0xDD, 0xEE]),
    'device bytes are carried through unchanged');

  // Bytes 3 and 4 were unnamed for several phases. effect_light_table names them.
  eq(LIGHT_FIELD.FULL_COLOR, 3, 'byte 3 is fullColor');
  eq(LIGHT_FIELD.FUNCTION_FLAG, 4, 'byte 4 is functionFlag');
  eq(JSON.stringify(LIGHT_UNNAMED), '[]', 'no 0x13 byte is left unnamed');
  eq(LIGHT_FIELD.RED, 5, 'R is byte 5');
  eq(LIGHT_FIELD.GREEN, 6, 'G is byte 6');
  eq(LIGHT_FIELD.BLUE, 7, 'B is byte 7');

  // colour-only change mirrors the app's colour handler: keep bytes 1-4, set 5-7
  const live = Uint8Array.of(5, 37, 42, 0xAA, 0xBB, 0x01, 0x02, 0x03);
  const c = buildColourConfig({ effect: 5, red: 0xFF, green: 0x00, blue: 0x80, readback: live });
  eq(c[LIGHT_FIELD.BRIGHTNESS], 37, 'colour-only preserves brightness from readback');
  eq(c[LIGHT_FIELD.SPEED], 42, 'colour-only preserves speed from readback');
  eq(c[3], 0xAA, 'colour-only preserves unnamed byte 3');
  eq(c[4], 0xBB, 'colour-only preserves unnamed byte 4');
  eq([c[LIGHT_FIELD.RED], c[LIGHT_FIELD.GREEN], c[LIGHT_FIELD.BLUE]], [0xFF, 0x00, 0x80],
    'colour-only sets R,G,B');

  const cp = parseEffectConfig(c);
  eq(cp.colour.hex, '#ff0080', 'parse returns the colour as hex');
  eq(JSON.stringify(cp.unnamed), JSON.stringify([]), 'parse reports nothing unnamed now');
  eq(cp.fullColor, 0xAA, 'parse exposes fullColor');
  eq(cp.functionFlag, 0xBB, 'parse exposes functionFlag');

  // a brightness change must not clobber colour
  const brightOnly = buildEffectConfig({ effect: 5, brightness: 70, speed: 20, readback: c });
  eq([brightOnly[5], brightOnly[6], brightOnly[7]], [0xFF, 0x00, 0x80],
    'brightness-only preserves the colour');

  for (const [desc, fn] of [
    ['colour channel 256 rejected', () => buildColourConfig({ effect: 0, red: 256, green: 0, blue: 0 })],
    ['colour channel -1 rejected', () => buildColourConfig({ effect: 0, red: 0, green: -1, blue: 0 })],
  ]) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    ok(threw, desc);
  }
}

console.log('0x13 validation');
for (const [desc, fn] of [
  ['effect above range', () => buildEffectConfig({ effect: EFFECT_MAX + 1 })],
  ['effect below range', () => buildEffectConfig({ effect: EFFECT_MIN - 1 })],
  ['non-integer effect', () => buildEffectConfig({ effect: 1.5 })],
  ['brightness 255 rejected (not a 0-255 level)', () => buildEffectConfig({ effect: 0, brightness: 255 })],
  ['brightness above range', () => buildEffectConfig({ effect: 0, brightness: 101 })],
  ['speed 0 rejected (range starts at 1)', () => buildEffectConfig({ effect: 0, speed: 0 })],
  ['speed above range', () => buildEffectConfig({ effect: 0, speed: 101 })],
]) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, desc);
}

console.log('frame construction');
{
  const f = buildFrame(CMD.SET_EFFECT_LIGHT, Uint8Array.of(1, 2, 3), 4, 5);
  eq(f.length, REPORT_SIZE, 'frame is REPORT_SIZE bytes');
  eq(f[0], MAGIC, 'frame[0] is magic');
  eq(f[1], CMD.SET_EFFECT_LIGHT, 'frame[1] is opcode');
  eq(f[2], 4, 'frame[2] is param1 / order');
  eq(f[3], 5, 'frame[3] is param2 / frame');
  eq(f[4], 0, 'frame[4] is retry');
  eq(f[5], 3, 'frame[5] is payload length');
  eq(f[6], 1, 'payload starts at frame[6]');

  let threw = false;
  try { buildFrame(0x13, new Uint8Array(MAX_PAYLOAD + 1)); } catch { threw = true; }
  ok(threw, 'oversized payload is rejected');
}

console.log('0x22 high-key records (PROTOCOL.md 8.3)');
{
  const expect = [
    ['TGL', 0x00, 6], ['MT', 0x01, 11], ['DKS', 0x02, 19],
    ['RS', 0x03, 4], ['OKS', 0x04, 4], ['SOCD', 0x05, 5],
  ];
  eq(Object.keys(KEY_MODIFIERS).length, 6, 'six modifiers');
  eq(Object.keys(HIGH_KEY_LENGTH).length, 6, 'six decoded record shapes');

  // The codes must NOT run in label order -- that was the whole hazard.
  const codes = expect.map(([, id]) => id);
  eq(JSON.stringify(codes), JSON.stringify([0, 1, 2, 3, 4, 5]), 'codes are 0..5 in name order');
  const dialogs = expect.map(([n]) => KEY_MODIFIERS[n].dialog);
  eq(dialogs.includes('QDksAddDialog'), true, 'DKS dialog present');
  // explicitly assert the label order differs from the code order
  const codeOf = (n) => KEY_MODIFIERS[n].id;
  ok(!(codeOf('DKS') < codeOf('MT') && codeOf('MT') < codeOf('TGL')),
    'DKS/MT/TGL codes are NOT in label order (2,1,0)');

  for (const [name, id, len] of expect) {
    const spec = KEY_MODIFIERS[name];
    eq(spec.id, id, `${name} code is ${id}`);
    eq(spec.recordLen, len, `${name} record is ${len} bytes`);
    eq(HIGH_KEY_LENGTH[id], len, `${name} type ${id} length table agrees`);
    eq(spec.dataLen, len - 2, `${name} has ${len - 2} data bytes`);
    const { record } = buildHighKeyBinding({ modifier: name.toLowerCase(), key: 0x2a, data: new Uint8Array(len - 2) });
    eq(record.length, len, `${name} builds a ${len}-byte record`);
    eq(record[0], 0x2a, `${name}: byte 0 is the key`);
    eq(record[1], id, `${name}: byte 1 is the type code`);
    const back = parseHighKeyRecord(record);
    eq(back.modifier, name.toLowerCase(), `${name} round-trips through the parser`);
    eq(back.lengthOk, true, `${name} length validates`);
  }

  const socd = buildSocdRecord({ key: 0x11, key1: 0x22, key2: 0x33, mode: 3 });
  eq(socd.length, 5, 'SOCD record is 5 bytes');
  eq([...socd], [0x11, 0x05, 0x22, 0x33, 0x03], 'SOCD is [key, type, key1, key2, mode]');
  const d = buildSocdRecord({ key: 1 });
  eq([...d], [0x01, 0x05, 0xff, 0xff, 0x00], 'SOCD defaults to 0xFF keys and mode 0');
  for (const mode of [0, 1, 2, 3]) {
    eq(buildSocdRecord({ key: 1, mode })[4], mode, `SOCD mode ${mode} accepted`);
  }

  for (const [desc, fn] of [
    ['unknown modifier rejected', () => buildHighKeyBinding({ modifier: 'nope', key: 1 })],
    ['wrong data length rejected', () => buildHighKeyBinding({ modifier: 'dks', key: 1, data: new Uint8Array(3) })],
    ['SOCD mode 4 rejected', () => buildSocdRecord({ key: 1, mode: 4 })],
  ]) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    ok(threw, desc);
  }
}

console.log('0x40 macro records (PROTOCOL.md 8.10)');
{
  eq(MACRO_RECORD_LEN, 6, 'macro record is 6 bytes');
  eq(MACRO_SLOT_MIN, 0, 'slot range starts at 0');
  eq(MACRO_SLOT_MAX, 9, 'slot range ends at 9 (M1..M10)');
  eq(JSON.stringify(MACRO_WIRE_ORDER), JSON.stringify([1, 0, 2, 3, 4, 5]),
    'wire order transposes bytes 0 and 1');
  eq(MACRO_WIRE_ORDER.length, MACRO_RECORD_LEN, 'permutation covers the whole record');

  const rec = Uint8Array.of(0xa0, 0xb1, 0xc2, 0xd3, 0xe4, 0xf5);
  const p = buildMacroPayload({ slot: 3, records: [rec] });
  eq(p.length, 2 + 6, 'payload is slot + count + one record');
  eq(p[0], 3, 'payload byte 0 is the slot');
  eq(p[1], 1, 'payload byte 1 is the record count');
  eq([...p.subarray(2)], [0xb1, 0xa0, 0xc2, 0xd3, 0xe4, 0xf5],
    'bytes 0 and 1 are transposed on the wire');
  const back = parseMacroRecords(p);
  eq(JSON.stringify(back.records[0].bytes), JSON.stringify([...rec]),
    'round-trips back to struct order');

  // LEN = 6*count + 2, which is what proves the record is 6 bytes.
  const three = buildMacroPayload({ slot: 0, records: [rec, rec, rec] });
  eq(three.length, 2 + 3 * 6, 'three records make a 20-byte payload');

  for (const [desc, fn] of [
    ['slot 10 rejected', () => buildMacroPayload({ slot: 10, records: [] })],
    ['slot -1 rejected', () => buildMacroPayload({ slot: -1, records: [] })],
    ['short record rejected', () => buildMacroPayload({ slot: 0, records: [Uint8Array.of(1, 2, 3)] })],
    ['long record rejected', () => buildMacroPayload({ slot: 0, records: [new Uint8Array(7)] })],
  ]) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    ok(threw, desc);
  }
}

console.log('0x2A keymap records (PROTOCOL.md section 7)');
{
  // The observed hardware run 0x29, 0x3a..0x42 decodes to Escape, F1..F9.
  const page = [];
  for (const c of [0x29, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42]) {
    page.push(0x00, 0x01, c);
  }
  const recs = parseKeymap([Uint8Array.from(page)]);
  eq(recs.length, 10, 'ten 3-byte records');
  eq(recs.map((r) => r.name), ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'],
    'the run decodes to Escape then F1-F9');
  // Wire order is the permuted one, not schema order: the 0x20 builder emits
  // rec[1], rec[3], rec[2], so byte 1 is lValue and byte 2 is hValue. Reading
  // the DDL and dropping keyItem would swap these two and put the usage in the
  // wrong column.
  eq(recs[0].type, 0x00, 'wire byte 0 is type');
  eq(recs[0].lValue, 0x01, 'wire byte 1 is lValue');
  eq(recs[0].hValue, 0x29, 'wire byte 2 is hValue, and it holds the HID usage');
  eq(recs[0].name, 'Esc', 'the HID usage is decoded from hValue');
  // keyItem is not sent; it is implied by position (PROTOCOL.md 8.13), so the
  // fourth column of keyboard_fn_table never appears on the wire.
  eq(recs[0].keyItem, 0, 'the first record is bound to keyItem 0');
  eq(recs[9].keyItem, 9, 'the tenth record is bound to keyItem 9');
  eq(KEYMAP_RECORD_LEN, 3, 'the wire record is three bytes: keyItem is omitted');

  // The earlier doc claim that this run is ') : ; < ...' was wrong:
  // ';' and '<' are 0x33 and 0x36, not 0x3b and 0x3c.
  eq(keyName(0x3b), 'F2', '0x3b is F2, not semicolon');
  eq(keyName(0x33), ';', 'semicolon really is 0x33');
  eq(keyName(0x36), ',', '0x36 is comma');
  // Shifted symbols have no usage of their own ('<' is Shift+Comma, '>' is
  // Shift+Period), which is why the decoder never invents a name for them.
  eq(keyName(0x3e), 'F5', '0x3e is F5');
  eq(keyName(0x37), '.', 'period is 0x37');

  // Unknown codes must stay numeric rather than being invented.
  eq(keyName(0xf7), '0xf7', 'unknown usage stays numeric');
  eq(keyName(0x29), 'Esc', 'Escape maps correctly');

  // A remapped table is detectable: key 0 maps to A (0x04), keys 1..3 map to
  // themselves, so exactly one record differs from the stock identity.
  const remap = [0x00, 0x01, 0x04, 0x00, 0x01, 0x01, 0x00, 0x01, 0x02, 0x00, 0x01, 0x03];
  const rr = parseKeymap([Uint8Array.from(remap)]);
  eq(rr.length, 4, 'four key records');
  eq(rr.filter((r) => r.usage !== r.index).length, 1, 'exactly one key is remapped');
  eq(rr[0].name, 'A', 'the remapped key decodes to its new binding');
}

console.log('completion audit: spec, code and binary agree (PROTOCOL.md section 12)');
{
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');

  // The 39 request opcodes and 40 dispatched responses, recovered from the binary
  // by pairing each UsbCommunicateUtil log string with its 0xFA frame write
  // (PROTOCOL.md 4.6) and reading the 98-byte dispatch table at 0x140089a04.
  // Hardcoded here on purpose: this is the independent ground truth the rest of
  // the project is checked against, so it must not be derived from the same code
  // it is meant to audit.
  const REQUESTS = [0x10, 0x11, 0x13, 0x14, 0x16, 0x17, 0x18, 0x19, 0x20, 0x22, 0x23,
    0x24, 0x25, 0x26, 0x27, 0x28, 0x2a, 0x2b, 0x2c, 0x40, 0x41, 0x42, 0x50, 0x52,
    0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5b, 0x5e, 0x60, 0x61, 0x62, 0x63,
    0x65, 0x66];
  const RESPONSES = [0x90, 0x91, 0x93, 0x94, 0x96, 0x97, 0x98, 0x99, 0xa0, 0xa1,
    0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xaa, 0xab, 0xac, 0xc0, 0xc1, 0xc2,
    0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xdb, 0xde, 0xe0,
    0xe1, 0xe2, 0xe3, 0xf1];
  eq(REQUESTS.length, 39, 'ground truth: 39 request opcodes');
  eq(RESPONSES.length, 40, 'ground truth: 40 dispatched responses');

  // 1. Every request is classified read/write. An unclassified opcode is the one
  //    failure mode that could let a sweep reach the board.
  const unclassified = REQUESTS.filter((o) => commandClass(o) === 'unknown');
  eq(unclassified, [], 'every request opcode is classified read or write');

  // 2. Every request and response has a name.
  const unnamed = [...REQUESTS, ...RESPONSES].filter((o) => !OPCODE_NAME[o]);
  eq(unnamed, [], 'every opcode has a name');

  // 3. PROTOCOL.md section 3 documents every request.
  const sec3 = md.slice(md.indexOf('## 3. Command table'), md.indexOf('### 3.1'));
  const inS3 = new Set([...sec3.matchAll(/`0x([0-9A-Fa-f]{2})`/g)].map((m) => parseInt(m[1], 16)));
  eq(REQUESTS.filter((o) => !inS3.has(o)), [], 'section 3 documents every request');

  // 4. The parity audit has one row per request, no more and no fewer.
  const parity = md.slice(md.indexOf('## 12. Feature-parity'));
  const inParity = new Set([...parity.matchAll(/^\| `0x([0-9A-F]{2})`/gm)].map((m) => parseInt(m[1], 16)));
  eq(REQUESTS.filter((o) => !inParity.has(o)), [], 'every request appears in the parity audit');
  eq([...inParity].filter((o) => !REQUESTS.includes(o)), [],
    'the parity audit invents no requests');

  // 5. PROTOCOL.md section 4.1 documents every dispatched response, and the code
  //    table agrees with it row for row.
  const sec4 = md.slice(md.indexOf('### 4.1 The receive thread'), md.indexOf('### 4.2'));
  const rows = [...sec4.matchAll(/^\| `(0x[0-9A-F]{2})` \| \d+ \|[^|]*\|\s*([a-z_]+)\s*\|/gm)];
  const mdMap = new Map(rows.map((m) => [parseInt(m[1], 16), m[2]]));
  eq(RESPONSES.filter((o) => !mdMap.has(o)), [], 'section 4.1 documents every response');
  const nameDrift = RESPONSES.filter((o) => RESPONSE_DISPATCH[o] !== mdMap.get(o));
  eq(nameDrift, [], 'response names agree between PROTOCOL.md and protocol.js');

  // 6. response = request + 0x80 for everything that pairs up, which is the rule
  //    the whole driver relies on to know what to wait for.
  const orphan = RESPONSES.filter((o) => !REQUESTS.includes(o - 0x80));
  eq(orphan.sort((a, b) => a - b), [0xa1, 0xd1, 0xf1],
    'exactly three responses have no request');

  // 7. The solved table must not accumulate duplicates or stale counts. Both have
  //    happened in this project; neither is visible from the table itself.
  const solved = md.slice(md.indexOf('## 10.1 What is solved'), md.indexOf('## 11.'));
  const items = [...solved.matchAll(/^\| (.+?) \| (§[^|]+) \|$/gm)].map((m) => m[1].trim());
  const dupes = items.filter((it, i) => items.indexOf(it) !== i);
  eq(dupes, [], 'the solved table has no duplicate entries');
  const stale = [...solved.matchAll(/\b(\d+)\/(\d+)\/(\d+)\b/g)];
  for (const m of stale) {
    const parity = md.slice(md.indexOf('## 12. Feature-parity'));
    const prose = parity.match(/(\d+) exposed, (\d+) deliberately gated, (\d+) refused/);
    eq([m[1], m[2], m[3]], [prose[1], prose[2], prose[3]],
      `the solved table's "${m[0]}" matches the parity audit`);
  }

  // 8. Every section referenced by the solved table must actually exist.
  const sections = new Set([...md.matchAll(/^#{2,4} (\d+(?:\.\d+)*)/gm)].map((m) => m[1]));
  const dangling = [...solved.matchAll(/§(\d+(?:\.\d+)*)/g)]
    .map((m) => m[1])
    .filter((r) => !sections.has(r) && !sections.has(r.split('.')[0]));
  eq([...new Set(dangling)], [], 'every section the solved table cites exists');
}

console.log('PROTOCOL.md section numbering is monotonic');
{
  const fs = await import('node:fs');
  // Two real mistakes hid behind out-of-order headings: a citation that pointed
  // one section early still parsed as valid text, so it read the wrong table and
  // reported missing documentation. Ordering is a real invariant, so it is
  // checked rather than assumed.
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  const heads = [...md.matchAll(/^#{3,4} (8\.\d+(?:\.\d+)?) /gm)].map((m) => m[1]);
  ok(heads.length > 20, 'PROTOCOL.md section 8 has substantial content');
  const asNum = (h) => h.split('.').map(Number);
  const outOfOrder = [];
  for (let i = 0; i < heads.length - 1; i += 1) {
    const a = asNum(heads[i]);
    const b = asNum(heads[i + 1]);
    // Compare numerically, not as strings: '8.9' > '8.10' lexically.
    let bad = false;
    for (let k = 0; k < Math.max(a.length, b.length); k += 1) {
      const x = a[k] ?? -1;
      const y = b[k] ?? -1;
      if (x !== y) { bad = x > y; break; }
    }
    if (bad) outOfOrder.push(`${heads[i]} before ${heads[i + 1]}`);
  }
  eq(outOfOrder, [], 'section headings run in ascending numeric order');
  eq(heads[0], '8.1', 'the section list starts at 8.1');
}

console.log('the keymap wire order is permuted, and the spec says so (8.18.3)');
{
  const fs = await import('node:fs');
  // The permutation itself. rec[1], rec[3], rec[2] at 0x1400a88d3/e3/f4.
  eq(KEYMAP_WIRE_PERMUTATION, [1, 3, 2], 'wire byte i is record byte KEYMAP_WIRE_PERMUTATION[i]');
  // Schema order minus keyItem would be [1, 2, 3]. Asserting it is NOT that is
  // the finding: the swap is what makes hValue the usage byte.
  eq(JSON.stringify(KEYMAP_WIRE_PERMUTATION) === JSON.stringify([1, 2, 3]), false,
    'the wire is not schema order with keyItem dropped');
  eq(KEYMAP_WIRE_FIELD, ['type', 'lValue', 'hValue'],
    'wire byte 1 is lValue and wire byte 2 is hValue, in that order');

  // Now check the spec actually says the same thing. A doc that quietly
  // reverts to the schema-order story would otherwise pass every other test,
  // because the code would still be right - the prose would just be lying.
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  const sec = md.slice(md.indexOf('### 8.18 The keymap record'));
  ok(/rec\[1\], rec\[3\], rec\[2\]/.test(sec),
    'PROTOCOL.md 8.18 states the permuted order');
  ok(/\[type, lValue, hValue\]/.test(sec),
    'PROTOCOL.md 8.18 states the wire order in wire terms');
  ok(!/This is not resolved/.test(sec),
    'PROTOCOL.md no longer claims the hValue question is unresolved');
  // Negative assertion, because the positive one above is satisfied by the code
  // block regardless of what the prose claims. Injected fault: rewriting the
  // verdict sentence to "the wire IS schema order" changed no assertion until
  // this one existed.
  ok(!/wire IS schema order/i.test(sec),
    'PROTOCOL.md does not claim the wire is schema order');
  // Scope the "still open" check to the verdict subsection, where the reading is
  // actually settled. "open" appears legitimately elsewhere in the section.
  const verdict = sec.slice(sec.indexOf('#### 8.18.3'), sec.indexOf('#### 8.18.4'));
  ok(verdict.length > 0, 'PROTOCOL.md 8.18.3 exists');
  for (const hedge of [/not resolved/i, /remains open/i, /still open/i, /unresolved/i]) {
    ok(!hedge.test(verdict),
      `PROTOCOL.md 8.18.3 does not hedge the reading (${hedge})`);
  }
  // The doc's layer range must match the code. Checking only that the text says
  // something about layers is satisfied by any wording; check the range itself.
  // Scope the range check to the HEADLINE paragraph. Checking the whole section
  // is satisfied by any incidental "0 or 1" further down: injected fault
  // "up to eight legal values" in the headline passed a section-wide check.
  const headline = sec.slice(sec.indexOf('\n', sec.indexOf('### 8.19')),
    sec.indexOf('#### 8.19.1'));
  ok(/two legal values/.test(headline),
    'PROTOCOL.md 8.19 headlines exactly two legal layer values');
  ok(!/eight|0 to 7|0-7|0\.\.7|up to /.test(headline),
    'PROTOCOL.md 8.19 headline claims no wider layer range than the builder accepts');
  ok(KEYMAP_LAYER_MAX === 1, 'the builder accepts exactly layers 0 and 1');
  ok(KEYMAP_LAYER_MIN === 0, 'the builder accepts layer 0');
  ok(!/0 to 7|0-7|0\.\.7/.test(sec),
    'PROTOCOL.md 8.19 does not claim a wider layer range anywhere in the section');
  ok(/assumption was wrong/i.test(verdict),
    'PROTOCOL.md 8.18.3 says plainly that the schema-order assumption was wrong');
  // The permutation has to be stated as an explicit claim, not merely appear in
  // an assembly comment.
  ok(/permutation\s*\n?is\s*`\[1, 3, 2\]`/.test(sec),
    'PROTOCOL.md states the permutation as a claim, not only in a listing');
  // And the resolved reading must be the one the parser implements.
  const recs = parseKeymap([new Uint8Array([0x00, 0x01, 0x29])]);
  eq(recs[0][KEYMAP_WIRE_FIELD[1]], 0x01, 'the byte the spec calls lValue is lValue');
  eq(recs[0][KEYMAP_WIRE_FIELD[2]], 0x29, 'the byte the spec calls hValue is hValue');
}

console.log('the keymap layer is sender+0xC0, and only 0 and 1 are legal (8.20)');
{
  eq(KEYMAP_LAYER_MIN, 0, 'layer 0 is the low bound');
  eq(KEYMAP_LAYER_MAX, 1, 'layer 1 is the high bound');
  eq(isValidKeymapLayer(0), true, 'layer 0 is accepted');
  eq(isValidKeymapLayer(1), true, 'layer 1 is accepted');
  // 0x20 compares against 1 and bails out otherwise, so 2 is not a third layer.
  eq(isValidKeymapLayer(2), false, 'layer 2 is rejected: the app sends an empty body');
  eq(isValidKeymapLayer(-1), false, 'a negative layer is rejected');
  eq(isValidKeymapLayer(1.5), false, 'a fractional layer is rejected');
  eq(isValidKeymapLayer('0'), false, 'a string layer is rejected, not coerced');

  const recs = parseKeymap([new Uint8Array([
    0x00, 0x01, 0x29, 0x00, 0x01, 0x3a, 0x00, 0x01, 0x3b,
  ])]);
  const p0 = buildKeymapPayload(recs, 0);
  eq(Array.from(p0.slice(0, 2)), [0, 0], 'payload is [layer, first keyItem]');
  // Assert the layer is actually placed, not merely present: checking only layer
  // 0 cannot tell a correct byte 0 from a hardcoded zero, because 0 IS the legal
  // value for layer 0.
  eq(buildKeymapPayload(recs, 1)[0], 1, 'layer 1 lands in payload byte 0');
  eq(buildKeymapPayload(recs, 0)[0], 0, 'layer 0 lands in payload byte 0');
  // Same trap for byte 1. parseKeymap always numbers the first record keyItem 0,
  // so a builder that ignored the field and wrote a zero would pass every
  // read-derived test. Use a record whose keyItem is not 0.
  const shifted = [{ keyItem: 7, type: 2, lValue: 3, hValue: 0x62 }];
  eq(buildKeymapPayload(shifted, 0)[1], 7,
    'byte 1 carries the first entry keyItem, not a literal zero');
  eq(buildKeymapPayload(shifted, 1)[1], 7, 'and does so for layer 1 as well');
  eq(Array.from(p0.slice(2)), [0x00, 0x01, 0x29, 0x00, 0x01, 0x3a, 0x00, 0x01, 0x3b],
    'each entry is type, lValue, hValue in wire order');
  eq(p0[1], recs[0].keyItem, 'byte 1 is the FIRST entry keyItem, not a count');

  // The builder computes LEN as 3*count + 2; the payload must be exactly that
  // long, which is an independent check the two agree.
  for (const n of [1, 2, 10, 85]) {
    const rs = parseKeymap([new Uint8Array(
      Array.from({ length: n }, () => [0, 1, 0x29]).flat())]);
    const pl = buildKeymapPayload(rs, 0);
    eq(pl.length, keymapPayloadLen(n), `payload length matches LEN for ${n} keys`);
    eq(pl.length, 3 * n + 2, `LEN formula is 3*n+2 for ${n} keys`);
  }

  // Round trip: what a read produces must rebuild the same bytes.
  const back = parseKeymap([buildKeymapPayload(recs, 0).subarray(2)]);
  eq(back.map((r) => [r.type, r.lValue, r.hValue]),
    recs.map((r) => [r.type, r.lValue, r.hValue]),
    'records survive a write/read round trip unchanged');
  eq(back.map((r) => r.name), recs.map((r) => r.name),
    'and still decode to the same key names');

  // A write must be refused rather than silently clamped: clamping layer 3 to 1
  // would send a valid-looking frame that edits the wrong layer.
  for (const bad of [2, -1, 1.5, '0', null, undefined]) {
    let threw = false;
    try { buildKeymapPayload(recs, bad); } catch { threw = true; }
    eq(threw, true, `an invalid layer (${String(bad)}) is refused, not clamped`);
  }
  let emptyThrew = false;
  try { buildKeymapPayload([], 0); } catch { emptyThrew = true; }
  eq(emptyThrew, true, 'an empty keymap is refused rather than sending a header-only frame');

  // The record bodies must not be mutated by the builder.
  const before = JSON.stringify(recs);
  buildKeymapPayload(recs, 1);
  eq(JSON.stringify(recs), before, 'building a payload does not mutate the records');
}

console.log('the 0x11 leading byte is the first keyItem, not a flag (8.13.2)');
{
  const recs = [
    { keyItem: 3, light: 1, r: 0xff, g: 0x00, b: 0x00 },
    { keyItem: 4, light: 1, r: 0x00, g: 0xff, b: 0x00 },
  ];
  const p = buildCustomLightPayload(recs);
  // Deliberately non-zero first keyItem. A builder that wrote a literal 0 or a
  // guessed flag constant would satisfy an assertion using keyItem 0, which is
  // what parseCustomLight produces for the first record.
  eq(p[0], 3, 'byte 0 is the FIRST entry keyItem, not a flag and not zero');
  eq(Array.from(p.slice(1)), [1, 0xff, 0, 0, 1, 0, 0xff, 0],
    'each entry then contributes light, R, G, B in order');
  eq(CUSTOM_LIGHT_WRITE_RECORD_LEN, 4, 'the per-entry body is four bytes');
  eq(p.length, customLightPayloadLen(2), 'payload length matches the LEN byte');
  eq(customLightPayloadLen(2), 9, 'LEN is 4*count + 1');

  for (const n of [1, 2, 10, 85]) {
    const rs = Array.from({ length: n }, (_, i) => ({ keyItem: i, light: 0, r: 1, g: 2, b: 3 }));
    eq(buildCustomLightPayload(rs).length, customLightPayloadLen(n), `LEN matches for ${n} keys`);
    eq(customLightPayloadLen(n), 4 * n + 1, `LEN formula holds for ${n} keys`);
  }

  // Assert the SPECIFIC refusal. "something threw" is satisfied by an unrelated
  // crash: injected fault E removed the guard entirely, which made
  // records[0].keyItem throw a TypeError on the empty array, and this assertion
  // passed while the guard it was written to protect was gone.
  let err = null;
  try { buildCustomLightPayload([]); } catch (e) { err = e; }
  eq(err !== null, true, 'an empty per-key list is refused rather than sent header-only');
  eq(err instanceof RangeError, true, 'the refusal is a RangeError, not an incidental crash');
  ok(/at least one key/.test(err?.message ?? ''), 'and it says why');

  // The records must survive unchanged, and a differing first keyItem must show
  // up in byte 0.
  const before = JSON.stringify(recs);
  buildCustomLightPayload(recs);
  eq(JSON.stringify(recs), before, 'building does not mutate the records');
  eq(buildCustomLightPayload([{ ...recs[0], keyItem: 200 }, recs[1]])[0], 200,
    'a different first keyItem lands in byte 0');
}

console.log('0x11 is paged so a full table fits the 58-byte frame budget');
{
  // The builder's LEN is 4*count + 1, so the largest page that fits one report
  // is 14 records (57 bytes). This is arithmetic on two recovered constants, not
  // a hardware assumption.
  eq(CUSTOM_LIGHT_PAGE_RECORDS, 14, '14 records per 0x11 frame');
  ok(customLightPayloadLen(CUSTOM_LIGHT_PAGE_RECORDS) <= MAX_PAYLOAD,
     `a full page (${customLightPayloadLen(CUSTOM_LIGHT_PAGE_RECORDS)} B) fits the ${MAX_PAYLOAD}-byte budget`);
  ok(customLightPayloadLen(CUSTOM_LIGHT_PAGE_RECORDS + 1) > MAX_PAYLOAD,
     '15 records would not fit, so 14 is the bound and not an arbitrary choice');

  const recs = Array.from({ length: 85 }, (_, i) => ({
    keyItem: i, light: 1, r: i & 0xff, g: (i * 2) & 0xff, b: (i * 3) & 0xff,
  }));
  const pages = pageCustomLightPayloads(recs);
  eq(pages.length, 7, '85 keys split into 7 pages');
  eq(pages.map((p) => p.count), [14, 14, 14, 14, 14, 14, 1],
     'six full pages then the 1-key remainder');
  eq(pages.map((p) => p.page), [1, 2, 3, 4, 5, 6, 7], 'pages are numbered from 1');
  eq(new Set(pages.map((p) => p.totalPages)), new Set([7]),
     'every page carries the same last-page number');

  for (const p of pages) {
    eq(p.payload.length, customLightPayloadLen(p.count),
       `page ${p.page} LEN matches its record count`);
    ok(p.payload.length <= MAX_PAYLOAD, `page ${p.page} fits the frame budget`);
    eq(p.payload[0], recs[p.startOffset].keyItem,
       `page ${p.page} leads with its own first keyItem, not page 1's`);
    eq(p.payload.length, 4 * p.count + 1, `page ${p.page} is columnar`);
  }
  eq(pages.reduce((n, p) => n + p.count, 0), 85, 'every key is written exactly once');

  // A table that already fits must still be a single frame - paging must not
  // split a small write, since the device would then get an empty page 2.
  const small = pageCustomLightPayloads(recs.slice(0, 5));
  eq(small.length, 1, 'a small table stays one frame');
  eq(small[0].payload.length, 21, 'and keeps LEN = 4*5 + 1');
}

console.log('PROTOCOL.md 8.9.1 records the trigger body as a verbatim copy');
{
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  const sec = md.slice(md.indexOf('#### 8.9.1'), md.indexOf('### 8.10'));
  ok(sec.length > 0, 'PROTOCOL.md 8.9.1 exists');
  ok(/verbatim/i.test(sec), '8.9.1 states the copy is verbatim');
  // The finding is the ABSENCE of a permutation, so pin the instruction that
  // proves it rather than the prose: a straight load/store loop with no
  // reordering, evidenced by the source and destination indices both advancing
  // by one.
  // Match the instructions themselves, not the bare addresses: 0x1400ab7d0 also
  // appears as the branch target two lines later, so an address-only assertion
  // stayed satisfied when the load it was meant to pin was deleted.
  ok(/0x1400ab7d0: mov\s+rax,QWORD PTR \[rbx\+0x270\]/.test(sec),
    '8.9.1 pins the source-array load');
  ok(/0x1400ab7e0: mov\s+BYTE PTR \[rdx\+rcx\*1\],al/.test(sec),
    '8.9.1 pins the destination store');
  ok(/0x1400ab7e3: lea\s+rdx,\[rdx\+0x1\]/.test(sec)
    && /0x1400ab7e7: lea\s+r8,\[r8\+0x1\]/.test(sec),
    '8.9.1 shows both indices advancing by one, which is what makes it a copy');
  ok(/no permutation|not a question this builder can answer/i.test(sec),
    '8.9.1 says plainly that there is no permutation here');
  // And the offset-collision warning, since that is the trap that would waste
  // the next attempt.
  ok(/widget pointer/i.test(sec), '8.9.1 records that +0x270 also names a Qt widget');
  ok(/not an identity|offset match is\s+not an identity/i.test(sec),
    'and warns that an offset match is not an identity');
}

console.log('PROTOCOL.md 8.13.2 states the leading byte is keyItem');
{
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  // Bound at 8.13.3, not 8.13.4: 8.13.4 does not exist, so indexOf returns -1
  // and the slice runs to end-of-file, swallowing 8.13.3 - which legitimately
  // uses the phrase "global flag" to describe the mistake. Scoping to the wrong
  // end made the negative assertion fire on correct text.
  const sec = md.slice(md.indexOf('#### 8.13.2'), md.indexOf('#### 8.13.3'));
  ok(sec.length > 0, 'PROTOCOL.md 8.13.2 exists');
  ok(/byte 0 is `keyItem`/.test(sec), '8.13.2 names byte 0 as keyItem');
  // Negative assertion: 8.13.1 concluded "global flag" and 8.13.3 records that as
  // the mistake, so the phrase legitimately appears in 8.13.3 - scope to 8.13.2.
  ok(!/global flag/i.test(sec),
    '8.13.2 does not itself claim the leading byte is a flag');
  ok(/0x1400a67cd/.test(sec) && /0x1400a67d5/.test(sec),
    '8.13.2 carries the instruction evidence for the leading byte');
  // And 8.13.3 must actually name the superseded claim as superseded.
  const why = md.slice(md.indexOf('#### 8.13.3'), md.indexOf('### 8.14'));
  ok(/global flag/i.test(why), '8.13.3 records that the flag reading was the mistake');
  ok(/backwards|wrong/i.test(why), 'and says so plainly');
}

console.log('keymap field names come from assembly, not from a guess (8.18)');
{
  const page = new Uint8Array([0x00, 0x01, 0x29, 0x00, 0x01, 0x3a]);
  const recs = parseKeymap([page]);

  // The parser used to call these three bytes modifier / layer / usage. Two of
  // those were wrong: there is no per-record modifier, and there is no
  // per-record layer - the layer qualifies the whole read, not each record. Pin
  // the removal so the wrong names cannot creep back in.
  eq('modifier' in recs[0], false, 'there is no per-record modifier field');
  eq('layer' in recs[0], false, 'there is no per-record layer field');
  eq(recs[0].type, 0x00, 'byte 0 is type');
  eq(recs[0].lValue, 0x01, 'byte 1 is lValue, not hValue');
  eq(recs[0].hValue, 0x29, 'byte 2 is hValue and holds the HID usage');
  eq(recs[0].usage, 0x29, 'usage is an alias for hValue, not for lValue');

  // keyItem is column 0 of keyboard_fn_table but is not sent; position carries
  // it. A record therefore has to expose keyItem, and it must count up.
  eq(recs.map((r) => r.keyItem), [0, 1], 'keyItem counts up from position');
  eq(recs[1].hValue, 0x3a, 'the second record decodes its own hValue');
  eq(recs[1].name, 'F1', 'the second record names its own key');

  // The old code treated a key as remapped when usage !== index. That compares a
  // HID usage code against a record position: on a factory-fresh board record 0
  // holds Escape (0x29), so every key would read as changed. Assert the two are
  // genuinely different quantities so that mistake cannot be reintroduced.
  eq(recs[0].lValue === recs[0].keyItem, false,
    'a HID usage is not a record index, so they cannot be compared for equality');
}

console.log('snapshot sections decode, and never throw (PROTOCOL.md section 8.17)');
{
  const WP = [0xff, 1, 10, 0, 20, 0, 8, 3, 0, 1, 2, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff];
  const wp = decodeSnapshotSection('wholeParam', { payload: WP });
  eq(wp.pollingRate, 8, 'wholeParam decodes');
  eq(wp.deadDown, 10, 'wholeParam decodes its u16 field');

  const cl = decodeSnapshotSection('customLight', {
    pages: [new Uint8Array([0, 1, 0xff, 0, 0, 1, 1, 0, 0xff, 0])],
  });
  eq(cl.records.map((r) => r.hex), ['#ff0000', '#00ff00'], 'customLight decodes per key');

  const kc = decodeSnapshotSection('keyboardConfig', {
    pages: [new Uint8Array([0, 1, 0x29, 0, 1, 0x3a])],
  });
  eq(kc.map((r) => r.name), ['Esc', 'F1'], 'keyboardConfig decodes to key names');

  // A section with no decoder must be null, not a guess.
  eq(decodeSnapshotSection('productInfo', { payload: [1, 2, 3] }), null,
    'a table with no decoder reports null rather than a guess');
  eq(decodeSnapshotSection('triggerConfig', { pages: [] }), null,
    'the trigger table has no decoder yet');

  // A failed section and malformed input must both degrade to null. A decoder
  // must never be able to fail a snapshot - the raw bytes are the backup.
  eq(decodeSnapshotSection('wholeParam', { error: 'timeout' }), null,
    'a failed section decodes to null');
  eq(decodeSnapshotSection('wholeParam', { payload: [1, 2] }), null,
    'a truncated payload decodes to null instead of throwing');
  eq(decodeSnapshotSection('customLight', { payload: 'not-a-page' }), null,
    'a section without pages decodes to null');

  // High-key records are variable length, so the walker must use each type's
  // declared length rather than a fixed stride.
  const tgl = [0x00, 0x04, 0x11, 0x00, 0x00, 0x00];          // 6 bytes
  const recs = decodeHighKeyRecords([new Uint8Array([...tgl, ...tgl])]);
  eq(recs.length, 2, 'two variable-length records decoded from one page');
  eq(recs[0].offset, 0, 'first record at offset 0');
  eq(recs[1].offset, 6, 'second record starts after the first record length');

  // An unknown type must be reported, not skipped past.
  const bad = decodeHighKeyRecords([new Uint8Array([0xfe, 1, 2])]);
  eq(bad.length, 1, 'an unknown modifier type produces one report');
  ok(/unknown modifier/.test(bad[0].error ?? ''), 'and it says the type is unknown');

  // A truncated trailing record must be reported rather than read past the end.
  const trunc = decodeHighKeyRecords([new Uint8Array([0x00, 1, 2])]);
  eq(trunc.length, 1, 'a truncated record produces one report');
  ok(/truncated/.test(trunc[0].error ?? ''), 'and it says the record is truncated');
}

console.log('per-key colour read (PROTOCOL.md section 8.12, custom_light_table)');
{
  // The READ format is 5 bytes per key: keyItem, light, R, G, B. Note this is a
  // different shape from the 0x11 WRITE, which is columnar and positional
  // (section 8.13.1) - read and write formats were never required to match.
  eq(CUSTOM_LIGHT_RECORD_LEN, 5, 'a per-key colour record is 5 bytes');
  const page = new Uint8Array([
    0, 1, 0xff, 0x00, 0x00,
    1, 1, 0x00, 0xff, 0x00,
    2, 0, 0x00, 0x00, 0xff,
  ]);
  const r = parseCustomLight([page]);
  eq(r.records.length, 3, 'three keys decoded');
  eq(r.trailing, 0, 'no trailing bytes');
  eq(r.records[0].keyItem, 0, 'byte 0 is keyItem');
  eq(r.records[0].light, 1, 'byte 1 is light');
  eq(r.records[0].hex, '#ff0000', 'bytes 2-4 are R,G,B');
  eq(r.records[1].hex, '#00ff00', 'second key is green');
  eq(r.records[2].light, 0, 'light is per-record, not fixed');
  eq(r.records[2].hex, '#0000ff', 'third key is blue');

  // A partial trailing record must be reported, not silently dropped.
  const odd = parseCustomLight([new Uint8Array([0, 1, 2, 3, 4, 5])]);
  eq(odd.records.length, 1, 'one whole record from six bytes');
  eq(odd.trailing, 1, 'the odd byte is reported as trailing');

  // Pages concatenate before decoding, which is how the reader delivers them.
  const two = parseCustomLight([
    new Uint8Array([0, 1, 1, 1, 1]),
    new Uint8Array([1, 1, 2, 2, 2]),
  ]);
  eq(two.records.length, 2, 'records spanning two pages decode');
  eq(two.records[1].keyItem, 1, 'the second record comes from the second page');

  eq(Object.keys(CUSTOM_LIGHT_FIELD).length, 5, 'all five fields are named');
  eq(CUSTOM_LIGHT_FIELD.BLUE, 4, 'blue is byte 4');
}

console.log('moc blob order is the signal order (PROTOCOL.md section 8.18.1)');
{
  // Blob position == Qt signal index, for all 40 dispatched responses. This is
  // the one direction in which the moc string-data blob is authoritative; it
  // cannot be used for request opcodes (section 4.6).
  const fs = await import('node:fs');
  // The target binary lives outside the repo, so this block is skipped rather
  // than failed when it is absent - a checkout without it must still pass.
  const EXE = process.env.APEX_EXE ?? '/tmp/opencode/apex200/extracted/app/GameKeyboard.exe';
  if (!fs.existsSync(EXE)) {
    console.log('  skip  moc blob check - target binary not at', EXE);
  } else {

  // The blob list, as read from .rdata and recorded in PROTOCOL.md 8.18.
  const BLOB = [
    'error', 'set_custom_light', 'set_custom_light_all', 'set_effect_light',
    'set_effect_light_all', 'get_custom_light_all', 'get_effect_light',
    'select_effect_light', 'get_effect_light_name', 'set_key', 'set_key_function',
    'set_high_key', 'set_high_key_more', 'set_key_default', 'del_high_key',
    'set_trigger', 'set_quick_trigger', 'set_trigger_all', 'get_key_config',
    'get_high_key_config', 'get_trigger_config', 'set_macro', 'del_macro',
    'get_macro_all', 'set_whole_config', 'start_calibration',
    'start_calibration_config', 'open_calibration_time', 'save_calibration',
    'get_calibration_adc', 'set_current_config_table', 'set_config_table_info',
    'get_config_table', 'add_config_table', 'del_configure_table',
    'get_whole_config', 'fireware_download', 'reset', 'get_product_info',
    'fireware_download_end', 'config_change',
  ];
  eq(BLOB.length, 41, 'the blob holds 41 names: signal 0 is unused');

  // PROTOCOL.md 8.18 records the response -> signal -> name chain. Check that
  // every row's name is BLOB[signal index] and that all 40 are present.
  const sec = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  // Locate the handler table by shape, not by section number. Adding a section
  // upstream renumbers everything below it, and a hardcoded citation then
  // silently reads the wrong table and reports it as missing rows - a failure
  // that looks like lost documentation but is only a moved heading.
  //
  // "Right shape" means: a `### x.y` heading, and beneath it the most rows of
  // the form `| 0xNN | <int> | name |`. Ties break toward the later section, so
  // this picks the response-to-handler table over any other opcode listing.
  const sections = [...sec.matchAll(/^### \d+\.\d+ .+$/gm)]
    .map((h, i, all) => {
      const from = h.index + h[0].length;
      const next = all[i + 1] ? all[i + 1].index : sec.length;
      return { body: sec.slice(from, next), index: i };
    });
  const countRows = (body) => [...body.matchAll(/^\| `0x[0-9A-F]{2}` \| \d+ \| `[a-z_]+` \|/gm)].length;
  let picked = sections[0];
  for (const s2 of sections) {
    if (countRows(s2.body) >= countRows(picked.body)) picked = s2;
  }
  ok(countRows(picked.body) > 0, 'PROTOCOL.md has a response-to-handler table');
  const rows = [...picked.body.matchAll(/^\| `0x([0-9A-F]{2})` \| (\d+) \| `([a-z_]+)` \|/gm)];
  eq(rows.length, 40, 'the handler table documents all 40 dispatched responses');
  const wrong = rows.filter((m) => BLOB[Number(m[2])] !== m[3]);
  eq(wrong.map((m) => `${m[1]}:${m[3]}`), [],
    'every signal name in the table is the blob name at that signal index');
  const opcodes = new Set(rows.map((m) => parseInt(m[1], 16)));
  // Object.keys gives decimal strings for numeric literals, so Number(), not
  // parseInt(.., 16).
  const dispatched = Object.keys(RESPONSE_DISPATCH).map(Number);
  eq(dispatched.filter((o) => !opcodes.has(o)), [],
    'the table covers every dispatched response');
  // 7 and 8 are the only pair out of opcode order, and section 4.1 says so.
  const byOp = new Map(rows.map((m) => [parseInt(m[1], 16), Number(m[2])]));
  eq(byOp.get(0x99), 7, '0x99 is signal 7');
  eq(byOp.get(0x98), 8, '0x98 is signal 8');
  }
}

console.log('whole-parameter blob (PROTOCOL.md section 8.14)');
{
  // LEN = 0x14, and the builder writes [0xFF] + params[1..10] + 0xFF x 9.
  const raw = [0xff, 0x01, 0x0a, 0x00, 0x14, 0x00, 0x08, 0x03, 0x00, 0x01, 0x02,
               0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  eq(raw.length, WHOLE_PARAM_LEN, 'the blob is 20 bytes');
  const p = parseWholeParams(raw);
  eq(p.reserve, 0xff, 'reserve is the constant 0xFF');
  eq(p.touchOptimize, 1, 'byte 1 is touchOptimize');
  eq(p.deadDown, 10, 'bytes 2-3 are a little-endian deadDown');
  eq(p.deadUp, 20, 'bytes 4-5 are a little-endian deadUp');
  eq(p.pollingRate, 8, 'byte 6 is pollingRate');
  eq(p.shakeLevel, 3, 'byte 7 is shakeLevel');
  eq(p.calibration, 0, 'byte 8 is calibration');
  eq(p.sportsMode, 1, 'byte 9 is sportsMode');
  eq(p.currentLayer, 2, 'byte 10 is currentLayer');

  // The two u16 fields really are 16-bit, not two separate bytes.
  eq(parseWholeParams([0xff,0,0x34,0x12,0xcd,0xab,0,0,0,0,0,0,0,0,0,0,0,0,0,0]).deadDown, 0x1234,
    'deadDown is little-endian u16');
  eq(parseWholeParams([0xff,0,0,0,0xcd,0xab,0,0,0,0,0,0,0,0,0,0,0,0,0,0]).deadUp, 0xabcd,
    'deadUp is little-endian u16');

  eq(WHOLE_PARAM_WRITABLE.length, 8, 'eight settings are host-settable');
  ok(!WHOLE_PARAM_WRITABLE.includes(WHOLE_PARAM_FIELD.RESERVE),
    'reserve is not host-settable');
  ok(WHOLE_PARAM_FIELD.RESERVE + WHOLE_PARAM_WRITABLE.length - 1 <= WHOLE_PARAM_FIELD.CURRENT_LAYER,
    'every writable field lies inside the blob');

  // Read-modify-write: one change must not disturb the other seven or the fill.
  const out = buildWholeParams(raw, { pollingRate: 4 });
  eq(out[6], 4, 'pollingRate changed');
  eq(Array.from(out.slice(0, 6)), raw.slice(0, 6), 'bytes before it are untouched');
  eq(Array.from(out.slice(7, 11)), raw.slice(7, 11), 'bytes after it are untouched');
  eq(Array.from(out.slice(11)), raw.slice(11), 'the nine fill bytes are preserved');

  const two = buildWholeParams(raw, { deadDown: 0x0405, currentLayer: 9 });
  eq([two[2], two[3]], [0x05, 0x04], 'a u16 change writes little-endian');
  eq(two[10], 9, 'a second field also changed');

  // Spellings should not be a second way to get this wrong.
  eq(Array.from(buildWholeParams(raw, { POLLING_RATE: 4 })), Array.from(out),
    'POLLING_RATE and pollingRate are the same field');
  eq(Array.from(buildWholeParams(raw, { polling_rate: 4 })), Array.from(out),
    'underscores are tolerated too');

  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  ok(throws(() => buildWholeParams(raw, { reserve: 0 })), 'reserve cannot be set');
  ok(throws(() => buildWholeParams(raw, { deadDown: 0x10000 })), 'deadDown over u16 is rejected');
  ok(throws(() => buildWholeParams(raw, { pollingRate: -1 })), 'a negative value is rejected');
  ok(throws(() => buildWholeParams(raw, { pollingRate: 1.5 })), 'a fractional value is rejected');
  ok(throws(() => buildWholeParams(raw, { nonsense: 1 })), 'an unknown field is rejected');
  ok(throws(() => parseWholeParams(new Array(12).fill(0))), 'a short payload is rejected');
}

console.log('columnar and record layouts (PROTOCOL.md section 8.13)');
{
  // These came out of the app's own builders plus its SQL schema. Pinning them
  // here means a later edit cannot quietly change a length formula.
  const s11 = PAYLOAD_SHAPES[0x11];
  ok(s11 && s11.record === 4, '0x11 carries 4 bytes per key');
  eq(s11.headerBytes, 1, '0x11 has exactly one leading byte');
  eq(s11.lenFormula, '4 * count + 1', '0x11 length is 4*count+1');

  // The one byte that is NOT accounted for is why this stays gated. A test that
  // only checked the parts we know would let the gate rot into a false claim.
  ok(s11 && s11.gated == null, '0x11 is no longer gated');

  const s14 = PAYLOAD_SHAPES[0x14];
  ok(s14 && s14.record === 8, '0x14 carries all 8 columns including item');
  eq(s14.lenFormula, '8 * count', '0x14 length is 8*count');

  // The positional-index pattern holds for three commands and breaks on 0x14.
  // Asserting the break is the point: it stops the pattern being mistaken for a
  // law in a later phase.
  eq(PAYLOAD_SHAPES[0x20].record, 3, '0x20 carries 3 bytes, keyItem positional');
  eq(PAYLOAD_SHAPES[0x40].record, 6, '0x40 carries 6 bytes, item positional');

  // 0x20 and 0x24 share a log name but are structurally different commands, so
  // their shapes must not be allowed to drift into looking like one command.
  eq(PAYLOAD_SHAPES[0x20].lenFormula, '3 * count + 2', '0x20 length is 3*count+2');
  eq(PAYLOAD_SHAPES[0x24].lenFormula, '1 * count + 1', '0x24 length is 1*count+1');
  eq(PAYLOAD_SHAPES[0x24].record, 1, '0x24 sends one byte per key, not three');
  ok(PAYLOAD_SHAPES[0x24].record !== PAYLOAD_SHAPES[0x20].record,
     'the two setKeyboardConfig opcodes are not the same shape');
  ok(/^QMap/.test(PAYLOAD_SHAPES[0x20].source) && /^flat/.test(PAYLOAD_SHAPES[0x24].source),
     'and they read from different sources');
  ok(PAYLOAD_SHAPES[0x20].gated && PAYLOAD_SHAPES[0x24].gated,
     'both remain gated on unnamed fields');
  ok(PAYLOAD_SHAPES[0x14].positional === null,
     '0x14 transmits its index, so the positional pattern does not generalise');
}

console.log('macro record fields (PROTOCOL.md section 8.12, key_macro_table DDL)');
{
  // The DDL column order is (macroIndex, item, type, state, lValue, hValue, time).
  // macroIndex is the slot, sent separately in payload byte 0; item is the loop
  // index. The remaining five map onto the 6-byte record, with time taking two.
  eq(Object.keys(MACRO_FIELD).length, 6, 'six record bytes, all named');
  eq(MACRO_FIELD.TYPE, 0, 'byte 0 is type');
  eq(MACRO_FIELD.STATE, 1, 'byte 1 is state');
  eq(MACRO_FIELD.LVALUE, 2, 'byte 2 is lValue');
  eq(MACRO_FIELD.HVALUE, 3, 'byte 3 is hValue');
  eq(MACRO_FIELD.TIME_LO, 4, 'time occupies bytes 4 and 5');

  // A press of 'A' (usage 0x04) after 250 ms.
  const rec = encodeMacroRecord({ type: 1, state: MACRO_STATE.DOWN, usage: 0x04, time: 250 });
  eq(rec.length, 6, 'a record is 6 bytes');
  eq(rec, [1, 1, 0x04, 0x00, 0xfa, 0x00], 'type,state,lValue,hValue,timeLo,timeHi');

  const d = decodeMacroRecord(rec);
  eq(d.type, 1, 'type round-trips');
  eq(d.state, MACRO_STATE.DOWN, 'state round-trips');
  eq(d.usage, 0x04, 'usage reassembles from lValue/hValue');
  eq(d.time, 250, 'time round-trips');

  // time really is a 16-bit little-endian value, which is why the record is 6
  // bytes rather than 5.
  eq(encodeMacroRecord({ time: 0x1234 })[4], 0x34, 'time low byte first');
  eq(encodeMacroRecord({ time: 0x1234 })[5], 0x12, 'time high byte second');
  eq(decodeMacroRecord([0, 0, 0, 0, 0x34, 0x12]).time, 0x1234, 'and reads back big-endian-free');
  eq(MACRO_TIME_MAX, 0xffff, 'delay ceiling is 65535 ms');

  // A high-byte usage must survive the split.
  eq(encodeMacroRecord({ usage: 0xe004 })[2], 0x04, 'usage low byte at offset 2');
  eq(encodeMacroRecord({ usage: 0xe004 })[3], 0xe0, 'usage high byte at offset 3');
  eq(decodeMacroRecord(encodeMacroRecord({ usage: 0xe004 })).usage, 0xe004,
    'a LeftCtrl usage round-trips');

  // The wire transposes the first two bytes.
  const wire = buildMacroPayload({ slot: 3, records: [rec] });
  eq(wire.length, 8, '2 header bytes plus one 6-byte record');
  eq(wire[0], 3, 'payload byte 0 is the slot');
  eq(wire[1], 1, 'payload byte 1 is the count');
  eq(wire[2], rec[1], 'wire byte 0 of the record is state');
  eq(wire[3], rec[0], 'wire byte 1 of the record is type');

  // And the reader must undo that transposition before naming the fields.
  const back = parseMacroRecords(wire);
  eq(back.records[0].usage, 0x04, 'readback recovers the usage');
  eq(back.records[0].time, 250, 'readback recovers the delay');
  eq(back.records[0].type, 1, 'readback recovers type');

  // Range checks must fire rather than silently truncate.
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  ok(throws(() => encodeMacroRecord({ usage: 0x10000 })), 'usage above 16 bits is rejected');
  ok(throws(() => encodeMacroRecord({ time: 0x10000 })), 'delay above u16 is rejected');
  ok(throws(() => encodeMacroRecord({ time: -1 })), 'negative delay is rejected');
  ok(throws(() => encodeMacroRecord({ state: 256 })), 'state above a byte is rejected');
  ok(throws(() => decodeMacroRecord([1, 2, 3])), 'a short record is rejected');
}

console.log('receive dispatch (PROTOCOL.md section 4)');
{
  eq(Object.keys(RESPONSE_DISPATCH).length, 40, '40 responses are dispatched');

  // The table must be exactly request + 0x80 for everything that pairs up.
  const pairs = Object.entries(CMD).map(([name, cmd]) => [name, cmd])
    .filter(([, cmd]) => !REQUESTS_WITHOUT_RESPONSE.has(cmd));
  let bad = [];
  for (const [name, cmd] of pairs) {
    const r = responseOpcode(cmd);
    if (r === null || RESPONSE_DISPATCH[r] === undefined) bad.push(name);
  }
  eq(bad, [], 'every request with a dispatched reply sits at request + 0x80');

  // The two firmware-data requests answer with nothing the app dispatches.
  eq(responseOpcode(0x65), null, '0x65 has no dispatched response');
  eq(responseOpcode(0x66), null, '0x66 has no dispatched response');
  eq(awaitsResponse(0x65), false, 'a driver must not wait on 0xE5');
  eq(awaitsResponse(0x62), true, '0x62 is answered by 0xE2');

  // Exactly three responses are never solicited.
  eq([...UNSOLICITED_RESPONSES].sort((a, b) => a - b), [0xa1, 0xd1, 0xf1],
    'only 0xA1, 0xD1 and 0xF1 are unsolicited');
  eq(isUnsolicited(0xf1), true, '0xF1 is the device push');
  eq(isUnsolicited(0xe2), false, '0xE2 is an ordinary reply');

  // 0x90 was wrongly documented as ignored in an earlier draft. It is dispatched.
  eq(RESPONSE_DISPATCH[0x90], 'set_custom_light', '0x90 IS dispatched, not ignored');
  eq(awaitsResponse(0x10), true, 'a driver may wait for the 0x90 ack to 0x10');

  // Spot-check the per-key colour naming, which is what this table settled.
  eq(responseOpcode(0x16), 0x96, '0x16 read answers at 0x96');
  eq(RESPONSE_DISPATCH[0x96], 'get_custom_light_all',
    'the per-key readback slot is get_custom_light_all');
}

console.log('receive-dispatch tables agree across all three files');
{
  // protocol.js, cli/apexctl.py and PROTOCOL.md each carry the same 40-entry
  // table. A spelling or entry-count drift between them would silently make the
  // three implementations disagree about what the board said.
  const fs = await import('node:fs');
  const root = new URL('../', import.meta.url).pathname;
  const cli = fs.readFileSync(root + 'cli/apexctl.py', 'utf8');
  const md = fs.readFileSync(root + 'PROTOCOL.md', 'utf8');

  const cliBlock = cli.match(/RESPONSES = \{([\s\S]*?)\n\}/)[1];
  const cliMap = new Map([...cliBlock.matchAll(/(0x[0-9A-Fa-f]{2}):\s*"([^"]+)"/g)]
    .map((m) => [parseInt(m[1], 16), m[2]]));
  eq(cliMap.size, 40, 'apexctl.py lists 40 responses');
  let drift = [];
  for (const [op, name] of Object.entries(RESPONSE_DISPATCH)) {
    if (cliMap.get(Number(op)) !== name) drift.push(op);
  }
  eq(drift, [], 'apexctl.py and protocol.js name every response identically');

  const mdTable = md.match(/\| Resp \| Idx \| Req \| Signal \|[\s\S]*?\n\n/)[0];
  const mdMap = new Map([...mdTable.matchAll(/\|\s*`(0x[0-9A-F]{2})`\s*\|\s*\d+\s*\|[^|]*\|\s*([a-z_]+)\s*\|/g)]
    .map((m) => [parseInt(m[1], 16), m[2]]));
  eq(mdMap.size, 40, 'PROTOCOL.md section 4.1 lists 40 responses');
  drift = [];
  for (const [op, name] of Object.entries(RESPONSE_DISPATCH)) {
    if (mdMap.get(Number(op)) !== name) drift.push(op);
  }
  eq(drift, [], 'PROTOCOL.md and protocol.js name every response identically');
}

console.log('feature-parity audit (PROTOCOL.md section 12)');
{
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../PROTOCOL.md', import.meta.url).pathname, 'utf8');
  const sec = md.match(/## 12\. Feature-parity audit([\s\S]*)$/)[1];
  const rows = [...sec.matchAll(/^\| `(0x[0-9A-F]{2})` \| `([A-Za-z]+)` \| (.+) \|$/gm)]
    .map((m) => ({ req: parseInt(m[1], 16), fn: m[2], status: m[3] }));

  // Every app function appears exactly once, and the opcode set matches CMD.
  eq(rows.length, 39, 'all 39 Windows-app functions are audited');
  const appOps = [...sec.matchAll(/^\| `(0x[0-9A-F]{2})`/gm)].map((m) => parseInt(m[1], 16));
  eq(new Set(appOps).size, 39, 'no app function is listed twice');
  const cmdOps = new Set(Object.values(CMD));
  const unknown = appOps.filter((o) => !cmdOps.has(o));
  eq(unknown, [], 'every audited opcode exists in CMD');

  // No row may be blank or vague: a gate has to say what is unknown.
  const vague = rows.filter((r) => !/Exposed|Gated|Refused/.test(r.status));
  eq(vague, [], 'every row states Exposed, Gated or Refused');
  const ungated = rows.filter((r) => /^Gated/.test(r.status) && r.status.length < 25);
  eq(ungated, [], 'every gate names the missing knowledge');

  // The headline count in the prose must match the table.
  const n = (re) => rows.filter((r) => re.test(r.status)).length;
  // These move as gaps close. The point is not the specific numbers but that the
  // table and the prose are checked against each other on every run.
  eq(n(/^Exposed/) + n(/^Gated/) + n(/^Refused/), 39, 'the three buckets cover all 39');
  ok(n(/^Exposed/) > 0 && n(/^Gated/) > 0 && n(/^Refused/) > 0,
    'every bucket is non-empty');
  eq(n(/^Refused/), 4, '4 refused as firmware');
  const prose = sec.match(/(\d+) exposed, (\d+) deliberately gated, (\d+) refused/);
  ok(prose !== null, 'the prose states all three counts');
  eq([Number(prose[1]), Number(prose[2]), Number(prose[3])],
     [25, 10, 4],
     'the prose counts match the table exactly');

}

console.log('feature vocabulary');
{
  eq(Object.keys(KEY_MODIFIERS).length, 6, 'six advanced key modifiers');
  ok(KEY_MODIFIERS.DKS && KEY_MODIFIERS.MT && KEY_MODIFIERS.TGL &&
     KEY_MODIFIERS.RS && KEY_MODIFIERS.SOCD && KEY_MODIFIERS.OKS,
     'dks/mt/tgl/rs/socd/oks all present');
  eq(SOCD_MODES.length, 4, 'four SOCD resolution modes');
  eq(LIGHT_WIRE_ORDER.length, 8, 'wire permutation covers 8 bytes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);