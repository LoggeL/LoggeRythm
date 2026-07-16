import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifyAndroidLauncherAssets } = require('../plugins/withAndroidLauncherAssets');

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), '..');
const resourceRoot = path.join(mobileRoot, 'android', 'app', 'src', 'main', 'res');

try {
  verifyAndroidLauncherAssets(resourceRoot);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
