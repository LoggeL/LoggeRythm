import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const xcodePackage = require('xcode/package.json');
const xcode = require('xcode');

// Expo 57.0.31 uses xcode 4, which removed uuid in favor of node:crypto.
// Keep checking the actual prebuild dependency instead of pinning a package
// that is no longer part of the dependency graph.
if (!xcodePackage.version.startsWith('4.') || xcodePackage.dependencies?.uuid !== undefined) {
  throw new Error(`Expected reviewed xcode 4 without the legacy uuid dependency, got ${xcodePackage.version}`);
}
const project = xcode.project('dependency-check.pbxproj');
project.hash = { project: { objects: {} } };
const first = project.generateUuid();
const second = project.generateUuid();
if (!/^[A-F0-9]{24}$/.test(first) || !/^[A-F0-9]{24}$/.test(second) || first === second) {
  throw new Error('xcode could not generate distinct valid project identifiers');
}

console.log(`Verified xcode ${xcodePackage.version} native crypto identifier generation`);
