import { ApexHid, webHidSupported } from './driver.js';
import {
  CMD, OPCODE_NAME, PRODUCT, LIMITS, opcodeName, hex, isResponse, UNHANDLED_RESPONSES,
  EFFECT_NAMES, buildEffectConfig, buildColourConfig, buildHighKeyRecord, buildHighKeyBinding,
  parseMacroRecords, parseKeymap, EFFECT_MAX, EFFECT_MIN,
  KEY_MODIFIERS, keyName, keyOptions, encodeMacroRecord,
  parseWholeParams, buildWholeParams, WHOLE_PARAM_FIELD, WHOLE_PARAM_LEN,
  parseCustomLight, parseEffectConfigs, decodeSnapshotSection,
  MACRO_STATE, MACRO_TIME_MAX,
} from './protocol.js';

const $ = (sel) => document.querySelector(sel);
const hid = new ApexHid();

let selectedKey = 0;
const customKeyColors = {};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Authentic 75% compact (85-key) layout specification for ANT ESPORTS APEX 200.
 * Every row sums to exactly 16u width for precision flexbox alignment. */
export const KEYBOARD_LAYOUT_85 = [
  // Row 0 - 16 keys, all 1u, total 16u
  { id: 0, row: 0, label: 'Esc', sub: '', width: 1 },
  { id: 1, row: 0, label: 'F1', sub: '', width: 1 },
  { id: 2, row: 0, label: 'F2', sub: '', width: 1 },
  { id: 3, row: 0, label: 'F3', sub: '', width: 1 },
  { id: 4, row: 0, label: 'F4', sub: '', width: 1 },
  { id: 5, row: 0, label: 'F5', sub: '', width: 1 },
  { id: 6, row: 0, label: 'F6', sub: '', width: 1 },
  { id: 7, row: 0, label: 'F7', sub: '', width: 1 },
  { id: 8, row: 0, label: 'F8', sub: '', width: 1 },
  { id: 9, row: 0, label: 'F9', sub: '', width: 1 },
  { id: 10, row: 0, label: 'F10', sub: '', width: 1 },
  { id: 11, row: 0, label: 'F11', sub: '', width: 1 },
  { id: 12, row: 0, label: 'F12', sub: '', width: 1 },
  { id: 13, row: 0, label: 'PrtSc', sub: '', width: 1 },
  { id: 14, row: 0, label: 'Pause', sub: '', width: 1 },
  { id: 15, row: 0, label: 'Del', sub: '', width: 1 },

  // Row 1 - 15 keys, total 16u
  { id: 16, row: 1, label: '`', sub: '~', width: 1 },
  { id: 17, row: 1, label: '1', sub: '!', width: 1 },
  { id: 18, row: 1, label: '2', sub: '@', width: 1 },
  { id: 19, row: 1, label: '3', sub: '#', width: 1 },
  { id: 20, row: 1, label: '4', sub: '$', width: 1 },
  { id: 21, row: 1, label: '5', sub: '%', width: 1 },
  { id: 22, row: 1, label: '6', sub: '^', width: 1 },
  { id: 23, row: 1, label: '7', sub: '&', width: 1 },
  { id: 24, row: 1, label: '8', sub: '*', width: 1 },
  { id: 25, row: 1, label: '9', sub: '(', width: 1 },
  { id: 26, row: 1, label: '0', sub: ')', width: 1 },
  { id: 27, row: 1, label: '-', sub: '_', width: 1 },
  { id: 28, row: 1, label: '=', sub: '+', width: 1 },
  { id: 29, row: 1, label: 'Backspace', sub: '', width: 2 },
  { id: 30, row: 1, label: 'Home', sub: '', width: 1 },

  // Row 2 - 15 keys, total 16u
  { id: 31, row: 2, label: 'Tab', sub: '', width: 1.5 },
  { id: 32, row: 2, label: 'Q', sub: '', width: 1 },
  { id: 33, row: 2, label: 'W', sub: '', width: 1 },
  { id: 34, row: 2, label: 'E', sub: '', width: 1 },
  { id: 35, row: 2, label: 'R', sub: '', width: 1 },
  { id: 36, row: 2, label: 'T', sub: '', width: 1 },
  { id: 37, row: 2, label: 'Y', sub: '', width: 1 },
  { id: 38, row: 2, label: 'U', sub: '', width: 1 },
  { id: 39, row: 2, label: 'I', sub: '', width: 1 },
  { id: 40, row: 2, label: 'O', sub: '', width: 1 },
  { id: 41, row: 2, label: 'P', sub: '', width: 1 },
  { id: 42, row: 2, label: '[', sub: '{', width: 1 },
  { id: 43, row: 2, label: ']', sub: '}', width: 1 },
  { id: 44, row: 2, label: '\\', sub: '|', width: 1.5 },
  { id: 45, row: 2, label: 'PgUp', sub: '', width: 1 },

  // Row 3 - 14 keys, total 16u
  { id: 46, row: 3, label: 'Caps', sub: '', width: 1.75 },
  { id: 47, row: 3, label: 'A', sub: '', width: 1 },
  { id: 48, row: 3, label: 'S', sub: '', width: 1 },
  { id: 49, row: 3, label: 'D', sub: '', width: 1 },
  { id: 50, row: 3, label: 'F', sub: '', width: 1 },
  { id: 51, row: 3, label: 'G', sub: '', width: 1 },
  { id: 52, row: 3, label: 'H', sub: '', width: 1 },
  { id: 53, row: 3, label: 'J', sub: '', width: 1 },
  { id: 54, row: 3, label: 'K', sub: '', width: 1 },
  { id: 55, row: 3, label: 'L', sub: '', width: 1 },
  { id: 56, row: 3, label: ';', sub: ':', width: 1 },
  { id: 57, row: 3, label: '\'', sub: '"', width: 1 },
  { id: 58, row: 3, label: 'Enter', sub: '', width: 2.25 },
  { id: 59, row: 3, label: 'PgDn', sub: '', width: 1 },

  // Row 4 - 14 keys, total 16u
  { id: 60, row: 4, label: 'Shift', sub: '', width: 2.25 },
  { id: 61, row: 4, label: 'Z', sub: '', width: 1 },
  { id: 62, row: 4, label: 'X', sub: '', width: 1 },
  { id: 63, row: 4, label: 'C', sub: '', width: 1 },
  { id: 64, row: 4, label: 'V', sub: '', width: 1 },
  { id: 65, row: 4, label: 'B', sub: '', width: 1 },
  { id: 66, row: 4, label: 'N', sub: '', width: 1 },
  { id: 67, row: 4, label: 'M', sub: '', width: 1 },
  { id: 68, row: 4, label: ',', sub: '<', width: 1 },
  { id: 69, row: 4, label: '.', sub: '>', width: 1 },
  { id: 70, row: 4, label: '/', sub: '?', width: 1 },
  { id: 71, row: 4, label: 'Shift', sub: '', width: 1.75 },
  { id: 72, row: 4, label: '▲', sub: '', width: 1 },
  { id: 73, row: 4, label: 'End', sub: '', width: 1 },

  // Row 5 - 11 keys, total 16u
  { id: 74, row: 5, label: 'Ctrl', sub: '', width: 1.25 },
  { id: 75, row: 5, label: 'Win', sub: '', width: 1.25 },
  { id: 76, row: 5, label: 'Alt', sub: '', width: 1.25 },
  { id: 77, row: 5, label: 'Space', sub: '', width: 5.25 },
  { id: 78, row: 5, label: 'Alt', sub: '', width: 1 },
  { id: 79, row: 5, label: 'Fn', sub: '', width: 1 },
  { id: 80, row: 5, label: 'Menu', sub: '', width: 1 },
  { id: 81, row: 5, label: 'Ctrl', sub: '', width: 1 },
  { id: 82, row: 5, label: '◄', sub: '', width: 1 },
  { id: 83, row: 5, label: '▼', sub: '', width: 1 },
  { id: 84, row: 5, label: '►', sub: '', width: 1 },
];

export function getKeyById(id) {
  return KEYBOARD_LAYOUT_85[id] || null;
}

export function setSelectedKey(id) {
  if (id < 0 || id >= KEYBOARD_LAYOUT_85.length) return;
  selectedKey = id;
  const key = KEYBOARD_LAYOUT_85[id];
  const label = key ? `${key.label} (Item ${id})` : `Key ${id}`;

  const d1 = $('#selectedKeyDisplay');
  if (d1) d1.textContent = label;

  const d2 = $('#selectedKeyColorLabel');
  if (d2) d2.textContent = label;

  const cStart = $('#calibStart');
  if (cStart) cStart.value = String(id + 1);
  const cEnd = $('#calibEnd');
  if (cEnd) cEnd.value = String(id + 1);

  document.querySelectorAll('.kb-key[data-key-id]').forEach((el) => {
    el.classList.toggle('sel', Number(el.dataset.keyId) === id);
  });
}

/* ------------------------------------------------------------------ status */

function setStatus(text, cls = '') {
  const pill = $('#statusPill');
  pill.textContent = text;
  pill.className = `pill ${cls}`;
}

function setConnected(on) {
  $('#btnConnect').classList.toggle('hidden', on);
  $('#btnDisconnect').classList.toggle('hidden', !on);
  const heroCard = $('#heroConnectedCard');
  if (heroCard) heroCard.classList.toggle('hidden', !on);
  const heroConnect = $('#btnHeroConnect');
  if (heroConnect) heroConnect.classList.toggle('hidden', on);
}

function fail(err) {
  console.error(err);
  setStatus(String(err.message ?? err), 'bad');
  log($('#trace'), `l-err`, String(err.message ?? err));
}

/* -------------------------------------------------------------------- tabs */

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    // Lighting is stateful, so refresh it when the tab opens. Without this the
    // page shows whatever was on screen at connect time until the user presses
    // a read button - exactly the kind of stale view that invites a wrong write.
    if (btn.dataset.tab === 'light' && hid.connected) $('#btnLightReadAll').click();
  });
});

/* ------------------------------------------------------------------- utils */

function log(el, cls, text) {
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  el.prepend(line);
  if (atBottom) el.scrollTop = 0;
}

function parseHexList(text) {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  return Uint8Array.from(parts, (p) => parseInt(p, 16) & 0xff);
}

/** ASCII preview of a byte buffer: printable chars shown, rest replaced with '.'. */
function asciiPreview(bytes) {
  if (!bytes || !bytes.length) return '';
  const chars = Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.');
  return '\n  ascii: ' + chars.join('');
}

function showOutput(sel, text) {
  const el = $(sel);
  el.textContent = text;
  el.classList.remove('hidden');
}

/* -------------------------------------------------------------- collections */

function renderCollections(node, depth = 0, out = []) {
  if (!node) return out;
  const label = [node.usagePage !== undefined ? `0x${node.usagePage.toString(16)}` : '?', ''];
  const head = `${'  '.repeat(depth)}usagePage ${label[0]}  usage ${
    node.usage !== undefined ? `0x${node.usage.toString(16)}` : '?'}  type ${
    node.type === 'input' ? 'input' : node.type === 'output' ? 'output' : node.type ?? '?'}`;
  out.push(head);
  if (node.reportIds?.length) out.push(`${'  '.repeat(depth)}  reportIds: ${node.reportIds.join(', ')}`);
  if (node.children) for (const c of node.children) renderCollections(c, depth + 1, out);
  return out;
}

function dumpDeviceInfo() {
  const d = hid.connected ? hid.device : null;
  if (!d) return;
  const lines = [
    `productName  ${d.productName ?? '(none)'}`,
    `vendorId     0x${d.vendorId.toString(16)}`,
    `productId    0x${d.productId.toString(16)}`,
    `opened       ${d.opened}`,
    '',
    renderCollections(hid.collections).join('\n'),
  ];
  showOutput('#deviceInfo', lines.join('\n'));
  $('#deviceInfo').classList.remove('hidden');
  $('#collections').textContent = renderCollections(hid.collections).join('\n');
}

/**
 * WebHID deliberately withholds raw report descriptors from pages, so this reports
 * what the browser does expose and points at the CLI, which reads the real ones
 * straight from sysfs with no root.
 */
