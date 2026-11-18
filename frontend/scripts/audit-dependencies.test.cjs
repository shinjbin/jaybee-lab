const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./audit-dependencies.cjs');
const now = Date.parse('2026-11-18T00:00:00Z');
function fixture() {
  return {
    report: { auditReportVersion: 2, vulnerabilities: {
      picomatch: { nodes: ['node_modules/picomatch'], via: [{ name: 'picomatch', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] },
      vite: { nodes: ['node_modules/vite'], via: ['picomatch'] }
    } },
    lock: { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/vite': { dev: true } } }
  };
}
test('allows only the documented development dependency chain before expiry', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluate(report, lock, now).blocked, []);
});
test('blocks the same advisory if it enters runtime dependencies', () => {
  const { report, lock } = fixture();
  lock.packages['node_modules/picomatch'].dev = false;
  assert.deepEqual(evaluate(report, lock, now).blocked, ['picomatch', 'vite']);
});
test('blocks an unrelated advisory even on the same package', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.via.push({ name: 'picomatch', url: 'https://github.com/advisories/OTHER' });
  assert.deepEqual(evaluate(report, lock, now).blocked, ['picomatch', 'vite']);
});
test('blocks findings at the exception expiry', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluate(report, lock, Date.parse('2026-12-02T00:00:00Z')).blocked, ['picomatch', 'vite']);
});
test('blocks missing lockfile entries, unresolved chains and cycles', () => {
  const { report, lock } = fixture();
  delete lock.packages['node_modules/picomatch'];
  assert.equal(evaluate(report, lock, now).blocked.length, 2);
  report.vulnerabilities.picomatch.via = ['vite'];
  assert.equal(evaluate(report, lock, now).blocked.length, 2);
  report.vulnerabilities.picomatch.via = ['missing'];
  assert.equal(evaluate(report, lock, now).blocked.length, 2);
});
test('rejects error reports and accepts a clean report', () => {
  const { report, lock } = fixture();
  assert.throws(() => evaluate({ ...report, error: {} }, lock, now));
  assert.throws(() => evaluate({}, lock, now));
  assert.deepEqual(evaluate({ auditReportVersion: 2, vulnerabilities: {} }, lock, now).blocked, []);
});
