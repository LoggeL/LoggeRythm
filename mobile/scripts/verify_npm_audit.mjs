// Fail-loud replacement for the raw `npm audit --omit=dev --audit-level=moderate`
// CI gate. `npm audit` cannot exclude individual advisories, and advisories
// without ANY patched release would block every build forever. This script
// fails on every moderate+ advisory in production dependency paths except the
// explicitly reviewed ones below.
//
// Rules for the allowlist: only advisories with no patched version in any
// release (first_patched_version: null on GitHub), each with a written
// rationale. Remove entries as soon as upstream ships a fix — `npm audit fix`
// or a bumped override then resolves them and the stale entry is reported.
import { execFileSync } from 'node:child_process';

const ALLOWLISTED_ADVISORIES = new Map();

const FAIL_SEVERITIES = new Set(['moderate', 'high', 'critical']);

let stdout;
try {
  stdout = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  // npm audit exits non-zero when vulnerabilities exist but still prints the
  // JSON report; anything without parseable output is a real npm failure.
  stdout = error.stdout;
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new Error(`npm audit did not produce a report: ${error.message}`);
  }
}

const report = JSON.parse(stdout);
if (report.error) {
  throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
}

const offending = new Map();
const seenAllowlisted = new Set();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== 'object') continue; // transitive pointer, root is reported elsewhere
    const advisoryId = via.url?.split('/').at(-1) ?? '';
    if (ALLOWLISTED_ADVISORIES.has(advisoryId)) {
      if (ALLOWLISTED_ADVISORIES.get(advisoryId) !== via.name) {
        throw new Error(
          `Allowlisted advisory ${advisoryId} was reviewed for ` +
            `${ALLOWLISTED_ADVISORIES.get(advisoryId)} but now flags ${via.name}; re-review it`,
        );
      }
      seenAllowlisted.add(advisoryId);
      continue;
    }
    if (!FAIL_SEVERITIES.has(via.severity)) continue;
    offending.set(`${advisoryId} (${via.severity}) ${via.name}: ${via.title}`, via.url);
  }
}

const stale = [...ALLOWLISTED_ADVISORIES.keys()].filter((id) => !seenAllowlisted.has(id));
if (stale.length > 0) {
  throw new Error(
    `Stale audit allowlist entries (advisory no longer reported — upstream fixed it, ` +
      `remove the entry): ${stale.join(', ')}`,
  );
}

if (offending.size > 0) {
  console.error('npm audit found non-allowlisted moderate+ advisories in production paths:');
  for (const [line, url] of offending) console.error(`  - ${line} (${url})`);
  process.exit(1);
}

if (seenAllowlisted.size === 0) {
  console.log('npm audit found no moderate+ advisories in production dependency paths');
} else {
  console.log(
    `npm audit clean apart from ${seenAllowlisted.size} reviewed unfixable advisories ` +
      `(${[...seenAllowlisted].join(', ')})`,
  );
}
