import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/capture-screenshots.mjs', import.meta.url);

test('production screenshot capture requires external credentials without logging them', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.match(source, /const EMAIL = process[.]env[.]LR_EMAIL;/);
  assert.match(source, /const PASSWORD = process[.]env[.]LR_PASSWORD;/);
  assert.match(source, /https:\/\/loggerythm[.]logge[.]top/);
  assert.doesNotMatch(source, /process[.]env[.]LR_EMAIL\s*\|\|/);
  assert.doesNotMatch(source, /process[.]env[.]LR_PASSWORD\s*\|\|/);
  assert.doesNotMatch(source, /login at .*\$\{EMAIL\}/);
});
