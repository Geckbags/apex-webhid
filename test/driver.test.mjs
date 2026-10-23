// Self-checks for the WebHID interface selection. Run: node test/driver.test.mjs
//
// These matter because every opcode goes through one HID collection. If the
// picker hands us a keyboard or consumer-control interface, `open()` fails or
// the board silently ignores the frame, and the UI only says "failed to open
// device". The filter and the selection are therefore asserted here.

import {
  ApexHid, CONFIG_FILTER, isConfigInterface, selectConfigDevice, describeCollections,
} from '../js/driver.js';
import { VID, PID, VENDOR_USAGE_PAGE, responseOpcode } from '../js/protocol.js';

// request() arms a response timeout per frame. Unref those timers so the test
// process exits as soon as the assertions finish rather than waiting out the
// longest timeout.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = realSetTimeout(fn, ms, ...args);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
};

let pass = 0, fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  ok(A === B, label, `got ${A} want ${B}`);
}

// Stand-in config interface: record the exact 64-byte frame and answer the
// pending request as if the board had replied. `respond` may return
// {frame, total, payload}; the default is an empty single-page ack.
function fakeDevice(hid, respond = null) {
  const sent = [];
  hid.device = {
    async sendReport(reportId, data) {
      const bytes = Uint8Array.from(data);
      sent.push({ reportId, bytes });
      const cmd = bytes[1];
      const expect = responseOpcode(cmd);
      const waiter = hid.pending.get(expect);
      if (!waiter) return;
      hid.pending.delete(expect);
      const r = respond ? respond(cmd, bytes, sent.length) : {};
      waiter.resolve({
        ok: true,
        opcode: expect,
        frame: r.frame ?? 1,
        total: r.total ?? 1,
        payload: r.payload ?? new Uint8Array(0),
      });
    },
  };
  return sent;
}

// Stand-ins for the interfaces a composite APEX 200 exposes. Only the first
// speaks the 64-byte vendor protocol; the others are enumerated by Chrome too.
const CONFIG = { collections: [{ usagePage: 0xff02, usage: 0x0002, type: 'application' }] };
const CONSUMER = { collections: [{ usagePage: 0x000c, usage: 0x0001, type: 'application' }] };
const KEYBOARD = { collections: [{ usagePage: 0x0001, usage: 0x0006, type: 'application' }] };
const MOUSE = { collections: [{ usagePage: 0x0001, usage: 0x0002, type: 'application' }] };

console.log('WebHID config-interface filter (PROTOCOL.md section 9)');
{
  eq(VENDOR_USAGE_PAGE, 0xff02, 'config collection is usage page 0xFF02');
  eq(CONFIG_FILTER, { vendorId: VID, productId: PID, usagePage: 0xff02 },
     'filter narrows VID/PID to the vendor usage page');
  ok(CONFIG_FILTER.usagePage !== undefined,
     'filter sets usagePage - a VID/PID-only filter matches every interface');
}

console.log('config-interface detection');
{
  ok(isConfigInterface(CONFIG), '0xFF02 collection is the config interface');
  ok(!isConfigInterface(KEYBOARD), 'keyboard collection is rejected');
  ok(!isConfigInterface(MOUSE), 'mouse collection is rejected');
  ok(!isConfigInterface(CONSUMER), 'consumer-control collection is rejected');
  ok(!isConfigInterface({}), 'a device with no collections is rejected');
  ok(!isConfigInterface(null), 'null is rejected');
}

console.log('selection never guesses');
{
  eq(selectConfigDevice([CONFIG]), CONFIG, 'single config interface is selected');
  eq(selectConfigDevice([KEYBOARD, CONSUMER, CONFIG]), CONFIG,
     'config interface is selected out of a composite list');
  eq(selectConfigDevice([KEYBOARD, MOUSE]), null,
     'no vendor collection means no device, not devices[0]');
  eq(selectConfigDevice([]), null, 'empty selection means no device');
  eq(selectConfigDevice(undefined), null, 'missing list means no device');
}

console.log('error text names what the browser actually exposed');
{
  const text = describeCollections(KEYBOARD);
  ok(text.includes('0x1') && text.includes('0x6'), 'usage page and usage are both printed');
  ok(describeCollections({}).includes('no top-level collections'), 'empty device is described');
}

console.log('0x23 bulk high-key write is double-gated');
{
  const hid = new ApexHid();
  let threw = false, message = '';
  try {
    await hid.setHighKeys([{ key: 1, type: 0, data: [0, 0, 0, 0] }]);
  } catch (e) {
    threw = true;
    message = e.message;
  }
  ok(threw, 'refuses without allowBulkWrite even though no device is attached');
  ok(/allowBulkWrite/.test(message), 'error names the missing opt-in');
  ok(/8\.21\.8/.test(message), 'error points at the binary evidence');
}

