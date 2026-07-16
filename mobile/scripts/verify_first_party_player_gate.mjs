#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_MARKERS = Object.freeze([
  '@' + 'rntp/player',
  '@' + 'rntp+player',
  'rntp_' + 'player',
  'com.' + 'doublesymmetry',
  'Track' + 'Player',
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cxx',
  '.expo',
  '.gradle',
  '.kotlin',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const SOURCE_ENTRIES = [
  'README.md',
  'android',
  'app.json',
  'index.ts',
  'modules',
  'package-lock.json',
  'package.json',
  'patches',
  'plugins',
  'src',
];

function normalizedRelative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function walkFiles(entry, files = []) {
  if (!fs.existsSync(entry)) return files;
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink()) return files;
  if (stat.isFile()) {
    files.push(entry);
    return files;
  }
  if (!stat.isDirectory() || IGNORED_DIRECTORY_NAMES.has(path.basename(entry))) return files;
  for (const child of fs.readdirSync(entry).sort()) {
    walkFiles(path.join(entry, child), files);
  }
  return files;
}

function bufferContains(buffer, marker) {
  // Android binary XML string pools may encode manifest values as UTF-8 or
  // UTF-16LE. Scan both representations so minified APKs can prove their
  // manifest-owned service marker even when R8 removes the Java/Dex spelling.
  return [Buffer.from(marker, 'utf8'), Buffer.from(marker, 'utf16le')].some(
    (encodedMarker) => buffer.indexOf(encodedMarker) !== -1,
  );
}

function markerMatches(buffer) {
  return FORBIDDEN_MARKERS.filter((marker) => bufferContains(buffer, marker));
}

export function scanSourceTree(mobileRoot) {
  const exactRoot = path.resolve(mobileRoot);
  const findings = [];
  const files = SOURCE_ENTRIES.flatMap((entry) => walkFiles(path.join(exactRoot, entry)));
  const workflow = path.resolve(exactRoot, '..', '.github', 'workflows', 'mobile-android.yml');
  if (fs.existsSync(workflow)) files.push(workflow);

  for (const file of [...new Set(files)].sort()) {
    const relative = normalizedRelative(exactRoot, file);
    for (const marker of FORBIDDEN_MARKERS) {
      if (relative.includes(marker)) findings.push(`${relative}: path contains ${marker}`);
    }
    const matches = markerMatches(fs.readFileSync(file));
    for (const marker of matches) findings.push(`${relative}: content contains ${marker}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(exactRoot, 'package.json'), 'utf8'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  if (dependencies['@loggerythm/player-native'] !== 'file:modules/loggerythm-player') {
    findings.push('package.json: first-party native player file dependency is missing or unpinned');
  }
  if (manifest.scripts?.postinstall !== undefined) {
    findings.push('package.json: postinstall must be absent after patch removal');
  }

  return { filesScanned: new Set(files).size, findings };
}

export function scanExtractedApk(extractedRoot) {
  const exactRoot = path.resolve(extractedRoot);
  const findings = [];
  const files = walkFiles(exactRoot);
  let hasOwnedService = false;
  let hasMedia3ServiceAction = false;

  for (const file of files) {
    const relative = normalizedRelative(exactRoot, file);
    const nameMatches = FORBIDDEN_MARKERS.filter((marker) => relative.includes(marker));
    for (const marker of nameMatches) findings.push(`${relative}: path contains ${marker}`);
    const buffer = fs.readFileSync(file);
    for (const marker of markerMatches(buffer)) {
      findings.push(`${relative}: content contains ${marker}`);
    }
    hasOwnedService ||= bufferContains(
      buffer,
      'top.logge.loggerythm.player.LoggeRythmMediaLibraryService',
    );
    hasMedia3ServiceAction ||= bufferContains(buffer, 'androidx.media3.session.MediaLibraryService');
  }

  if (!hasOwnedService) findings.push('APK: first-party MediaLibraryService marker is missing');
  if (!hasMedia3ServiceAction) findings.push('APK: Media3 service action marker is missing');
  return { filesScanned: files.length, findings };
}

export function scanApk(apkPath) {
  const exactApk = path.resolve(apkPath);
  if (!fs.statSync(exactApk).isFile()) throw new Error(`APK is not a file: ${exactApk}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'loggerythm-player-gate-'));
  try {
    // Android resource packaging can legally contain duplicate ZIP names.
    // Overwrite deterministically instead of allowing unzip to prompt in CI.
    execFileSync('unzip', ['-o', '-qq', exactApk, '-d', temporary], { stdio: 'pipe' });
    return scanExtractedApk(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  let mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let apkPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source-root') mobileRoot = path.resolve(argv[++index]);
    else if (argument === '--apk') apkPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { mobileRoot, apkPath };
}

function main() {
  const { mobileRoot, apkPath } = parseArguments(process.argv.slice(2));
  const source = scanSourceTree(mobileRoot);
  const apk = apkPath === undefined ? null : scanApk(apkPath);
  const findings = [...source.findings, ...(apk?.findings ?? [])];
  const result = {
    status: findings.length === 0 ? 'passed' : 'failed',
    sourceFilesScanned: source.filesScanned,
    apkFilesScanned: apk?.filesScanned ?? 0,
    findings,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (findings.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) main();

export { FORBIDDEN_MARKERS };
