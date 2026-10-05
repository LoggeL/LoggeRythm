import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

const mobileDirectory = fileURLToPath(new URL('../', import.meta.url));
const auditScript = fileURLToPath(new URL('./verify_npm_audit.mjs', import.meta.url));

const cleanReport = () => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { total: 0 } },
});

const advisory = () => ({
  source: 1234567,
  name: 'unsafe-library',
  dependency: 'unsafe-library',
  title: 'Unsafe input can execute arbitrary code',
  url: 'https://github.com/advisories/GHSA-test-1234-5678',
  severity: 'high',
  range: '<2.0.0',
});

const vulnerableReport = (via = [advisory()]) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    'unsafe-library': {
      name: 'unsafe-library',
      severity: 'high',
      isDirect: true,
      via,
      effects: [],
      range: '<2.0.0',
      nodes: ['node_modules/unsafe-library'],
      fixAvailable: true,
    },
  },
  metadata: { vulnerabilities: { high: 1, total: 1 } },
});

function runAudit(report, { exitCode = 0, stderr = '', rawOutput } = {}) {
  const mockDirectory = mkdtempSync(path.join(tmpdir(), 'loggerythm-audit-test-'));
  try {
    // The executable ahead of npm on PATH prevents all real registry requests.
    writeFileSync(
      path.join(mockDirectory, 'npm'),
      `#!${process.execPath}\n` +
        "const assert = require('node:assert/strict');\n" +
        "assert.deepEqual(process.argv.slice(2), ['audit', '--omit=dev', '--json']);\n" +
        'process.stdout.write(process.env.AUDIT_TEST_STDOUT);\n' +
        'process.stderr.write(process.env.AUDIT_TEST_STDERR);\n' +
        'process.exit(Number(process.env.AUDIT_TEST_EXIT));\n',
      { mode: 0o700 },
    );
    const result = spawnSync(process.execPath, [auditScript], {
      cwd: mobileDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${mockDirectory}${path.delimiter}${process.env.PATH}`,
        AUDIT_TEST_STDOUT: rawOutput === undefined ? JSON.stringify(report) : rawOutput,
        AUDIT_TEST_STDERR: stderr,
        AUDIT_TEST_EXIT: String(exitCode),
      },
      timeout: 10_000,
    });
    assert.equal(result.error, undefined, 'Audit subprocess must finish without a spawn error');
    assert.equal(result.signal, null, 'Audit subprocess must exit without a signal');
    return result;
  } finally {
    rmSync(mockDirectory, { recursive: true, force: true });
  }
}

function assertFailure(result, messagePattern) {
  assert.notEqual(result.status, 0, 'Malformed reports must never pass the audit gate');
  assert.match(result.stderr, messagePattern);
  assert.doesNotMatch(result.stdout, /found no moderate\+/);
}

test('a valid clean npm audit report passes', () => {
  const result = runAudit(cleanReport());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /found no moderate\+ advisories/);
});

test('a real high advisory fails and identifies the package, advisory, severity, and URL', () => {
  const result = runAudit(vulnerableReport(), { exitCode: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GHSA-test-1234-5678 \(high\) unsafe-library/);
  assert.match(result.stderr, /Unsafe input can execute arbitrary code/);
  assert.match(result.stderr, /https:\/\/github\.com\/advisories\/GHSA-test-1234-5678/);
});

test('valid low severity advisories remain below the moderate audit threshold', () => {
  const lowAdvisory = { ...advisory(), severity: 'low' };
  const result = runAudit(vulnerableReport([lowAdvisory]), { exitCode: 1 });
  assert.equal(result.status, 0, result.stderr);
});

for (const [label, report] of [
  ['null report', null],
  ['array report', []],
  ['missing report version', { vulnerabilities: {} }],
  ['old report version', { ...cleanReport(), auditReportVersion: 1 }],
  ['string report version', { ...cleanReport(), auditReportVersion: '2' }],
  ['missing vulnerabilities', { auditReportVersion: 2 }],
  ['null vulnerabilities', { ...cleanReport(), vulnerabilities: null }],
  ['array vulnerabilities', { ...cleanReport(), vulnerabilities: [] }],
  ['string vulnerabilities', { ...cleanReport(), vulnerabilities: 'clean' }],
]) {
  test(`${label} fails with report context`, () => {
    assertFailure(runAudit(report), /npm audit.*report|report.*npm audit/i);
  });
}

for (const [label, vulnerability] of [
  ['null vulnerability', null],
  ['array vulnerability', []],
  ['string vulnerability', 'unsafe-library'],
  ['missing name', { via: [] }],
  ['empty name', { name: '', via: [] }],
  ['whitespace name', { name: ' ', via: [] }],
  ['non-string name', { name: 123, via: [] }],
  ['mismatched name', { name: 'other-library', via: [advisory()] }],
  ['missing via', { name: 'unsafe-library' }],
  ['empty via', { name: 'unsafe-library', via: [] }],
  ['null via', { name: 'unsafe-library', via: null }],
  ['object via', { name: 'unsafe-library', via: {} }],
  ['string via', { name: 'unsafe-library', via: 'unsafe-library' }],
]) {
  test(`${label} fails with vulnerability context`, () => {
    const report = { ...cleanReport(), vulnerabilities: { 'unsafe-library': vulnerability } };
    assertFailure(runAudit(report), /unsafe-library|vulnerabilit/i);
  });
}

for (const [label, via] of [
  ['null via entry', null],
  ['array via entry', []],
  ['numeric via entry', 42],
  ['boolean via entry', false],
  ['empty transitive pointer', ''],
  ['whitespace transitive pointer', ' '],
]) {
  test(`${label} fails with advisory context`, () => {
    assertFailure(runAudit(vulnerableReport([via])), /unsafe-library|advisory|via/i);
  });
}

for (const field of ['name', 'title', 'severity', 'url']) {
  for (const [label, value] of [
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', ' '],
    ['non-string', 123],
  ]) {
    test(`${label} direct advisory ${field} fails with field context`, () => {
      const via = { ...advisory(), [field]: value };
      assertFailure(runAudit(vulnerableReport([via])), /invalid advisory for unsafe-library/i);
    });
  }
}

test('unknown severity cannot silently bypass the moderate audit threshold', () => {
  const via = { ...advisory(), severity: 'severe' };
  assertFailure(runAudit(vulnerableReport([via])), /invalid advisory for unsafe-library/i);
});

test('network errors returned in the npm JSON report fail loudly', () => {
  const result = runAudit(
    { error: { code: 'ENETUNREACH', summary: 'Registry connection failed' } },
    { exitCode: 1 },
  );
  assertFailure(result, /npm audit failed.*ENETUNREACH/);
});

test('npm command errors without a report preserve failure context', () => {
  const result = runAudit(null, {
    exitCode: 2,
    rawOutput: '',
    stderr: 'npm error Registry connection failed\n',
  });
  assertFailure(result, /npm audit.*report|npm audit failed/i);
});

test('invalid npm JSON output fails loudly', () => {
  const result = runAudit(null, { exitCode: 1, rawOutput: 'Registry connection failed' });
  assertFailure(result, /npm audit.*JSON|npm audit.*report/i);
});

test('an unexpected npm exit code cannot pass with a clean JSON report', () => {
  assertFailure(runAudit(cleanReport(), { exitCode: 2 }), /npm audit.*(?:exit|status|failed)/i);
});


test('transitive advisory pointers must reference an existing vulnerability', () => {
  assertFailure(runAudit(vulnerableReport(['missing-library'])), /unresolved vulnerability pointer.*missing-library/i);
});

test('transitive advisory pointers still report the original high advisory', () => {
  const report = vulnerableReport();
  report.vulnerabilities['dependent-library'] = {
    name: 'dependent-library',
    via: ['unsafe-library'],
  };
  const result = runAudit(report, { exitCode: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GHSA-test-1234-5678/);
});

test('npm vulnerability exit code without vulnerability data cannot pass', () => {
  assertFailure(runAudit(cleanReport(), { exitCode: 1 }), /npm audit failed.*reported no vulnerabilities/i);
});

test('cyclic vulnerability pointers without a direct root advisory cannot pass', () => {
  const report = {
    ...cleanReport(),
    vulnerabilities: {
      a: { name: 'a', via: ['b'] },
      b: { name: 'b', via: ['a'] },
    },
  };
  assertFailure(runAudit(report, { exitCode: 1 }), /without any root advisory/i);
});
