#!/usr/bin/env bash
# Run the full test suite: Node protocol checks plus real-browser checks.
#
# The browser checks are not optional extras. `node --check` only proves the
# modules parse; it cannot catch a renamed element id, a button whose handler
# was deleted, or an effect dropdown offering an effect the device rejects.
# Those were all real defects found by running this.
#
#   ./test/run-all.sh
#
# Requires: node, and a Chromium-based browser. Override the browser with
#   BROWSER=/path/to/chrome ./test/run-all.sh

set -uo pipefail
cd "$(dirname "$0")/.."

BROWSER="${BROWSER:-}"
if [ -z "$BROWSER" ]; then
  for c in brave google-chrome chromium chromium-browser chrome; do
    if command -v "$c" >/dev/null 2>&1; then BROWSER="$(command -v "$c")"; break; fi
  done
fi

rc=0

echo "== node: protocol self-checks =="
if node test/protocol.test.mjs; then
  echo "   node suite OK"
else
  echo "   node suite FAILED"; rc=1
fi

echo
echo "== node: driver self-checks =="
if node test/driver.test.mjs; then
  echo "   driver suite OK"
else
  echo "   driver suite FAILED"; rc=1
fi

echo
echo "== node: syntax check every module =="
for f in js/*.js; do
  if node --check "$f"; then echo "   ok $f"; else echo "   FAIL $f"; rc=1; fi
done

if [ -z "$BROWSER" ]; then
  echo
  echo "== browser: SKIPPED - no Chromium-based browser found =="
  echo "   install one or set BROWSER=/path/to/chrome"
  exit $rc
fi

echo
echo "== browser: $BROWSER =="
PORT="${PORT:-8765}"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/apex-http.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1.5

for suite in browser-smoke dom-wiring; do
  out="/tmp/apex-$suite.html"
  timeout 90 "$BROWSER" --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --virtual-time-budget=20000 --dump-dom "http://127.0.0.1:$PORT/test/$suite.html" \
    >"$out" 2>/dev/null
  title=$(grep -o '<title>[^<]*</title>' "$out" | head -1)
  echo "   $suite: $title"
  case "$title" in
    *PASS*) ;;
    *) rc=1 ;;
  esac
  if grep -q '^FAIL' <(python3 - "$out" <<'PY'
import re,sys,html
s=open(sys.argv[1]).read()
for pre in ('out','result'):
    m=re.search(r'<pre id="'+pre+r'">(.*?)</pre>', s, re.S)
    if m: print(html.unescape(m.group(1)))
PY
  ); then
    python3 - "$out" <<'PY'
import re,sys,html
s=open(sys.argv[1]).read()
for pre in ('out','result'):
    m=re.search(r'<pre id="'+pre+r'">(.*?)</pre>', s, re.S)
    if m:
        for l in html.unescape(m.group(1)).split('\n'):
            if l.startswith('FAIL'): print("     " + l)
PY
  fi
done

echo
[ $rc -eq 0 ] && echo "ALL SUITES PASS" || echo "SOME SUITES FAILED"
exit $rc