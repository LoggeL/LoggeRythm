import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { writeNotificationIcon } = require('./withNotificationIcon');

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loggerythm-notification-icon-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('withNotificationIcon', () => {
  it('writes the generated logo icon and points Media3 at it', () => {
    const res = temporaryRoot();
    writeNotificationIcon(MOBILE_ROOT, res);

    expect(fs.readFileSync(path.join(res, 'drawable', 'ic_stat_music.xml'), 'utf8')).toBe(
      fs.readFileSync(path.join(MOBILE_ROOT, 'plugins', 'brand', 'ic_stat_music.xml'), 'utf8'),
    );
    expect(fs.readFileSync(path.join(res, 'values', 'media3_notification_icon.xml'), 'utf8')).toContain(
      '<drawable name="media3_notification_small_icon">@drawable/ic_stat_music</drawable>',
    );
  });

  it('fails loudly when the generated icon is missing', () => {
    expect(() => writeNotificationIcon(temporaryRoot(), temporaryRoot())).toThrow(
      /Notification icon is missing: .*ic_stat_music\.xml\. Run npm run generate:brand-assets/,
    );
  });
});
