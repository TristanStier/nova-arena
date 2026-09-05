#!/usr/bin/env node
/* NOVA ARENA build script.
 * Concatenates src/00_shell.html + every src/NN_*.js (sorted by filename)
 * into one self-contained d:/!games/nova-arena.html.
 *
 * The shell must contain the token  <!--NA_SCRIPT-->  just before </body>;
 * if it is missing we inject before the closing </body> tag instead.
 *
 * Usage: node tools/build.js [--quiet]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'nova-arena.html');
const quiet = process.argv.includes('--quiet');

function log(...a) { if (!quiet) console.log(...a); }

if (!fs.existsSync(SRC)) { console.error('no src/ directory at ' + SRC); process.exit(1); }

const shellPath = path.join(SRC, '00_shell.html');
if (!fs.existsSync(shellPath)) { console.error('missing src/00_shell.html'); process.exit(1); }
const shell = fs.readFileSync(shellPath, 'utf8');

// Sort by the numeric prefix first (so 9_foo.js < 10_bar.js and 13b < 13c < 14),
// then by the alpha suffix, then by the rest of the name.
function sortKey(f) {
  const m = /^(\d+)([a-z]*)/i.exec(f);
  return m ? [parseInt(m[1], 10), m[2].toLowerCase(), f] : [1e9, '', f];
}
const jsFiles = fs.readdirSync(SRC)
  .filter(f => f.toLowerCase().endsWith('.js'))
  .sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  });

if (!jsFiles.length) { console.error('no .js files in src/'); process.exit(1); }

const parts = [];
const report = [];
let totalJs = 0;
let errors = 0;

for (const f of jsFiles) {
  const p = path.join(SRC, f);
  let code = fs.readFileSync(p, 'utf8');
  // Syntax-check before it can poison the single concatenated <script>.
  try {
    new vm.Script(code, { filename: p });
  } catch (err) {
    errors++;
    const where = (err && err.stack ? String(err.stack).split('\n').slice(0, 3).join('\n') : String(err));
    console.error('SYNTAX ERROR in ' + f + ':\n' + where);
    continue;
  }
  // A stray </script> inside a string would end the inlined script tag early.
  if (/<\/script/i.test(code)) {
    code = code.replace(/<\/script/gi, '<\\/script');
    log('  note: escaped a literal </script in ' + f);
  }
  const lines = code.split('\n').length;
  const bytes = Buffer.byteLength(code, 'utf8');
  totalJs += bytes;
  report.push({ file: f, lines, bytes });
  parts.push('/* ===== ' + f + ' ===== */\n' + code.replace(/\s+$/, '') + '\n');
}

const script = '<script>\n"use strict";\n' + parts.join('\n') + '\n</script>\n';

let html;
if (shell.includes('<!--NA_SCRIPT-->')) {
  html = shell.replace('<!--NA_SCRIPT-->', script);
} else if (/<\/body>/i.test(shell)) {
  html = shell.replace(/<\/body>/i, script + '</body>');
} else {
  html = shell + script;
}

if (errors) {
  console.error('\nbuild FAILED: ' + errors + ' file(s) with syntax errors; ' + OUT + ' left untouched.');
  process.exit(1);
}

fs.writeFileSync(OUT, html, 'utf8');

// ---- size report -------------------------------------------------------
const shellBytes = Buffer.byteLength(shell, 'utf8');
const outBytes = Buffer.byteLength(html, 'utf8');
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

let txt = 'NOVA ARENA build report  ' + new Date().toISOString() + '\n';
txt += pad('file', 24) + rpad('lines', 8) + rpad('bytes', 10) + rpad('KiB', 9) + '\n';
txt += '-'.repeat(51) + '\n';
txt += pad('00_shell.html', 24) + rpad(shell.split('\n').length, 8) + rpad(shellBytes, 10) + rpad((shellBytes / 1024).toFixed(1), 9) + '\n';
for (const r of report) {
  txt += pad(r.file, 24) + rpad(r.lines, 8) + rpad(r.bytes, 10) + rpad((r.bytes / 1024).toFixed(1), 9) + '\n';
}
txt += '-'.repeat(51) + '\n';
txt += pad('TOTAL js', 24) + rpad(report.reduce((a, r) => a + r.lines, 0), 8) + rpad(totalJs, 10) + rpad((totalJs / 1024).toFixed(1), 9) + '\n';
txt += pad('nova-arena.html', 24) + rpad(html.split('\n').length, 8) + rpad(outBytes, 10) + rpad((outBytes / 1024).toFixed(1), 9) + '\n';

fs.mkdirSync(path.join(ROOT, 'tools', 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools', 'out', 'size-report.txt'), txt, 'utf8');
log(txt);
log('wrote ' + OUT + '  (' + (outBytes / 1024).toFixed(1) + ' KiB)');
process.exit(errors ? 1 : 0);
