// Self-checks for the WebHID interface selection. Run: node test/driver.test.mjs
//
// These matter because every opcode goes through one HID collection. If the
// picker hands us a keyboard or consumer-control interface, `open()` fails or
// the board silently ignores the frame, and the UI only says "failed to open
// device". The filter and the selection are therefore asserted here.

import {
  ApexHid, CONFIG_FILTER, isConfigInterface, selectConfigDevice, describeCollections,
} from '../js/driver.js';
import { VID, PID, VENDOR_USAGE_PAGE } from '../js/protocol.js';

let pass = 0, fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  ok(A === B, label, `got ${A} want ${B}`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
