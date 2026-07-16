import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const xcodeRequire = createRequire(require.resolve('xcode/package.json'));
const uuid = xcodeRequire('uuid');
const uuidPackage = xcodeRequire('uuid/package.json');

if (uuidPackage.version !== '11.1.1') {
  throw new Error(`xcode must resolve the reviewed uuid 11.1.1 override, got ${uuidPackage.version}`);
}
if (typeof uuid.v4 !== 'function') {
  throw new Error('The reviewed uuid override is not CommonJS-compatible with xcode');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.v4())) {
  throw new Error('The reviewed uuid override did not produce a valid v4 identifier');
}

console.log(`Verified xcode build-time uuid override ${uuidPackage.version}`);
