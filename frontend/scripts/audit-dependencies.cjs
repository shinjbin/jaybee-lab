const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Only trusted, repository-owned globs reach Vite during the static-site build.
// nginx serves dist/ and never ships this dependency. Revisit when a fix ships.
const EXCEPTION = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = Date.parse('2026-12-02T00:00:00Z');

function evaluate(report, lock, now = Date.now()) {
  if (report.auditReportVersion !== 2 || report.error || !report.vulnerabilities || !lock.packages) {
    throw new Error('Unrecognized or unsuccessful npm audit report');
  }
  const findings = report.vulnerabilities;
  const memo = new Map();
  function permitted(name, visiting = new Set()) {
    if (memo.has(name)) return memo.get(name);
    const finding = findings[name];
    if (!finding || visiting.has(name)) return false;
    const next = new Set(visiting).add(name);
    const devOnly = finding.nodes?.length > 0 && finding.nodes.every(node => lock.packages[node]?.dev === true);
    const knownOnly = finding.via?.length > 0 && finding.via.every(via =>
      typeof via === 'string' ? permitted(via, next) :
        name === 'picomatch' && via.name === 'picomatch' && via.url === EXCEPTION
    );
    const allowed = now < EXPIRES && devOnly && knownOnly;
    memo.set(name, allowed);
    return allowed;
  }
  const blocked = Object.keys(findings).filter(name => !permitted(name));
  return { blocked, excepted: Object.keys(findings).filter(name => permitted(name)) };
}

function main() {
  const cwd = path.resolve(__dirname, '..');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('npm audit could not complete');
  const report = JSON.parse(result.stdout);
  if (result.status === 1 && Object.keys(report.vulnerabilities || {}).length === 0) {
    throw new Error('npm audit failed without a vulnerability report');
  }
  const lock = JSON.parse(readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));
  const { blocked, excepted } = evaluate(report, lock);
  if (excepted.length) console.warn(`Temporary dev-only exception until 2026-12-02: ${EXCEPTION} (${excepted.join(', ')})`);
  if (blocked.length) {
    console.error(JSON.stringify(report, null, 2));
    throw new Error(`Security audit blocked: ${blocked.join(', ')}`);
  }
  console.log('Dependency audit passed; all findings were checked.');
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { evaluate };