function fetchDescriptor() {
  if (!hid.connected) throw new Error('not connected');
  const collections = hid.collections.map((c) => ({
    usagePage: `0x${c.usagePage.toString(16)}`,
    usage: `0x${c.usage.toString(16)}`,
    type: c.type,
    inputReportIds: Array.from(c.inputReportIds ?? []),
    outputReportIds: Array.from(c.outputReportIds ?? []),
    featureReportIds: Array.from(c.featureReportIds ?? []),
  }));
  const vendor = collections.find((c) => parseInt(c.usagePage, 16) >= 0xff00);
  showOutput('#descriptor', [
    'WebHID does not expose raw report descriptors to pages.',
    'For the real ones (no root required, read from sysfs):',
    '',
    '    ./cli/apexctl.py descriptor',
    '',
    vendor
      ? `WebHID sees the vendor collection — usage page ${vendor.usagePage}, usage ${vendor.usage}. Good.`
      : 'WARNING: no vendor (0xFFxx) usage page in the exposed collections. WebHID may be hiding the config interface — try another device in the picker.',
    '',
    'Collections reported by the browser:',
    '',
    JSON.stringify(collections, null, 2),
    '',
    'The config channel is expected to be 64 bytes in and out with no report IDs,',
    'so sendReport() takes reportId 0.',
  ].join('\n'));
}

/* ---------------------------------------------------------------- auto-sync */

async function autoSync() {
  if (!hid.connected) return;
  const devName = hid.device?.productName || 'APEX 200';
  setStatus('syncing keyboard...', 'on');
  const heroLabel = $('#heroDeviceLabel');
  if (heroLabel) heroLabel.textContent = devName;

  try {
    // 1. Lighting state
    try {
      const table = await hid.readEffectConfigs();
      let names = null;
      try { names = await hid.readEffectNames(); } catch (_) {}
      if (names && names.length) {
        lMode.innerHTML = '';
        for (const { index, name } of names) {
          if (index > EFFECT_MAX || index === 0) continue;
          const opt = document.createElement('option');
          opt.value = String(index);
          opt.textContent = name === null ? `#${index} (undecoded)` : `${index}. ${name}`;
          lMode.appendChild(opt);
        }
      }
      if (table && table.records && table.records.length) {
        const wanted = Number(lMode.value) || 1;
        const cfg = table.records.find((r) => r.effect === wanted) || table.records[0];
        lastEffectPayload = buildEffectConfig({
          effect: cfg.effect, brightness: cfg.brightness, speed: cfg.speed,
          readback: Uint8Array.of(0, 0, 0, ...cfg.opaque),
        });
        if ([...lMode.options].some((o) => o.value === String(cfg.effect))) {
          lMode.value = String(cfg.effect);
        }
        lBright.value = String(cfg.brightness);
        lSpeed.value = String(cfg.speed);
        $('#lBrightOut').textContent = String(cfg.brightness);
        $('#lSpeedOut').textContent = String(cfg.speed);
        lEffectColor.value = cfg.colour.hex;
        updateLightingControls();
        renderKeyboard(cfg.effect, cfg.brightness, cfg.speed, cfg.colour.hex);
        $('#lightStatus').textContent = `Synchronized: ${effectLabel(cfg.effect)} (${cfg.brightness}% brightness).`;
      }
    } catch (e) {
      console.warn('Lighting auto-sync notice:', e);
    }

    // 2. Global performance settings
    try {
      const r = await hid.getWholeParam();
      const p = parseWholeParams(r.payload);
      renderParams(p);
    } catch (e) {
      console.warn('Params auto-sync notice:', e);
    }

    // 3. Profiles
    try {
      const { pages } = await hid.readConfigTables();
      const names = pages
        .filter((p) => p.length > 3)
        .map((p) => {
          const nul = p.indexOf(0, 3);
          return new TextDecoder().decode(p.subarray(3, nul === -1 ? p.length : nul));
        });
      if (names.length) {
        $('#profileOut').textContent = `Loaded ${names.length} profile(s): ${names.join(', ')}`;
      }
    } catch (e) {
      console.warn('Profiles auto-sync notice:', e);
    }

    // 4. Custom per-key lighting
    try {
      const r = await hid.readAll(CMD.GET_CUSTOM_LIGHT);
      const parsed = parseCustomLight(r.pages);
      for (const rec of parsed.records) {
        customKeyColors[rec.keyItem] = {
          light: rec.light,
          r: rec.r,
          g: rec.g,
          b: rec.b,
          hex: rec.hex,
        };
      }
    } catch (e) {
      console.warn('Custom light auto-sync notice:', e);
    }

    setStatus('connected & synced', 'on');
    $('#vendorPill').textContent = `${devName} (USB)`;
  } catch (err) {
    console.warn('Auto-sync partial failure:', err);
    setStatus(devName, 'on');
  }
}

/* ------------------------------------------------------------------ device */

$('#btnConnect').addEventListener('click', async () => {
  try {
    await hid.connect();
  } catch (err) {
    fail(err);
  }
});

$('#btnDisconnect').addEventListener('click', async () => {
  try {
    await hid.close();
  } catch (err) {
    fail(err);
  } finally {
    setStatus('disconnected');
    setConnected(false);
  }
});

$('#btnRestore').addEventListener('click', async () => {
  try {
    const d = await hid.restore();
    if (!d) setStatus('no saved device', '');
    else {
      setStatus('connected', 'on');
      setConnected(true);
      autoSync();
    }
  } catch (err) { fail(err); }
});

/**
 * List the interfaces this origin already has permission for, without opening
 * them. This is the diagnostic to reach for when open() fails: it shows the
 * usage pages Chrome actually enumerated, so a wrong-interface grant is visible
 * instead of hidden behind "Failed to open HID device".
 */
$('#btnScanHid').addEventListener('click', async () => {
  try {
    if (!webHidSupported()) throw new Error('WebHID is unavailable — use Chrome, Edge, Brave, or Opera (Chromium-based).');
    const devices = await navigator.hid.getDevices();
    if (!devices.length) {
      showOutput('#deviceInfo',
        'No HID devices are granted to this origin yet.\n' +
        'Press Connect and choose the APEX 200 entry; permission is remembered after that.');
      return;
    }
    const blocks = devices.map((d, i) => {
      const head = `#${i}  ${d.productName || '(no product name)'}  ` +
        `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}  ` +
        `opened=${d.opened}`;
      const cols = (d.collections ?? []).map((c) =>
        `    usage page 0x${c.usagePage.toString(16)}  usage 0x${c.usage.toString(16)}  ${c.type ?? ''}`);
      return [head, ...(cols.length ? cols : ['    (no collections reported)'])].join('\n');
    });
    showOutput('#deviceInfo', `Granted HID devices (${devices.length}):\n\n${blocks.join('\n\n')}`);
  } catch (err) { fail(err); }
});

hid.on('attach', (device) => {
  setStatus(device.productName || 'connected', 'on');
  setConnected(true);
  dumpDeviceInfo();
  log($('#trace'), 'l-in', `attached ${device.productName ?? 'device'}`);
  autoSync();
});

hid.on('disconnect', () => {
  setStatus('disconnected', 'bad');
  setConnected(false);
});

hid.on('reconnect', () => setStatus('device reconnected', 'on'));

hid.on('trace', (entry) => {
  const dir = entry.kind === 'out' ? 'l-out' : 'l-in';
  const arrow = entry.kind === 'out' ? '→' : '←';
  const tag = isResponse(entry.opcode) ? 'rsp' : 'req';
  log($('#trace'), dir,
    `${new Date(entry.t).toLocaleTimeString()} ${arrow} [${tag}] 0x${entry.opcode.toString(16).padStart(2, '0')} ${entry.name}  ${hex(entry.bytes.slice(0, 24))}`);
});

hid.on('protocol-error', (reason) => log($('#trace'), 'l-err', `protocol error: ${reason}`));

hid.on('unsolicited', (p) => {
  if (UNHANDLED_RESPONSES.has(p.opcode)) return;
  log($('#trace'), 'l-in', `unsolicited 0x${p.opcode.toString(16)} ${opcodeName(p.opcode)}`);
});

/* --------------------------------------------------------------- overview */

/* ------------------------------------------------------------ live reads */

function decodeStrings(payload) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= payload.length; i += 1) {
    if (i === payload.length || payload[i] === 0) {
      if (i > start) {
        const slice = payload.subarray(start, i);
        const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
        if (/[ -~]{2,}/.test(text)) out.push({ off: start, text });
      }
      start = i + 1;
    }
  }
  return out;
}