console.log('request frames match the verified Windows builders');
{
  const hid = new ApexHid();
  const sent = fakeDevice(hid);

  await hid.addHighKey({ modifier: 'tgl', key: 0x2a, data: [1, 2, 3, 4] });
  eq([...sent[0].bytes.slice(0, 12)],
    [0xfa, 0x22, 1, 1, 0, 6, 0x2a, 0, 1, 2, 3, 4],
    '0x22 TGL: [FA][22][1][1][0][6][key][type][4 data]');

  await hid.delHighKey(0x2a);
  eq([...sent[1].bytes.slice(0, 8)],
    [0xfa, 0x25, 1, 1, 0, 1, 0x2a, 0],
    '0x25 payload is the key byte (+0x24A), not a table index');

  const hk = await hid.readHighKeys();
  eq([...sent[2].bytes.slice(0, 7)],
    [0xfa, 0x2b, 1, 1, 0, 0, 0],
    '0x2B first request is page 1, total 1, empty payload');
  eq(hk.pages.length, 1, 'single-page 0x2B read collected one page');
  eq(hk.frames.length, 1, 'readAll retains the response frame');

  await hid.readMacros(3);
  eq([...sent[3].bytes.slice(0, 8)],
    [0xfa, 0x42, 1, 1, 0, 1, 3, 0],
    '0x42 carries the macro slot');

  await hid.readKeyConfig(1);
  eq([...sent[4].bytes.slice(0, 8)],
    [0xfa, 0x2a, 1, 1, 0, 1, 1, 0],
    '0x2A carries the keymap layer');

  let layerErr = null;
  try { await hid.readKeyConfig(2); } catch (err) { layerErr = err; }
  ok(layerErr instanceof RangeError, 'rejects a layer the vendor app never sends');

  await hid.getEffectLight(5);
  eq([...sent[5].bytes.slice(0, 8)],
    [0xfa, 0x17, 1, 1, 0, 1, 5, 0],
    '0x17 carries the effect index');

  await hid.getEffectLightName(0);
  eq([...sent[6].bytes.slice(0, 8)],
    [0xfa, 0x18, 1, 1, 0, 1, 0, 0],
    '0x18 carries the name-set selector');

  await hid.getProductInfo(new Date(2026, 0, 2, 3, 4, 5));
  eq([...sent[7].bytes.slice(0, 13)],
    [0xfa, 0x62, 1, 1, 0, 7, 0, 26, 1, 2, 3, 4, 5],
    '0x62 carries the host clock in the verified encoding');
}

console.log('readAllMacros reads each slot separately');
{
  const hid = new ApexHid();
  const sent = fakeDevice(hid);
  const r = await hid.readAllMacros();
  eq(sent.length, 10, 'one 0x42 request per macro slot');
  eq(sent.map((x) => x.bytes[6]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'slot payloads run 0..9 in order');
  eq(r.slots.length, 10, 'ten slot results retained');
  eq(r.frames.length, 10, 'ten response frames retained');
}

console.log('macro writes are paged nine records per frame');
{
  const hid = new ApexHid();
  const sent = fakeDevice(hid);
  const many = Array.from({ length: 19 }, (_, i) => Uint8Array.of(i, 0, 0x04, 0, 0, 0));
  const replies = await hid.setMacro({ slot: 2, records: many });
  eq(replies.length, 3, 'three pages sent');
  eq(sent.map((x) => [...x.bytes.slice(0, 8)]), [
    [0xfa, 0x40, 1, 3, 0, 56, 2, 9],
    [0xfa, 0x40, 2, 3, 0, 56, 2, 9],
    [0xfa, 0x40, 3, 3, 0, 8, 2, 1],
  ], 'page, total, LEN and count follow FUN_1400b0e20');
  eq([...sent[1].bytes.slice(8, 14)], [0, 9, 0x04, 0, 0, 0],
    'page 2 starts at record 9, with bytes 0/1 transposed');

  let threw = false;
  try { await hid.setMacro({ slot: 2, records: [] }); } catch { threw = true; }
  ok(threw, 'refuses an empty macro instead of sending a zero-record frame');
}

console.log('paged reads start at page 1 and follow the reported total');

{
  const hid = new ApexHid();
  let n = 0;
  const sent = fakeDevice(hid, () => {
    n += 1;
    return n === 1
      ? { frame: 1, total: 2, payload: Uint8Array.of(0xaa) }
      : { frame: 2, total: 2, payload: Uint8Array.of(0xbb) };
  });
  const r = await hid.readHighKeys();
  eq(sent.map((x) => [...x.bytes.slice(0, 6)]), [
    [0xfa, 0x2b, 1, 1, 0, 0],
    [0xfa, 0x2b, 2, 2, 0, 0],
  ], 'page 2 uses the reported total, not a fixed 85-key count');
  eq(r.pages.map((p) => [...p]), [[0xaa], [0xbb]], 'both pages collected in order');
  eq(r.frames.length, 2, 'both response frames retained');
  eq(r.total, 2, 'reported total retained');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