$('#btnProductInfo').addEventListener('click', async () => {
  try {
    const r = await hid.getProductInfo();
    const strings = decodeStrings(r.payload);
    const shown = strings.length
      ? strings.map((s) => `  @${s.off.toString().padStart(2)}  ${JSON.stringify(s.text)}`).join('\n')
      : '  (no printable strings)';
    showOutput('#deviceInfo',
      `product info 0x62 — ${r.payload.length} bytes\n` +
      `${hex(r.payload)}\n\n  strings:\n${shown}`);
    $('#deviceInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReadEffects').addEventListener('click', async () => {
  try {
    const slots = await hid.readEffectNames();
    const sel = lMode;
    sel.innerHTML = '';
    slots.forEach(({ index, name }) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      opt.textContent = name === null ? `#${index} (undecoded)` : `${index}. ${name}`;
      sel.appendChild(opt);
    });
    const named = slots.filter((s) => s.name).length;
    showOutput('#effectInfo',
      `read ${slots.length} effect slot(s); ${named} named.\n` +
      slots.map((s) => `  ${String(s.index).padStart(2)}  ${s.name ?? '(undecoded)'}`).join('\n'));
    $('#effectInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReadEffectCount').addEventListener('click', async () => {
  try {
    // 0xFF is the whole-table sentinel (FUN_1400af540 -> FUN_140097e40), not
    // "current effect". The protocol has no read that returns the active slot.
    const table = await hid.readEffectConfigs();
    showOutput('#effectInfo',
      `${formatEffectTable(table)}\n\n` +
      '0xFF selects the whole effect table. It does not mean "current effect";\n' +
      'the protocol has no read that returns the active slot.');
    $('#effectInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReadProfiles').addEventListener('click', async () => {
  try {
    const { pages } = await hid.readConfigTables();
    const names = pages
      .filter((p) => p.length > 3)
      .map((p) => {
        const nul = p.indexOf(0, 3);
        return new TextDecoder().decode(p.subarray(3, nul === -1 ? p.length : nul));
      });
    showOutput('#deviceInfo',
      `0x57 config table — ${names.length} profile(s):\n` +
      names.map((n, i) => `  ${i}. ${n}`).join('\n') +
      `\n\nraw:\n${pages.map((p) => hex(p).slice(0, 96)).join('\n')}`);
    $('#deviceInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReadTriggers').addEventListener('click', async () => {
  try {
    const { pages, joined } = await hid.readTriggerConfig();
    showOutput('#deviceInfo',
      `0x2C trigger config — ${pages.length} pages, ${joined.length} bytes.\n` +
      'Record size is 7 bytes; only the first u16 field is identified\n' +
      '(repeat body decodes to 240, 1, 170, 100 — 240 is inside the\n' +
      'documented trigger range 10..359).\n\n' +
      pages.map((p) => hex(p).slice(0, 112)).join('\n'));
    $('#deviceInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReadAdc').addEventListener('click', async () => {
  try {
    const { pages, joined } = await hid.readCalibrationAdc();
    const vals = [];
    for (let i = 0; i + 1 < joined.length; i += 2) {
      vals.push(joined[i] | (joined[i + 1] << 8));
    }
    const finite = vals.filter((v) => v > 0);
    const stats = finite.length
      ? `min ${Math.min(...finite)} max ${Math.max(...finite)} mean ${Math.round(finite.reduce((a, b) => a + b, 0) / finite.length)}`
      : 'n/a';
    showOutput('#deviceInfo',
      `0x5B calibration ADC — ${pages.length} pages, ${vals.length} u16 values\n` +
      `range: ${stats}\n\nfirst 40: ${vals.slice(0, 40).join(', ')}`);
    $('#deviceInfo').classList.remove('hidden');
  } catch (err) { fail(err); }
});

$('#btnReset').addEventListener('click', async () => {
  if (!confirm('Reset the keyboard? Onboard settings revert to factory defaults.')) return;
  try {
    await hid.resetKeyboard();
  } catch (err) { fail(err); }
});

$('#btnDescriptor').addEventListener('click', () => fetchDescriptor().catch(fail));
$('#btnCopyDescriptor').addEventListener('click', () => {
  navigator.clipboard?.writeText($('#descriptor').textContent ?? '');
});

/* ---------------------------------------------------------------- lighting */

// Populate the effect dropdown from the names the device reports.
//
// EFFECT_NAMES carries a trailing `null` for the undecoded 13th effect. It is
// deliberately skipped: index 12 is outside the device's validated 0-11 range,
// so offering it would build a request the firmware rejects with status 07.
const lMode = $('#lMode');
for (const [i, name] of EFFECT_NAMES.entries()) {
  if (name === null || i > EFFECT_MAX || i === 0) continue; // Skip "Close" - use dedicated button instead
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = `${i} - ${name}`;
  lMode.appendChild(opt);
}
// Default to Static effect (index 1) for a useful initial preview
lMode.value = '1';

// Sliders are live-0-100 and 1-100 percentages/interval, not 0-255 levels.
const lEffectColor = $('#lEffectColor');
const lBright = $('#lBright');
const lSpeed = $('#lSpeed');
const showVal = (el, out, v) => { document.querySelector(out).textContent = v; void el; };
lBright.addEventListener('input', () => showVal(lBright, '#lBrightOut', lBright.value));
lSpeed.addEventListener('input', () => showVal(lSpeed, '#lSpeedOut', lSpeed.value));
showVal(lBright, '#lBrightOut', lBright.value);
showVal(lSpeed, '#lSpeedOut', lSpeed.value);

// Bytes 3..7 of the 0x13 payload are device-owned. Cache the last thing the
// device reported so applying a brightness or speed change does not zero them.
let lastEffectPayload = null;

/** Human label for an effect index, including the undecoded slot. */
function effectLabel(index) {
  const name = EFFECT_NAMES[index];
  return name ? name : `#${index} (undecoded)`;
}

/** Decode the whole 0x17 table into one honest, line-per-slot view. */
function formatEffectTable(table) {
  const head = `0x17 table (index 0xFF): ${table.records.length} record(s), ` +
    `${table.joined.length} byte(s)` +
    (table.trailing
      ? `, ${table.trailing} trailing byte(s) not decoded`
      : ', no trailing bytes');
  const rows = table.records.map((r) => (
    `  slot ${String(r.slot).padStart(2)}  effect ${String(r.effect).padStart(2)}  ` +
    `${effectLabel(r.effect).padEnd(14)}  ` +
    `bright ${String(r.brightness).padStart(3)}%  speed ${String(r.speed).padStart(3)}  ` +
    `colour ${r.colour.hex}  fullColor ${r.fullColor}  functionFlag ${r.functionFlag}`
  ));
  return [head, ...rows].join('\n');
}

/** Counts only - the raw per-key table stays available through 0x16. */
function formatCustomLightSummary(custom) {
  if (!custom) return 'per-key custom-light table (0x16): unavailable';
  const lit = custom.records.filter((r) => r.light !== 0);
  const colours = new Set(lit.map((r) => r.hex));
  return `per-key custom-light table (0x16): ${custom.records.length} record(s)` +
    (custom.trailing ? `, ${custom.trailing} trailing byte(s)` : '') +
    ` · ${lit.length} lit, ${custom.records.length - lit.length} off, ` +
    `${colours.size} distinct lit colour(s)`;
}

async function refreshEffect() {
  try {
    const effect = Number(lMode.value) || 0;
    const cfg = await hid.readEffectConfig(effect);
    if (cfg) {
      lastEffectPayload = buildEffectConfig({
        effect: cfg.effect, brightness: cfg.brightness, speed: cfg.speed,
        readback: Uint8Array.of(0, 0, 0, ...cfg.opaque),
      });
      showOutput('#lightOut',
        `read 0x17 -> effect ${cfg.effect}, brightness ${cfg.brightness}%, speed ${cfg.speed}\n` +
        `opaque bytes ${cfg.opaque.map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n` +
        `uint64 0x${cfg.value.toString(16).padStart(16, '0')}`);
      return cfg;
    }
    showOutput('#lightOut', 'device returned fewer than 8 bytes; cannot seed opaque fields');
    return null;
  } catch (err) {
    showOutput('#lightOut', `read failed: ${err.message ?? err}`);
    return null;
  }
}

$('#btnGetLight').addEventListener('click', refreshEffect);

$('#btnTurnOffBacklight').addEventListener('click', async () => {
  if (!hid.connected) {
    showOutput('#lightOut', 'Not connected to keyboard. Press Connect first.');
    return;
  }
  try {
    const r = await hid.setEffectLightVerified({ effect: 0, brightness: 0, speed: 1 });
    showOutput('#lightOut',
      `sent 0x13 Close (effect 0): all keys off\n` +
      `response frame ${r.write.frame}/${r.write.total} len ${r.write.payload.length}\n` +
      `${hex(r.write.payload)}\n` +
      `VERIFIED: ${r.match ? 'yes' : 'NO - device state does not match'}`);
    if (!r.match) fail(new Error('Close write did not verify'));
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

/**
 * One read pass for the whole lighting page: effect config (0x17), the name
 * table (0x18) and the per-key colour table (0x16). Nothing here writes, so it
 * is the safe first action on the tab.
 */
$('#btnLightReadAll').addEventListener('click', async () => {
  const status = $('#lightStatus');
  try {
    setStatus('reading lighting...', '');
    const wanted = Number(lMode.value);
    // One whole-table read. 0xFF is the table sentinel, not "current effect".
    const table = await hid.readEffectConfigs();
    let names = null;
    let custom = null;
    try { names = await hid.readEffectNames(); } catch (err) { /* names are optional */ }
    try {
      custom = parseCustomLight((await hid.readAll(CMD.GET_CUSTOM_LIGHT)).pages);
    } catch (err) { /* per-key table is optional too */ }

    if (names && names.length) {
      lMode.innerHTML = '';
      for (const { index, name } of names) {
        if (index > EFFECT_MAX || index === 0) continue; // Skip "Close" - use dedicated button
        const opt = document.createElement('option');
        opt.value = String(index);
        opt.textContent = name === null ? `#${index} (undecoded)` : `${index}. ${name}`;
        lMode.appendChild(opt);
      }
    }

    showOutput('#lightOut',
      `${formatEffectTable(table)}\n${formatCustomLightSummary(custom)}`);

    if (!table.records.length) {
      status.textContent =
        `0x17 returned ${table.joined.length} byte(s) but no whole 8-byte effect record` +
        (table.trailing ? ` (${table.trailing} trailing byte(s)).` : '.');
      return;
    }

    // Populate the editor from the slot the user selected, never silently from
    // slot 0. `wanted` is an effect index; fall back only with an explicit note.
    let cfg = table.records.find((r) => r.effect === wanted) ?? null;
    let note = '';
    if (!cfg) {
      cfg = table.records[0];
      note = Number.isInteger(wanted)
        ? ` Effect ${wanted} was not in the table, so slot ${cfg.slot} is shown instead.`
        : ` No effect was selected, so slot ${cfg.slot} is shown.`;
    }

    lastEffectPayload = buildEffectConfig({
      effect: cfg.effect, brightness: cfg.brightness, speed: cfg.speed,
      readback: Uint8Array.of(0, 0, 0, ...cfg.opaque),
    });
    if ([...lMode.options].some((o) => o.value === String(cfg.effect))) {
      lMode.value = String(cfg.effect);
    }
    lBright.value = String(cfg.brightness);
    lSpeed.value = String(cfg.speed);
    $('#lBrightOut').textContent = String(cfg.brightness);
    $('#lSpeedOut').textContent = String(cfg.speed);
    lEffectColor.value = cfg.colour.hex;

    updateLightingControls();

    status.textContent =
      `Effect table: ${table.records.length} record(s). Editing slot ${cfg.slot}: ` +
      `effect ${cfg.effect} (${effectLabel(cfg.effect)}) · brightness ${cfg.brightness}% · ` +
      `speed ${cfg.speed} · colour ${cfg.colour.hex} · ` +
      `per-key records ${custom ? custom.records.length : 'unavailable'}.${note} ` +
      'The device does not report which effect slot is active; 0x17 with 0xFF is a ' +
      'whole-table read, and 0x19 has no device-side readback.';
    setStatus('lighting state read', 'on');
  } catch (err) {
    fail(err);
    status.textContent = String(err.message ?? err);
  }
});

$('#btnApplyLighting').addEventListener('click', async () => {
  if (!hid.connected) {
    showOutput('#lightOut', 'Not connected to keyboard. Press Connect first.');
    return;
  }
  const status = $('#lightStatus');
  try {
    status.textContent = 'Applying lighting to keyboard...';
    const effect = Number(lMode.value);
    const brightness = Number(lBright.value);
    const speed = Number(lSpeed.value);
    const hexv = lEffectColor.value.slice(1);
    const red = parseInt(hexv.slice(0, 2), 16);
    const green = parseInt(hexv.slice(2, 4), 16);
    const blue = parseInt(hexv.slice(4, 6), 16);

    // 1. Set effect, brightness, speed
    await hid.setEffectLightVerified({ effect, brightness, speed });

    // 2. Set color if applicable
    const showColour = [1, 2, 3, 4, 9, 10, 11].includes(effect);
    if (showColour) {
      await hid.setEffectColour({ effect, red, green, blue });
    }

    // 3. Activate running effect
    await hid.selectEffectLight(effect);

    status.textContent = `Applied: ${effectLabel(effect)} (${brightness}% brightness, speed ${speed}${showColour ? ', ' + lEffectColor.value : ''}) · Active on keyboard`;
    showOutput('#lightOut', `Applied and activated effect ${effect} (${effectLabel(effect)}).`);
  } catch (err) {
    fail(err);
    status.textContent = `Lighting update failed: ${err.message ?? err}`;
  }
});

$('#btnSetLight').addEventListener('click', async () => {
  if (!hid.connected) {
    showOutput('#lightOut', 'Not connected to keyboard. Press Connect first.');
    return;
  }
  try {
    // Read first so bytes 3..7 are preserved; then apply. Two round trips.
    const cfg = await refreshEffect();
    const effect = Number(lMode.value);
    const brightness = Number(lBright.value);
    const speed = Number(lSpeed.value);
    const readback = cfg
      ? Uint8Array.of(0, 0, 0, ...cfg.opaque)
      : lastEffectPayload;
    const r = await hid.setEffectLightVerified({ effect, brightness, speed });
    const sent = buildEffectConfig({
      effect, brightness, speed,
      readback: readback ?? (r.before ? Uint8Array.of(0, 0, 0, ...r.before.opaque) : null),
    });
    const a = r.after;
    showOutput('#lightOut',
      `sent 0x13 [${[...sent].join(', ')}]\n` +
      `  effect=${effect} brightness=${brightness}% speed=${speed}` +
      `${readback ? ' (opaque bytes preserved)' : ' (NO readback - opaque bytes zeroed)'}\n` +
      `response frame ${r.write.frame}/${r.write.total} len ${r.write.payload.length}\n` +
      `${hex(r.write.payload)}\n\n` +
      `readback via 0x17: ` +
      (a ? `effect=${a.effect} brightness=${a.brightness}% speed=${a.speed}` : 'FAILED') +
      `\n  VERIFIED: ${r.match ? 'yes' : 'NO - device state does not match what was sent'}`);
    if (!r.match) fail(new Error('0x13 write did not verify against device readback'));
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

$('#btnGetLightName').addEventListener('click', async () => {
  try {
    // 0x18 takes a one-byte name-set selector; 0 is the English/default set.
    const r = await hid.getEffectLightName(0);
    showOutput('#lightOut',
      `0x18 name set 0 — len ${r.payload.length}\n${hex(r.payload)}\n${asciiPreview(r.payload)}`);
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

$('#btnCustom').addEventListener('click', async () => {
  try {
    const r = await hid.getCustomLight();
    showOutput('#lightOut', `0x16 len ${r.payload.length}\n${hex(r.payload)}\n${asciiPreview(r.payload)}`);
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

$('#btnSetColour').addEventListener('click', async () => {
  if (!hid.connected) {
    showOutput('#lightOut', 'Not connected to keyboard. Press Connect first.');
    return;
  }
  try {
    const effect = Number(lMode.value);
    const hexv = lEffectColor.value.slice(1);
    const red = parseInt(hexv.slice(0, 2), 16);
    const green = parseInt(hexv.slice(2, 4), 16);
    const blue = parseInt(hexv.slice(4, 6), 16);
    const r = await hid.setEffectColour({ effect, red, green, blue });
    const a = r.after;
    showOutput('#lightOut',
      `sent 0x13 colour for effect ${effect}: ${lEffectColor.value} ` +
      `(${[red, green, blue].join(', ')})\n` +
      `preserved from readback: brightness ${r.before?.brightness ?? '?'}% ` +
      `speed ${r.before?.speed ?? '?'} bytes3-4 [${(r.before?.unnamed ?? []).map((b) => b.toString(16)).join(' ')}]\n` +
      `response len ${r.write.payload.length}\n${hex(r.write.payload)}\n` +
      `0x17 after: ${a ? `effect=${a.effect} bright=${a.brightness} speed=${a.speed} colour=${a.colour.hex}` : 'FAILED'}\n` +
      `  VERIFIED: ${r.match ? 'yes' : 'NO - colour did not take'}`);
    if (!r.match) fail(new Error('colour write did not verify against readback'));
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

$('#btnSelectEffect').addEventListener('click', async () => {
  try {
    const effect = Number(lMode.value);
    // 0x19 selects which effect is active. The device's 0x99 reply does not
    // carry device state: FUN_14009a740 emits the index the host stored at
    // +0x248 before sending, so the vendor UI only ever sees its own value.
    // No command in the protocol reads the active effect back (PROTOCOL.md
    // 8.17.2), so this reports "accepted, not verifiable" rather than faking
    // a readback.
    const w = await hid.selectEffectLight(effect);
    const ack = w.opcode === 0x99;
    showOutput('#lightOut',
      `sent 0x19 effect=${effect}\n` +
      `response opcode 0x${w.opcode.toString(16)} ${ack ? '(acknowledged)' : '(unexpected)'}\n` +
      `payload len ${w.payload.length}${w.payload.length ? `\n${hex(w.payload)}` : ''}\n\n` +
      'The protocol has no device-side active-effect read:\n' +
      '  - 0x17 with 0xFF is the whole effect table, not the current effect;\n' +
      '  - the 0x99 reply is filled from the host\'s own sent index, not from\n' +
      '    device state, so it cannot prove which effect is running.\n' +
      `  ACCEPTED (not verifiable): ${ack ? 'yes' : 'NO - unexpected reply opcode'}`);
    if (!ack) fail(new Error(`0x19 replied with unexpected opcode 0x${w.opcode.toString(16)}`));
  } catch (err) { fail(err); showOutput('#lightOut', String(err.message ?? err)); }
});

/* ------------------------------------------------------------------ key map */

/**
 * A reference keymap is the state of the board at a moment the user chose.
 *
 * There is no correct way to tell a remapped key from a stock one without a
 * reference: the record carries no "changed" flag, and the key index is not the
 * HID usage, so `usage !== index` is a test of nothing. An earlier version of
 * this file made exactly that mistake and would have marked nearly every key on
 * a factory-fresh board as changed.
 *
 * So the comparison is always against a reference the user took, and with no
 * reference the app says so rather than guessing.
 */
let keymapReference = null;
let lastKeymapRecords = null;

/** Stable per-record signature: the three wire bytes for one key. */
function keymapSignature(records) {
  // Wire order, not schema order: type, lValue, hValue (PROTOCOL.md 8.18.5).
  return records.map((r) => `${r.keyItem}:${r.type},${r.lValue},${r.hValue}`).join('\n');
}

function renderKeymap(records) {
  const grid = $('#keymapGrid');
  grid.innerHTML = '';
  const sig = keymapSignature(records);
  const ref = keymapReference && keymapReference.signature === sig ? null : keymapReference;
  const refMap = new Map();
  if (ref) {
    ref.signature.split('\n').forEach((line, i) => {
      refMap.set(line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1));
    });
  }
  let differing = 0;
  for (const r of records) {
    const now = `${r.type},${r.lValue},${r.hValue}`;
    const was = refMap.get(String(r.keyItem));
    const differs = was !== undefined && was !== now;
    if (differs) differing += 1;
    const el = document.createElement('div');
    el.className = 'k' + (differs ? ' changed' : '');
    // Wire bytes are type, lValue, hValue - keyItem is implied by position and
    // is sent only for the first entry (PROTOCOL.md 8.18.5). hValue holds the
    // HID usage; lValue reads 0x01 throughout the captures.
    el.title = `keyItem ${r.keyItem} - usage 0x${r.hValue.toString(16).padStart(2, '0')} ` +
      `[type ${r.type} lValue ${r.lValue} hValue ${r.hValue}]` +
      (was === undefined ? '\nnot present in the reference'
        : differs ? `\nreference: ${was}` : '\nunchanged from the reference');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${r.keyItem}: ${r.name}`;
    const u = document.createElement('span');
    u.className = 'u';
    u.textContent = r.hValue.toString(16).padStart(2, '0');
    el.append(n, u);
    grid.append(el);
  }
  return { total: records.length, differing, hasReference: Boolean(ref), signature: sig };
}

$('#btnReadKeymap').addEventListener('click', async () => {
  try {
    // 0x2A's payload is the keymap layer (sender+0xC0), not an empty request.
    const layer = Number($('#kLayer').value) & 0xff;
    const r = await hid.readKeyConfig(layer);
    const records = parseKeymap(r.frames.map((f) => f.payload));
    lastKeymapRecords = records;
    const res = renderKeymap(records);
    $('#btnKeymapRef').disabled = false;
    showOutput('#keymapOut',
      `0x2A layer ${layer}, frames ${r.frames.length}, ${res.total} key records\n\n` +
      (res.hasReference
        ? `${res.differing} key(s) differ from the reference taken ` +
          `${keymapReference.taken}.\n\n`
        : 'No reference saved, so nothing can be said about which keys are\n' +
          'remapped - the record carries no changed flag and a key index is not\n' +
          'a HID usage, so there is no way to tell from one read alone. Take a\n' +
          'reference, change something, then read again.\n\n') +
      `Wire layout: keyItem, type, lValue, hValue. keyItem is implied by\n` +
      `position and sent only for the first entry; the other three are permuted\n` +
      `relative to the schema - the 0x20 builder writes rec[1], rec[3], rec[2].\n` +
      `hValue holds the HID usage; lValue reads 0x01 throughout the captures.\n` +
      `Note that the macro record uses the opposite order (lValue then hValue).\n\n` +
      `pages:\n` + r.frames.map((f, i) =>
        `[${i}] frame ${f.frame}/${f.total} len ${f.payload.length}`).join('\n'));
  } catch (err) { fail(err); showOutput('#keymapOut', String(err.message ?? err)); }
});

$('#btnKeymapRef').addEventListener('click', () => {
  const sig = keymapReference?.signature;
  if (!sig) return;
  const blob = new Blob([JSON.stringify({
    note: 'Reference keymap. keyItem is implied by position; the three values are '
      + 'type, hValue, lValue as sent on the wire.',
    taken: keymapReference.taken,
    signature: sig.split('\n'),
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `apex200-keymap-reference-${keymapReference.taken.replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  log($('#trace'), 'l-out', 'keymap reference saved');
});

$('#btnKeymapSetRef').addEventListener('click', () => {
  if (!lastKeymapRecords || !lastKeymapRecords.length) {
    fail(new Error('read the keymap first'));
    return;
  }
  keymapReference = {
    signature: keymapSignature(lastKeymapRecords),
    taken: new Date().toISOString(),
  };
  const res = renderKeymap(lastKeymapRecords);
  showOutput('#keymapOut',
    `Reference taken ${keymapReference.taken} from ${res.total} records.\n\n` +
    `Read the keymap again after changing anything to see what differs. Save the\n` +
    `reference to a file to keep it.`);
});

/* --------------------------------------------------------- device snapshot */

let snapshotJson = null;

/** Short "N keys, M pages" style summary for one snapshot section. */
function snapshotSummary(name, value) {
  if (value && typeof value === 'object' && 'error' in value) return `failed: ${value.error}`;
  const bytesOf = (v) => (v && v.joined ? v.joined.length
    : v && v.payload ? v.payload.length
      : v && v.pages ? v.pages.reduce((n, p) => n + p.length, 0) : null);
  const n = bytesOf(value);
  const extra = [];
  if (name === 'customLight' && value?.pages) {
    extra.push(`${parseCustomLight(value.pages).records.length} keys`);
  }
  if (name === 'effectLight' && value?.joined) {
    extra.push(`${parseEffectConfigs(value.joined).records.length} effects`);
  }
  if ((name === 'keyboardConfig' || name === 'keyboardConfig1') && value?.pages) {
    extra.push(`${parseKeymap(value.pages).length} keys`);
  }
  if (name === 'macro' && value) extra.push(`${value.frames ? value.frames.length : 0} frames`);
  if (name === 'highKey' && value) extra.push(`${value.frames ? value.frames.length : 0} frames`);
  return [n === null ? 'read' : `${n} bytes`, ...extra].join(', ');
}

$('#btnSnapshot').addEventListener('click', async () => {
  const btn = $('#btnSnapshot');
  btn.disabled = true;
  $('#btnSnapshotSave').disabled = true;
  snapshotJson = null;
  const box = $('#snapSummary');
  box.innerHTML = '';
  showOutput('#snapOut', 'reading the config tables from the device...');
  try {
    const snap = await hid.snapshot();
    for (const p of snap.parts) {
      const row = document.createElement('div');
      row.className = `r${p.ok ? '' : ' bad'}`;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = p.name;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = p.ok ? snapshotSummary(p.name, snap.data[p.name]) : `failed: ${p.error}`;
      row.append(k, v);
      box.append(row);
    }
    const okCount = snap.parts.filter((p) => p.ok).length;
    // Every payload becomes a byte array so the JSON is a faithful record rather
    // than a lossy summary.
    const data = {};
    for (const p of snap.parts) {
      data[p.name] = snap.data[p.name] && snap.data[p.name].joined
        ? Array.from(snap.data[p.name].joined)
        : snap.data[p.name] && snap.data[p.name].payload
          ? Array.from(snap.data[p.name].payload)
          : snap.data[p.name] && snap.data[p.name].pages
            ? snap.data[p.name].pages.map((pg) => Array.from(pg))
            : snap.data[p.name];
    }
    // Keep both views: `data` is what the device said, `decoded` is this
    // project's reading of it. A backup that could only be read back through the
    // same decoder that produced it would be no backup at all.
    const decoded = {};
    for (const p of snap.parts) {
      decoded[p.name] = p.ok ? decodeSnapshotSection(p.name, snap.data[p.name]) : null;
    }
    snapshotJson = JSON.stringify({
      taken: new Date().toISOString(),
      vid: '0x314b',
      pid: '0x1026',
      note: 'data holds the device payloads as byte arrays; decoded is this '
        + "project's reading of them and may be absent for tables with no decoder.",
      sections: snap.parts,
      data,
      decoded,
    }, null, 2);
    $('#btnSnapshotSave').disabled = false;
    const decodedCount = Object.values(decoded).filter((v) => v !== null).length;
    showOutput('#snapOut',
      `${okCount}/${snap.parts.length} tables read, ${decodedCount} with a decoded view.\n\n` +
      `Saved as JSON with every payload as a byte array, plus a decoded view of\n` +
      `each table that has a decoder. Keep it somewhere safe: it is the only\n` +
      `copy of this state.`);
  } catch (err) {
    fail(err);
    showOutput('#snapOut', String(err.message ?? err));
  } finally {
    btn.disabled = false;
  }
});

$('#btnSnapshotSave').addEventListener('click', () => {
  if (!snapshotJson) { fail(new Error('take a snapshot first')); return; }
  const blob = new Blob([snapshotJson], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `apex200-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  log($('#trace'), 'l-out', `snapshot saved (${(snapshotJson.length / 1024).toFixed(1)} KiB)`);
});

/* ---------------------------------------------------------- global settings */

/**
 * The eight host-settable fields of the `0x50`/`0x5E` blob.
 *
 * Names come from `params_table` in the app's own schema; the values are raw
 * device numbers. The form deliberately does not turn the switches into
 * on/off checkboxes or the polling rate into a Hz list, because nothing in the
 * binary says which byte means 500 Hz - only which byte is called pollingRate.
 */
const PARAM_ROWS = [
  { key: 'touchOptimize', label: 'pTouch', shown: 'pvTouch' },
  { key: 'deadDown', label: 'pDeadDown', shown: 'pvDeadDown' },
  { key: 'deadUp', label: 'pDeadUp', shown: 'pvDeadUp' },
  { key: 'pollingRate', label: 'pPolling', shown: 'pvPolling' },
  { key: 'shakeLevel', label: 'pShake', shown: 'pvShake' },
  { key: 'calibration', label: 'pCalib', shown: 'pvCalib' },
  { key: 'sportsMode', label: 'pSports', shown: 'pvSports' },
  { key: 'currentLayer', label: 'pLayer', shown: 'pvLayer' },
];

/** Populate the table from a `0x5E` payload and mark rows the user has edited. */
function renderParams(p) {
  for (const row of PARAM_ROWS) {
    const value = p[row.key];
    $(`#${row.shown}`).textContent = String(value);
    $(`#${row.label}`).value = String(value);
    $(`#${row.label}`).closest('tr').classList.remove('changed');
  }
}

/** The fields whose input differs from what the device reported. */
function changedParams(baseline) {
  const out = {};
  for (const row of PARAM_ROWS) {
    const input = $(`#${row.label}`);
    const v = Number(input.value);
    if (!Number.isInteger(v)) {
      throw new Error(`${row.key} must be a whole number, got "${input.value}"`);
    }
    if (v !== baseline[row.key]) out[row.key] = v;
  }
  return out;
}

$('#btnReadParams').addEventListener('click', async () => {
  try {
    const r = await hid.getWholeParam();
    const p = parseWholeParams(r.payload);
    renderParams(p);
    showOutput('#paramsOut',
      `0x5E len ${r.payload.length}\n\n` +
      `reserve 0x${p.reserve.toString(16).padStart(2, '0')} (constant, never varies)\n` +
      PARAM_ROWS.map((row) => `  ${row.key.padEnd(15)} ${String(p[row.key]).padStart(5)}`).join('\n') +
      `\n\nraw ${hex(r.payload)}`);
  } catch (err) { fail(err); showOutput('#paramsOut', String(err.message ?? err)); }
});

for (const row of PARAM_ROWS) {
  $(`#${row.label}`).addEventListener('input', () => {
    $(`#${row.label}`).closest('tr').classList.add('changed');
  });
}

$('#btnApplyParams').addEventListener('click', async () => {
  try {
    const before = parseWholeParams((await hid.getWholeParam()).payload);
    renderParams(before);
    const changes = changedParams(before);
    if (Object.keys(changes).length === 0) {
      showOutput('#paramsOut', 'nothing changed - edit a value first');
      return;
    }
    const summary = Object.entries(changes)
      .map(([k, v]) => `  ${k}: ${before[k]} -> ${v}`).join('\n');
    if (!confirm(`Write these global settings?\n\n${summary}\n\n` +
      'Everything you did not edit is carried forward byte-for-byte, ' +
      'the same read-modify-write the Windows form does.')) return;
    const r = await hid.setWholeParam(changes);
    renderParams(r.after);
    showOutput('#paramsOut',
      `sent 0x50, ${r.payload.length} bytes\n${summary}\n\n` +
      `payload ${r.payload.map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n` +
      `readback ${r.after.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n` +
      `  VERIFIED: ${r.matched ? 'yes - the device reports the new blob' : 'NO - readback differs'}`);
    if (!r.matched) fail(new Error('0x50 write did not verify against readback'));
  } catch (err) { fail(err); showOutput('#paramsOut', String(err.message ?? err)); }
});

$('#btnReadWholeParam').addEventListener('click', async () => {
  try {
    const r = await hid.getWholeParam();
    showOutput('#keymapOut',
      `0x5E len ${r.payload.length}\n${hex(r.payload)}\n${asciiPreview(r.payload)}`);
  } catch (err) { fail(err); showOutput('#keymapOut', String(err.message ?? err)); }
});

/* ------------------------------------------------------------------- macros */

// Slots M1..M10, matching the Windows app's macro editor.
const mSlot = $('#mSlot');
for (let i = 0; i < 10; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = `M${i + 1} (slot ${i})`;
  mSlot.appendChild(opt);
}

/**
 * Macro step editor.
 *
 * A macro is a list of 6-byte records; each record is one keystroke with a
 * delay. The field names come from the `key_macro_table` DDL inside
 * GameKeyboard.exe (PROTOCOL.md 8.12), so this is the Windows app's model rather
 * than a guess at one.
 *
 * Steps live in `macroSteps` in *struct* order. The driver applies the wire
 * transposition, so nothing here deals in wire order.
 */
const macroSteps = [];

/** Add a step to the editor. Omitting `step` appends a sensible default. */
function addMacroStep(step = {}) {
  macroSteps.push({
    usage: step.usage ?? 0x04, // A
    state: step.state ?? MACRO_STATE.DOWN,
    time: step.time ?? 0,
    // A step read back from the device whose `type` byte we have no name for is
    // kept verbatim rather than being rewritten with the form's default type.
    type: step.type ?? null,
  });
  renderMacroSteps();
}

function renderMacroSteps() {
  const body = $('#macroSteps');
  body.innerHTML = '';
  if (macroSteps.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'idx';
    td.textContent = 'no steps - add one, or read a slot from the keyboard';
    tr.append(td);
    body.append(tr);
    return;
  }
  macroSteps.forEach((step, i) => {
    const tr = document.createElement('tr');
    if (step.type !== null && step.type !== Number($('#mType').value)) tr.className = 'from-device';

    const idx = document.createElement('td');
    idx.className = 'idx';
    idx.textContent = String(i + 1);

    const keyTd = document.createElement('td');
    const key = document.createElement('select');
    for (const { code, name } of keyOptions()) {
      const opt = document.createElement('option');
      opt.value = String(code);
      opt.textContent = name;
      if (code === step.usage) opt.selected = true;
      key.append(opt);
    }
    if (!keyOptions().some((o) => o.code === step.usage)) {
      // An unnamed usage stays editable by number rather than being coerced.
      const opt = document.createElement('option');
      opt.value = String(step.usage);
      opt.textContent = `0x${step.usage.toString(16).padStart(2, '0')} (unnamed)`;
      opt.selected = true;
      key.append(opt);
    }
    key.addEventListener('change', () => { step.usage = Number(key.value); });
    keyTd.append(key);

    const stateTd = document.createElement('td');
    const st = document.createElement('select');
    for (const [v, label] of [[MACRO_STATE.DOWN, 'Down'], [MACRO_STATE.UP, 'Up'], [2, 'Marker']]) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = label;
      if (v === step.state) opt.selected = true;
      st.append(opt);
    }
    st.addEventListener('change', () => { step.state = Number(st.value); });
    stateTd.append(st);

    const timeTd = document.createElement('td');
    const time = document.createElement('input');
    time.type = 'number';
    time.min = '0';
    time.max = String(MACRO_TIME_MAX);
    time.step = '10';
    time.value = String(step.time);
    time.addEventListener('change', () => {
      const v = Number(time.value);
      if (!Number.isInteger(v) || v < 0 || v > MACRO_TIME_MAX) {
        fail(new Error(`delay must be 0..${MACRO_TIME_MAX} ms, got ${time.value}`));
        time.value = String(step.time);
        return;
      }
      step.time = v;
    });
    timeTd.append(time);

    const delTd = document.createElement('td');
    delTd.className = 'drop';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'x';
    del.title = `remove step ${i + 1}`;
    del.addEventListener('click', () => { macroSteps.splice(i, 1); renderMacroSteps(); });
    delTd.append(del);

    tr.append(idx, keyTd, stateTd, timeTd, delTd);
    body.append(tr);
  });
}

/** Turn the editor contents into the records for `0x40`. */
function macroRecordsFromEditor() {
  if (macroSteps.length === 0) throw new Error('add at least one step, or read a slot first');
  const type = Number($('#mType').value);
  return macroSteps.map((step) => encodeMacroRecord({
    type: step.type ?? type,
    state: step.state,
    usage: step.usage,
    time: step.time,
  }));
}

/** Replace the editor with what a slot holds on the device. */
function loadMacroEditor(records, label) {
  macroSteps.length = 0;
  for (const r of records) macroSteps.push({ usage: r.usage, state: r.state, time: r.time, type: r.type });
  renderMacroSteps();
  if (records.length) {
    // Adopt the slot's own type byte so a round trip is byte-identical.
    $('#mType').value = String(records[0].type);
  }
  if (label) log($('#trace'), 'l-in', `macro editor loaded from ${label}`);
}

renderMacroSteps();
$('#btnAddStep').addEventListener('click', () => addMacroStep());
$('#btnClearSteps').addEventListener('click', () => { macroSteps.length = 0; renderMacroSteps(); });

$('#btnReadMacros').addEventListener('click', async () => {
  try {
    // 0x42 is per-slot: the payload is sender+0x108. Read the slot selected in
    // the editor, so the steps loaded below are the steps a write will target.
    const slot = Number($('#mSlot').value) || 0;
    const r = await hid.readMacros(slot);
    let out = `0x42 slot ${slot} (M${slot + 1}), ${r.frames.length} frame(s)\n\n`;
    const all = [];
    for (const f of r.frames) {
      if (f.payload.length < 2) { out += `len ${f.payload.length}, too short\n${hex(f.payload)}\n`; continue; }
      const parsed = parseMacroRecords(f.payload);
      const recs = parsed.records.filter((x) => !x.error);
      all.push(...recs);
      out += `slot M${parsed.slot + 1}, ${parsed.count} record(s)\n`;
      for (const rec of recs) {
        out += `  [${rec.index}] ${keyName(rec.usage).padEnd(10)} ` +
          `${rec.state === MACRO_STATE.DOWN ? 'down' : rec.state === MACRO_STATE.UP ? 'up ' : `st${rec.state}`} ` +
          `${String(rec.time).padStart(5)} ms   type=${rec.type}  ` +
          `[${rec.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}]\n`;
      }
      for (const bad of parsed.records.filter((x) => x.error)) out += `  ${bad.error}\n`;
    }
    if (all.length) loadMacroEditor(all, `M${slot + 1} (${all.length} step(s))`);
    showOutput('#macroOut', out);
  } catch (err) { fail(err); showOutput('#macroOut', String(err.message ?? err)); }
});

$('#btnSetMacro').addEventListener('click', async () => {
  try {
    const slot = Number($('#mSlot').value);
    const records = macroRecordsFromEditor();
    const summary = records.map((r, i) =>
      `  ${i + 1}. ${keyName(r[2] | (r[3] << 8))} ${r[1] === MACRO_STATE.DOWN ? 'down' : 'up'} ${r[4] | (r[5] << 8)} ms`
    ).join('\n');
    if (!confirm(`Write ${records.length} step(s) to M${slot + 1}?\n\n${summary}`)) return;
    const replies = await hid.setMacro({ slot, records });
    const after = await hid.readMacros(slot);
    // The write is paged, so flatten every page of the slot before comparing.
    const slotRecs = after.frames
      .map((f) => (f.payload.length >= 2 ? parseMacroRecords(f.payload) : null))
      .filter(Boolean)
      .filter((p) => p.slot === slot)
      .flatMap((p) => p.records.filter((x) => !x.error));
    const back = slotRecs.length === records.length
      && slotRecs.every((r, i) => r.bytes.every((b, j) => b === records[i][j]));
    const flat = records.flat();
    showOutput('#macroOut',
      `sent 0x40 slot=${slot}, ${records.length} record(s) in ${replies.length} page(s), ` +
      `${flat.length} payload bytes\n` +
      `${summary}\n\n` +
      replies.map((r, i) => `page ${i + 1} response len ${r.payload.length}\n${hex(r.payload)}`).join('\n') + '\n' +
      `  VERIFIED: ${back ? 'yes - M' + (slot + 1) + ' reads back byte-identical' : 'NO - slot did not read back as written'}`);
    if (!back) fail(new Error('macro write did not verify against readback'));
  } catch (err) { fail(err); showOutput('#macroOut', String(err.message ?? err)); }
});

$('#btnDelMacro').addEventListener('click', async () => {
  const slot = Number($('#mSlot').value);
  if (!confirm(`Delete M${slot + 1}?`)) return;
  try {
    const r = await hid.delMacro(slot);
    showOutput('#macroOut', `sent 0x41 slot=${slot}\nresponse len ${r.payload.length}\n${hex(r.payload)}`);
  } catch (err) { fail(err); showOutput('#macroOut', String(err.message ?? err)); }
});

/* ------------------------------------------------------- profiles & Fn layer */

function parseHexBytes(text, want) {
  const s = String(text).replace(/[^0-9a-fA-F]/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
  if (want !== null && bytes.length !== want) {
    throw new Error(`expected ${want} hex bytes, got ${bytes.length}`);
  }
  return bytes;
}

// Keep the SOCD selector visible only when SOCD is chosen.
function syncSocdRow() {
  const isSocd = $('#hType').value === 'SOCD';
  $('#hSocdRow').style.display = isSocd ? '' : 'none';
  $('#hType').addEventListener('change', syncSocdRow);
}


// Show modifier visual breakdown when modifier changes.
function updateModifierVisual() {
  const mod = selectedModifier();
  const $modBadge = $('#modBadge');
  const $modData = $('#modData');
  const $modDecoded = $('#modDecoded');
  const $modVisual = $('#modifierVisual');
  
  // Hide visual by default
  if ($modVisual) $modVisual.style.display = 'none';
  
  if (!mod) {
    return;
  }
  
  const modId = mod.id;
  const modName = mod.name;
  const modLabel = mod.label;
  const dataLen = mod.dataLen;
  
  if ($modBadge) $modBadge.textContent = modLabel + ' modifier';
  if ($modVisual) $modVisual.style.display = '';
  
  // Show data bytes hex display
  if ($modData) $modData.textContent = 'Data: ' + ($('#hData')?.value || 'no data');
  
  // Show decoded info based on modifier type
  let decodedText = '';
  switch (modId) {
    case 0: // TGL
      decodedText = '6-byte record: type + 4 data bytes (state, lValue, hValue, padding)';
      break;
    case 1: // MT
      decodedText = '11-byte record: type + 9 data bytes (key1, key2, 16-bit time, 3 padding bytes)';
      break;
    case 2: // DKS
      decodedText = '19-byte record: type + 17 data bytes (key, key1, key2, 3-byte time, padding)';
      break;
    case 3: // RS
      decodedText = '4-byte record: 2 data bytes + padding';
      break;
    case 4: // OKS
      decodedText = '4-byte record: 2 data bytes + padding';
      break;
    case 5: // SOCD
      decodedText = '5-byte record: key1 + key2 + mode byte';
      break;
    default:
      decodedText = dataLen + ' data bytes';
  }
  
  if ($modDecoded) $modDecoded.textContent = decodedText;
}

// Update modifier visual when modifier changes
$('#hType').addEventListener('change', () => {
  syncSocdRow();
  updateModifierVisual();
});


async function handleSocdConfirm() {
  const key1 = $('#hSocdKey1').value;
  const key2 = $('#hSocdKey2').value;
  const mode = $('#hSocdConfirmMode').value;
  const modeNames = ['Last key wins', 'Key1 wins', 'Key2 wins', 'Both pressed, neither triggers'];
  const modeName = modeNames[parseInt(mode)] || 'Unknown';
  const behDesc = 'when both keys are pressed, ' + modeName.toLowerCase();
  showOutput('#highKeyOut',
    'SOCD configured: key1=' + key1 + ', key2=' + key2 + ', mode=' + modeName);
  const socdSub = $('#socdSubmenu');
  if (socdSub) socdSub.style.display = 'none';
  const socdOut = $('#socdOutput');
  if (socdOut) socdOut.textContent = 'SOCD: key1=' + key1 + ', key2=' + key2 + ', mode=' + modeName;
}

$('#btnSocdConfirm').addEventListener('click', handleSocdConfirm);
syncSocdRow();

function selectedModifier() {
  return KEY_MODIFIERS[$('#hType').value];
}

async function highKeyWrite(doWrite, label, needle, expectPresent) {
  const before = (await hid.readHighKeys()).frames.map((f) => f.payload);
  const w = await doWrite();
  const after = (await hid.readHighKeys()).frames.map((f) => f.payload);
  const present = ApexHid.containsBytes(after, needle);
  const match = expectPresent ? present : !present;
  showOutput('#highKeyOut',
    `${label}\n` +
    `response len ${w.payload.length}\n${hex(w.payload)}\n\n` +
    `before (${before.length} frames):\n${before.map(hex).join('\n')}\n` +
    `after  (${after.length} frames):\n${after.map(hex).join('\n')}\n` +
    `  VERIFIED: ${match ? 'yes' : 'NO - device state does not match the expected outcome'}`);
  if (!match) fail(new Error(`${label} did not verify against device readback`));
}

$('#btnReadHighKeys').addEventListener('click', async () => {
  try {
    const r = await hid.readHighKeys();
    showOutput('#highKeyOut', `0x2B frames ${r.frames.length}\n` +
      r.frames.map((f, i) => `[${i}] frame ${f.frame}/${f.total} len ${f.payload.length}\n${hex(f.payload)}`).join('\n'));
  } catch (err) { fail(err); showOutput('#highKeyOut', String(err.message ?? err)); }
});

$('#btnDecodeHighKeys').addEventListener('click', async () => {
  try {
    const r = await hid.readHighKeys();
    const recs = ApexHid.decodeHighKeyPages(r.frames.map((f) => f.payload));
    showOutput('#highKeyOut',
      `0x2B frames ${r.frames.length}, decoded ${recs.length} 19-byte slot(s)\n\n` +
      recs.map((d, i) => d.error
        ? `[${i}] ERROR ${d.error}\n${hex(Uint8Array.from(d.raw))}`
        : `[${d.slot}] ${d.modifier.toUpperCase()} (${d.label}) key=0x${d.key.toString(16).padStart(2, '0')} ` +
          `type=${d.type} data=${d.dataLength ?? '?'}B ` +
          `[${d.data.map((b) => b.toString(16).padStart(2, '0')).join(' ')}]` +
          (d.paddingZero === false ? '  (nonzero padding)' : '')
      ).join('\n'));
  } catch (err) { fail(err); showOutput('#highKeyOut', String(err.message ?? err)); }
});

// HighKeyForm edits an existing binding in place; this loads a 0x2B readback
// into the same editor fields the 0x22 write uses, so Add can overwrite. The
// data bytes are copied from the decoded slot - no field is guessed.
$('#btnLoadHighKey').addEventListener('click', async () => {
  try {
    const key = Number($('#hIndex').value) & 0xff;
    const r = await hid.readHighKeys();
    const recs = ApexHid.decodeHighKeyPages(r.frames.map((f) => f.payload));
    const d = recs.find((x) => !x.error && x.key === key);
    if (!d) {
      showOutput('#highKeyOut', `no 0x2B binding for key 0x${key.toString(16).padStart(2, '0')}`);
      return;
    }
    const opt = [...$('#hType').options].find((o) => o.value === d.modifier.toUpperCase());
    if (!opt) throw new Error(`binding has modifier ${d.modifier}, which this editor cannot write`);
    $('#hType').value = opt.value;
    syncSocdRow();
    if (d.modifier === 'socd') {
      const [key1, key2, mode] = d.data;
      if (mode > 3) throw new Error(`SOCD mode ${mode} is outside the four documented modes`);
      $('#hSocdMode').value = String(mode);
      showOutput('#highKeyOut',
        `loaded SOCD binding for key 0x${key.toString(16).padStart(2, '0')}: ` +
        `key1=0x${key1.toString(16)} key2=0x${key2.toString(16)} mode=${mode}\n` +
        (key1 === 0xff && key2 === 0xff
          ? 'partner keys are the dialog default (0xFF); Add will send the same values'
          : 'WARNING: partner keys are not 0xFF; this editor sends the dialog default 0xFF/0xFF on Add'));
    } else {
      $('#hData').value = d.data.map((b) => b.toString(16).padStart(2, '0')).join(' ');
      showOutput('#highKeyOut',
        `loaded ${d.modifier.toUpperCase()} binding for key 0x${key.toString(16).padStart(2, '0')}: ` +
        `${d.data.length} data byte(s) copied into the editor`);
    }
  } catch (err) { fail(err); showOutput('#highKeyOut', String(err.message ?? err)); }
});

$('#btnAddHighKey').addEventListener('click', async () => {
  try {
    const key = Number($('#hIndex').value) & 0xff;
    const mod = selectedModifier();
    let data;
    if (mod.name === 'socd') {
      // Fully decoded: key, type, key1, key2, resolution mode. QSocdAddDialog
      // initialises both partner keys to 0xFF and only writes the mode.
      const mode = Number($('#hSocdMode').value);
      data = [0xff, 0xff, mode];
    } else {
      data = parseHexBytes($('#hData').value, mod.dataLen);
    }
    const { record } = buildHighKeyBinding({ modifier: mod.name, key, data });
    await highKeyWrite(() => hid.addHighKey({ modifier: mod.name, key, data }),
      `sent 0x22 ${mod.name} key=0x${key.toString(16)} [${[...record].join(', ')}]`, record, true);
  } catch (err) { fail(err); showOutput('#highKeyOut', String(err.message ?? err)); }
});

$('#btnDelHighKey').addEventListener('click', async () => {
  // 0x25's payload is the key item (sender+0x24A), not an array index.
  const key = Number($('#hIndex').value) & 0xff;
  const keyHex = `0x${key.toString(16).padStart(2, '0')}`;
  if (!confirm(`Delete the Fn-layer binding for key ${keyHex}?`)) return;
  try {
    const before = (await hid.readHighKeys()).frames.map((f) => f.payload);
    const w = await hid.delHighKey(key);
    const after = (await hid.readHighKeys()).frames.map((f) => f.payload);
    const changed = !ApexHid.pagesEqual(before, after);
    const stillSeen = ApexHid.containsBytes(after, Uint8Array.of(key));
    showOutput('#highKeyOut',
      `sent 0x25 key ${keyHex} (payload [${key}])\nresponse len ${w.payload.length}\n${hex(w.payload)}\n\n` +
      `before (${before.length} frames):\n${before.map(hex).join('\n')}\n` +
      `after  (${after.length} frames):\n${after.map(hex).join('\n')}\n` +
      `  key byte ${keyHex} ${stillSeen ? 'still appears somewhere (it can also be payload data)' : 'no longer present'}\n` +
      `  VERIFIED: ${changed ? 'yes - device table changed' : 'NO - device table unchanged'}`);
    if (!changed) fail(new Error('0x25 did not change device state'));
  } catch (err) { fail(err); showOutput('#highKeyOut', String(err.message ?? err)); }
});

$('#btnListProfiles').addEventListener('click', async () => {
  try {
    const r = await hid.listProfiles();
    showOutput('#profileOut', `0x57 frames ${r.frames.length}\n` +
      r.frames.map((f, i) => `[${i}] frame ${f.frame}/${f.total} len ${f.payload.length}\n${hex(f.payload)}`).join('\n'));
  } catch (err) { fail(err); showOutput('#profileOut', String(err.message ?? err)); }
});

const profileIndex = () => Number($('#pIndex').value) & 0xff;

/**
 * Run a profile write and prove the device's profile table actually changed.
 *
 * The exact record semantics of 0x57 are not decoded, so this does not claim to
 * know which byte marks "current". It asserts the weaker, still-useful fact that
 * the table the device returns is different afterwards than before.
 */
async function profileWrite(doWrite, label) {
  const before = (await hid.listProfiles()).frames.map((f) => f.payload);
  const w = await doWrite();
  const after = (await hid.listProfiles()).frames.map((f) => f.payload);
  const changed = !ApexHid.pagesEqual(before, after);
  showOutput('#profileOut',
    `${label}\n` +
    `response len ${w.payload.length}\n${hex(w.payload)}\n\n` +
    `before (${before.length} frames):\n${before.map(hex).join('\n')}\n` +
    `after  (${after.length} frames):\n${after.map(hex).join('\n')}\n` +
    `  VERIFIED: ${changed ? 'yes - device table changed' : 'NO - device table unchanged'}`);
  if (!changed) fail(new Error(`${label} did not change device state`));
}

$('#btnAddProfile').addEventListener('click', async () => {
  if (!confirm(
    `Add a profile keyed to index ${profileIndex()}?\n\n` +
    'The Windows app sends the currently selected profile\'s index here ' +
    '(FUN_140022830); what the board puts in the new slot is its own choice.')) return;
  try {
    await profileWrite(() => hid.addProfile(profileIndex()), `sent 0x58 index ${profileIndex()}`);
  } catch (err) { fail(err); showOutput('#profileOut', String(err.message ?? err)); }
});

$('#btnSwitchProfile').addEventListener('click', async () => {
  try {
    // The Windows app skips the send when the selected row already is the
    // device's current profile (FUN_140022610 compares against its
    // DAT_140197068+0x80 copy); this app has no cheap way to know that byte,
    // so the explicit switch always sends.
    await profileWrite(() => hid.switchProfile(profileIndex()), `sent 0x55 index ${profileIndex()}`);
  } catch (err) { fail(err); showOutput('#profileOut', String(err.message ?? err)); }
});

$('#btnDelProfile').addEventListener('click', async () => {
  if (!confirm(`Delete profile ${profileIndex()}? Its key bindings go with it.`)) return;
  try {
    // The Windows app refuses to delete the last remaining profile
    // (FUN_1400228a0 only sends when its profile count is > 1). The same guard
    // here: count the profile pages that carry a name (page[0] = 0x05,
    // PROTOCOL.md 7).
    const pages = (await hid.listProfiles()).pages;
    const count = pages.filter((p) => p.length > 3 && p[0] === 0x05).length;
    if (count <= 1) {
      showOutput('#profileOut',
        `refused: only ${count} profile page(s) carry a name; the Windows app ` +
        'never deletes the last remaining profile (FUN_1400228a0)');
      return;
    }
    await profileWrite(() => hid.delProfile(profileIndex()), `sent 0x59 index ${profileIndex()}`);
  } catch (err) { fail(err); showOutput('#profileOut', String(err.message ?? err)); }
});

/* -------------------------------------------------------------- hall effect */

const ranges = [
  ['#tTrigger', '#tTriggerV', LIMITS.trigger],
  ['#tRelease', '#tReleaseV', LIMITS.quickTriggerRelease],
  ['#tReset', '#tResetV', LIMITS.quickTriggerReset],
];
for (const [slider, label, range] of ranges) {
  const el = $(slider);
  el.min = range.min; el.max = range.max;
  el.addEventListener('input', () => { $(label).textContent = el.value; });
}

function buildKeyGrid() {
  const grid = $('#keyGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const rows = [0, 1, 2, 3, 4, 5].map((r) => KEYBOARD_LAYOUT_85.filter((k) => k.row === r));

  for (const rowKeys of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    for (const k of rowKeys) {
      const el = document.createElement('div');
      el.className = `kb-key key${k.id === selectedKey ? ' sel' : ''}`;
      el.dataset.keyId = String(k.id);
      el.style.flex = `${k.width} 1 0px`;
      el.title = `${k.label} (Item ${k.id}, width ${k.width}u)`;

      let inner = `<span class="kb-label">${escapeHtml(k.label)}</span>`;
      if (k.sub) {
        inner += `<span class="kb-sub">${escapeHtml(k.sub)}</span>`;
      }
      el.innerHTML = inner;
      rowEl.appendChild(el);
    }
    grid.appendChild(rowEl);
  }
}

const keyGridEl = $('#keyGrid');
if (keyGridEl) {
  keyGridEl.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.kb-key');
    if (keyEl && keyEl.dataset.keyId !== undefined) {
      setSelectedKey(Number(keyEl.dataset.keyId));
    }
  });
}

buildKeyGrid();
setSelectedKey(0);

$('#btnCalibStateRange').addEventListener('click', async () => {
  const start = Number($('#calibStart').value) || 1;
  const end = Number($('#calibEnd').value) || PRODUCT.keyNumber;
  try {
    const r = await hid.readCalibrationState();
    // readAll returns { pages, frames, total, joined }
    const pages = r.pages || [];
    const joined = r.joined || new Uint8Array(0);
    const numPages = pages.length;
    let totalLen = 0;
    for (const p of pages) totalLen += p.length;
    showOutput('#triggerOut', `0x52 getCalibrationState (whole table)\n${numPages} pages, ${totalLen} bytes\n${hex(joined.slice(0, 256))}`);
  } catch (err) { fail(err); showOutput('#triggerOut', String(err.message ?? err)); }
});
  $('#btnCalibRange').addEventListener('click', async () => {
  const start = Number($('#calibStart').value) || 1;
  const end = Number($('#calibEnd').value) || PRODUCT.keyNumber;
  try {
    const r = await hid.readCalibrationAdc();
    // readAll returns { pages, frames, total, joined }
    const pages = r.pages || [];
    const joined = r.joined || new Uint8Array(0);
    const numPages = pages.length;
    let totalLen = 0;
    for (const p of pages) totalLen += p.length;
    showOutput('#triggerOut', `0x5B getCalibrationAdc (whole table)\n${numPages} pages, ${totalLen} bytes\n${hex(joined.slice(0, 256))}`);
  } catch (err) { fail(err); showOutput('#triggerOut', String(err.message ?? err)); }
});

/* ------------------------------------------------------------ per-key light */

$('#btnPaintSelectedKey').addEventListener('click', async () => {
  try {
    const hexColor = $('#pkAllColor').value;
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const light = Number($('#pkAllMode').value) & 0xff;
    customKeyColors[selectedKey] = { light, r, g, b, hex: hexColor };
    setStatus(`setting colour for key ${selectedKey}...`, '');
    const res = await hid.setCustomLight({ keys: { [selectedKey]: { light, r, g, b } } });
    showOutput('#pkOut',
      `setCustomLight keyItem 0x${selectedKey.toString(16)} (${KEYBOARD_LAYOUT_85[selectedKey]?.label || selectedKey}):\n` +
      `  light: ${light}, rgb: (${r}, ${g}, ${b})\n` +
      `  readback matched: ${res.matched}\n` +
      `  pages: ${res.pages?.length ?? 1}`);
    setStatus(res.matched ? `Key ${selectedKey} colour set and verified` : `Key ${selectedKey} written (readback mismatch)`, res.matched ? 'on' : 'bad');
  } catch (err) { fail(err); showOutput('#pkOut', String(err.message ?? err)); }
});

$('#btnPkAll').addEventListener('click', async () => {
  try {
    const hex = $('#pkAllColor').value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const light = Number($('#pkAllMode').value) & 0xff;
    for (let i = 0; i < PRODUCT.keyNumber; i += 1) {
      customKeyColors[i] = { light, r, g, b, hex };
    }
    setStatus('setting per-key colours...', '');
    const res = await hid.setCustomLight({ all: { light, r, g, b } });
    const pages = (res.pages ?? [])
      .map((p) => `  page ${p.page}/${p.totalPages}: ${p.count} key(s), ${p.len}-byte payload`)
      .join('\n');
    showOutput('#pkOut',
      `setCustomLightAll wrote ${res.merged.length} keys in ${res.pages?.length ?? 1} page(s) ` +
      `(first keyItem 0x${res.merged[0].keyItem.toString(16)})\n` +
      `${pages}\n` +
      `readback matched: ${res.matched}\n\n` +
      `before: ${res.before.records.slice(0, 3).map(x=>`${x.keyItem.toString(16)}:${x.hex}`).join(' ')} ...\n` +
      `after:  ${res.after.records.slice(0, 3).map(x=>`${x.keyItem.toString(16)}:${x.hex}`).join(' ')} ...`);
    setStatus(res.matched ? 'per-key colours set and verified' : 'per-key colours written (readback mismatch)', res.matched ? 'on' : 'bad');
  } catch (err) { fail(err); showOutput('#pkOut', String(err.message ?? err)); }
});

/* ------------------------------------------------------------------ console */

$('#btnSend').addEventListener('click', async () => {
  try {
    const cmd = parseInt($('#cCmd').value.trim(), 16);
    if (Number.isNaN(cmd)) throw new Error('opcode must be hex');
    const payload = parseHexList($('#cData').value);
    const p1 = Number($('#cP1').value) & 0xff;
    const p2 = Number($('#cP2').value) & 0xff;
    const r = await hid.request(cmd, payload, { param1: p1, param2: p2 });
    showOutput('#consoleOut',
      `→ 0x${cmd.toString(16)} ${opcodeName(cmd)} p1=${p1} p2=${p2} payload=[${hex(payload)}]\n` +
      `← 0x${r.opcode.toString(16)} ${opcodeName(r.opcode)} frame ${r.frame}/${r.total} len ${r.payload.length}\n` +
      `${hex(r.payload.slice(0, 256))}${asciiPreview(r.payload)}`);
  } catch (err) {
    fail(err);
    showOutput('#consoleOut', String(err.message ?? err));
  }
});

function renderOpcodeList() {
  const lines = [];
  for (let op = 0; op <= 0xff; op += 1) {
    const name = OPCODE_NAME[op];
    if (!name) continue;
    const kind = isResponse(op) ? 'response' : 'request';
    lines.push(`0x${op.toString(16).padStart(2, '0')}  ${kind.padEnd(8)}  ${name}`);
  }
  $('#opcodeList').textContent = lines.join('\n');
}
renderOpcodeList();

$('#btnClearTrace').addEventListener('click', () => { $('#trace').innerHTML = ''; });

/* ---------------------------------------------------------------- alpha warning modal */

const alphaModal = $('#alphaModal');
const alphaAccepted = localStorage.getItem('apex-alpha-accepted');

if (!alphaAccepted && window.self === window.top) {
  // Show modal on first visit (not in iframe/test environment)
  alphaModal.style.display = 'flex';
} else {
  alphaModal.style.display = 'none';
}

$('#btnAlphaAccept').addEventListener('click', () => {
  localStorage.setItem('apex-alpha-accepted', '1');
  alphaModal.style.display = 'none';
});

$('#btnAlphaCancel').addEventListener('click', () => {
  alphaModal.style.display = 'none';
});

// Overview fast navigation buttons
const jumpTabs = [
  ['#btnJumpLighting', 'light'],
  ['#btnJumpProfiles', 'profiles'],
  ['#btnJumpTrigger', 'trigger'],
  ['#btnJumpDev', 'developer'],
];
for (const [btnId, tabName] of jumpTabs) {
  const b = $(btnId);
  if (b) {
    b.addEventListener('click', () => {
      const tab = document.querySelector(`.tabs button[data-tab="${tabName}"]`);
      if (tab) tab.click();
    });
  }
}

if (!webHidSupported()) {
  $('#nosupport').classList.remove('hidden');
  $('#btnConnect').disabled = true;
} else {
  hid.restore().then((d) => {
    if (d) {
      setStatus('connected', 'on');
      setConnected(true);
      dumpDeviceInfo();
      autoSync();
    }
  }).catch(() => {});
}

$('#vendorPill').textContent =
  `0x${(0x314b).toString(16).toUpperCase()}:${(0x1026).toString(16).toUpperCase()}`;

// Readiness marker for the DOM wiring suite. The page's `load` event fires before
// an ES module has necessarily finished evaluating, so a test that clicks a
// button can otherwise run against a page whose listeners do not exist yet.
document.body.dataset.appReady = '1';
/* ---------------------------------------------------------------- keyboard preview */

// Generate a pseudo-random but deterministic value for star effect
function starBrightness(row, col, seed) {
  const x = (row * 17 + col * 31 + seed * 7) % 100;
  return x < 15 ? 1 : (x < 25 ? 0.3 : 0); // 15% full, 10% dim, 75% off
}

// HSV to RGB helper for rainbow effects
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function renderKeyboard(effect, brightness, speed, colour, time) {
  time = time || 0;
  const preview = $('#keyboardPreview');
  if (!preview) return;
  let html = '';
  const effectIdx = Number(effect) || 0;
  const colourR = parseInt(colour.slice(1, 3), 16);
  const colourG = parseInt(colour.slice(3, 5), 16);
  const colourB = parseInt(colour.slice(5, 7), 16);
  const maxBright = Number(brightness) / 100;

  const rows = [0, 1, 2, 3, 4, 5].map((r) => KEYBOARD_LAYOUT_85.filter((k) => k.row === r));
  const totalRows = rows.length;
  const maxCols = 16;

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    html += '<div class="kb-row">';
    let currentX = 0;
    for (const key of rows[rowIdx]) {
      const colX = currentX + key.width / 2;
      currentX += key.width;

      let keyR = 0, keyG = 0, keyB = 0;
      let intensity = 0;

      if (customKeyColors[key.id] && (effectIdx === 1 || effectIdx === 2)) {
        const c = customKeyColors[key.id];
        intensity = c.light ? maxBright : 0;
        keyR = c.r;
        keyG = c.g;
        keyB = c.b;
      } else {
        switch (effectIdx) {
          case 0: // Close - all off
            intensity = 0;
            break;

          case 1: // Static - solid color at brightness
            intensity = maxBright;
            keyR = colourR;
            keyG = colourG;
            keyB = colourB;
            break;

          case 2: // Layer - dimmed color
            intensity = maxBright * 0.4;
            keyR = colourR;
            keyG = colourG;
            keyB = colourB;
            break;

          case 3: // Breath - pulsing: brightness oscillates over time
            {
              const breathPhase = (time * 0.3 * (101 - Number(speed))) % 360;
              const breathWave = (Math.sin(breathPhase * Math.PI / 180) + 1) / 2;
              intensity = maxBright * (0.2 + 0.8 * breathWave);
              keyR = colourR;
              keyG = colourG;
              keyB = colourB;
            }
            break;

          case 4: // Star - random twinkling
            {
              const sparkle = starBrightness(rowIdx, Math.floor(colX), Math.floor(Number(speed) / 10));
              intensity = maxBright * sparkle;
              keyR = colourR;
              keyG = colourG;
              keyB = colourB;
            }
            break;

          case 5: // Flow L->R - RGB rainbow wave moving left to right
            {
              const hue = ((maxCols - colX) / maxCols * 360 + Number(speed) * 3 + time * 0.2) % 360;
              const rgb = hsvToRgb(hue, 1, 1);
              keyR = rgb.r;
              keyG = rgb.g;
              keyB = rgb.b;
              intensity = maxBright;
            }
            break;

          case 6: // Flow R->L - RGB rainbow wave moving right to left
            {
              const hue = (colX / maxCols * 360 + Number(speed) * 3 + time * 0.2) % 360;
              const rgb = hsvToRgb(hue, 1, 1);
              keyR = rgb.r;
              keyG = rgb.g;
              keyB = rgb.b;
              intensity = maxBright;
            }
            break;

          case 7: // Flow Up->Dn - RGB rainbow wave moving top to bottom
            {
              const hue = (rowIdx / totalRows * 360 + Number(speed) * 3 + time * 0.2) % 360;
              const rgb = hsvToRgb(hue, 1, 1);
              keyR = rgb.r;
              keyG = rgb.g;
              keyB = rgb.b;
              intensity = maxBright;
            }
            break;

          case 8: // Flow Dn->Up - RGB rainbow wave moving bottom to top
            {
              const hue = ((totalRows - rowIdx) / totalRows * 360 + Number(speed) * 3 + time * 0.2) % 360;
              const rgb = hsvToRgb(hue, 1, 1);
              keyR = rgb.r;
              keyG = rgb.g;
              keyB = rgb.b;
              intensity = maxBright;
            }
            break;

          case 9: // Dot(Press) - ripple from center
            {
              const centerRow = 2.5;
              const centerCol = 8;
              const dist = Math.sqrt(Math.pow(rowIdx - centerRow, 2) + Math.pow((colX - centerCol) / 2.5, 2));
              const ripplePhase = (dist * 60 - Number(speed) * 10 + time * 2) % 360;
              const ripple = Math.max(0, Math.cos(ripplePhase * Math.PI / 180));
              intensity = maxBright * (0.1 + 0.9 * ripple);
              keyR = colourR;
              keyG = colourG;
              keyB = colourB;
            }
            break;

          case 10: // Cross(Press) - cross ripple from center
            {
              const centerRow = 2.5;
              const centerCol = 8;
              const dx = Math.abs(colX - centerCol) / 2.5;
              const dy = Math.abs(rowIdx - centerRow);
              const crossDist = Math.max(dx, dy);
              const ripplePhase = (crossDist * 60 - Number(speed) * 10 + time * 2) % 360;
              const ripple = Math.max(0, Math.cos(ripplePhase * Math.PI / 180));
              intensity = maxBright * (0.1 + 0.9 * ripple);
              keyR = colourR;
              keyG = colourG;
              keyB = colourB;
            }
            break;

          case 11: // Ripple(Press) - circular ripple from center
            {
              const centerRow = 2.5;
              const centerCol = 8;
              const dist = Math.sqrt(Math.pow(rowIdx - centerRow, 2) + Math.pow((colX - centerCol) / 2.5, 2));
              const ripplePhase = (dist * 45 - Number(speed) * 10 + time * 2) % 360;
              const ripple = Math.max(0, Math.cos(ripplePhase * Math.PI / 180));
              intensity = maxBright * (0.1 + 0.9 * ripple);
              keyR = colourR;
              keyG = colourG;
              keyB = colourB;
            }
            break;

          default:
            intensity = 0;
        }
      }

      const finalR = Math.round(keyR * intensity);
      const finalG = Math.round(keyG * intensity);
      const finalB = Math.round(keyB * intensity);
      const keyBg = `rgb(${finalR}, ${finalG}, ${finalB})`;
      const textColor = (finalR + finalG + finalB > 300) ? '#000' : '#fff';
      const isSel = key.id === selectedKey;

      html += `<div class="kb-key key${isSel ? ' sel' : ''}" data-key-id="${key.id}" title="${escapeHtml(key.label)} (${EFFECT_NAMES[effectIdx] || 'unknown'})" style="flex: ${key.width} 1 0px; background: ${keyBg}; color: ${textColor};">` +
        `<span class="kb-label">${escapeHtml(key.label)}</span>` +
        (key.sub ? `<span class="kb-sub">${escapeHtml(key.sub)}</span>` : '') +
      `</div>`;
    }
    html += '</div>';
  }
  preview.innerHTML = html;
}

const previewEl = $('#keyboardPreview');
if (previewEl) {
  previewEl.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.kb-key');
    if (keyEl && keyEl.dataset.keyId !== undefined) {
      setSelectedKey(Number(keyEl.dataset.keyId));
    }
  });
}

// Live-update keyboard preview when controls change
// Effect-dependent control visibility
function updateLightingControls() {
  const effect = Number($('#lMode').value) || 0;
  const brightField = $('#lBright').closest('.field');
  const speedField = $('#lSpeed').closest('.field');
  const colourRow = $('#lEffectColor').closest('.row');

  // Close (0): no controls needed
  // Static (1), Layer (2), Breath (3): brightness + colour, no speed
  // Star (4): brightness + colour + speed
  // Flow (5-8): brightness + speed, no colour (rainbow)
  // Dot/Cross/Ripple (9-11): brightness + colour + speed

  const showBright = effect !== 0;
  const showSpeed = [3, 4, 5, 6, 7, 8, 9, 10, 11].includes(effect);
  const showColour = [1, 2, 3, 4, 9, 10, 11].includes(effect);

  if (brightField) brightField.style.display = showBright ? '' : 'none';
  if (speedField) speedField.style.display = showSpeed ? '' : 'none';
  if (colourRow) colourRow.style.display = showColour ? '' : 'none';
}

$('#lMode').addEventListener('change', () => {
  const effect = $('#lMode').value || 0;
  const colour = $('#lEffectColor').value;
  renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, colour);
  updateLightingControls();
});

// Initial control visibility
updateLightingControls();
$('#lBright').addEventListener('input', () => {
  const effect = $('#lMode').value || 0;
  const colour = $('#lEffectColor').value;
  renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, colour);
  $('#lBrightOut').textContent = $('#lBright').value;
});
$('#lSpeed').addEventListener('input', () => {
  const effect = $('#lMode').value || 0;
  const colour = $('#lEffectColor').value;
  renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, colour);
  $('#lSpeedOut').textContent = $('#lSpeed').value;
});
$('#lEffectColor').addEventListener('change', () => {
  const effect = $('#lMode').value || 0;
  renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, $('#lEffectColor').value);
});

// Initial render on page load (module executes after DOM ready)
const effect = $('#lMode').value || 0;
const colour = $('#lEffectColor').value;
renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, colour);


/* ---------------------------------------------------------------- animation loop */
let animFrameId = null;
let animStartTime = Date.now();

function animateKeyboard() {
  const effect = $('#lMode').value || 0;
  const colour = $('#lEffectColor').value;
  const time = (Date.now() - animStartTime) / 10;
  renderKeyboard(effect, $('#lBright').value, $('#lSpeed').value, colour, time);
  animFrameId = requestAnimationFrame(animateKeyboard);
}

// Start animation loop
animateKeyboard();

/* ---------------------------------------------------------------- hero keyboard animation */

const HERO_EFFECTS = [5]; // Only Flow L->R for now

function renderHeroKeyboard(effect, brightness, speed, colour, time) {
  const preview = document.getElementById('heroKeyboard');
  if (!preview) return;
  let html = '';
  const effectIdx = Number(effect) || 0;
  const colourR = parseInt(colour.slice(1, 3), 16);
  const colourG = parseInt(colour.slice(3, 5), 16);
  const colourB = parseInt(colour.slice(5, 7), 16);
  const maxBright = Number(brightness) / 100;

  const rows = [0, 1, 2, 3, 4, 5].map((r) => KEYBOARD_LAYOUT_85.filter((k) => k.row === r));
  const totalRows = rows.length;
  const maxCols = 16;

  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    html += '<div class="kb-row">';
    let currentX = 0;
    for (const key of rows[rowIdx]) {
      const colX = currentX + key.width / 2;
      currentX += key.width;

      let keyR = 0, keyG = 0, keyB = 0, intensity = 0;
      switch (effectIdx) {
        case 3:
          {
            const bp = (time * 0.3 * (101 - Number(speed))) % 360;
            const bw = (Math.sin(bp * Math.PI / 180) + 1) / 2;
            intensity = maxBright * (0.2 + 0.8 * bw);
            keyR = colourR; keyG = colourG; keyB = colourB;
          }
          break;
        case 5:
        default:
          {
            const h = ((maxCols - colX) / maxCols * 360 + Number(speed) * 3 + time * 0.2) % 360;
            const rgb = hsvToRgb(h, 1, 1);
            keyR = rgb.r; keyG = rgb.g; keyB = rgb.b;
            intensity = maxBright;
          }
          break;
      }
      const fR = Math.round(keyR * intensity), fG = Math.round(keyG * intensity), fB = Math.round(keyB * intensity);
      const bg = `rgb(${fR}, ${fG}, ${fB})`;
      html += `<div class="kb-key" style="flex: ${key.width} 1 0px; background: ${bg};"></div>`;
    }
    html += '</div>';
  }
  preview.innerHTML = html;
}

let heroEffectIndex = 0;
let heroAnimStartTime = Date.now();
let heroAnimFrameId = null;

function animateHeroKeyboard() {
  const effect = 5; // Flow L->R only
  const time = (Date.now() - heroAnimStartTime) / 50; // Slower animation
  renderHeroKeyboard(effect, 100, 30, '#ff8a3d', time);
  heroAnimFrameId = requestAnimationFrame(animateHeroKeyboard);
}

function startHeroAnimation() {
  const heroKb = document.getElementById('heroKeyboard');
  if (heroKb && !heroAnimFrameId) {
    heroAnimStartTime = Date.now();
    heroEffectIndex = 0;
    animateHeroKeyboard();
  }
}

setTimeout(startHeroAnimation, 500);

// Hero connect button
const btn = $('#btnHeroConnect');
if (btn) btn.addEventListener('click', () => {
  const connectBtn = $('#btnConnect');
  if (connectBtn) connectBtn.click();
});
