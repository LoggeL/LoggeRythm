import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withOfflineDownloads');

describe('withOfflineDownloads native source contract', () => {
  it('registers one first-party package idempotently', () => {
    const application = 'PackageList(this).packages.apply {\n        }';
    const transformed = plugin.transformMainApplication(application);
    expect(transformed).toContain('// @generated withOfflineDownloads package');
    expect(transformed).toContain('add(OfflineDownloadsPackage())');
    expect(plugin.transformMainApplication(transformed)).toBe(transformed);
  });

  it('generates package-correct Kotlin without a second cache or logging secrets', () => {
    const sources = Object.values(plugin.kotlinSources('top.logge.loggerythm')).join('\n');
    expect(sources).not.toContain('__PACKAGE__');
    expect(sources).toContain('package top.logge.loggerythm');
    expect(sources).toContain('context.noBackupFilesDir');
    expect(sources).toContain('AES/GCM/NoPadding');
    expect(sources).toContain('AndroidKeyStore');
    expect(sources).toContain('AtomicFile(manifestFile(scope))');
    expect(sources).toContain('cipher.updateAAD(scope.value');
    expect(sources).toContain('SECRET_KEYS');
    expect(sources).not.toContain('SimpleCache');
    expect(sources).not.toContain('LeastRecentlyUsedCacheEvictor');
    expect(sources).not.toContain('Log.');
  });

  it('serializes playlist jobs and commits only verified canonical stream responses', () => {
    const sources = Object.values(plugin.kotlinSources('top.logge.loggerythm')).join('\n');
    expect(sources).toContain('Executors.newSingleThreadExecutor');
    expect(sources).toContain('activeJob.compareAndSet(null, job)');
    expect(sources).toContain('target.encodedPath == "/api/tracks/$trackId/stream"');
    expect(sources).toContain('target.scheme == origin.scheme');
    expect(sources).toContain('value.fileName == "$trackId.mp3"');
    expect(sources).toContain('Regex("sf_session=');
    expect(sources).toContain('.header("Accept-Encoding", "identity")');
    expect(sources).toContain('.followRedirects(false)');
    expect(sources).toContain('mediaType != "audio/mpeg"');
    expect(sources).toContain('written != expectedSize');
    expect(sources).toContain('looksLikeMp3(partialFile)');
    expect(sources).toContain('verifiedExistingFile(scope, request.trackId)');
    expect(sources).toContain('initialStat.st_size == expectedSize');
    expect(sources).toContain('expectedSizes[file.name]');
    expect(sources).toContain('size != expectedSize || size <= 0L || !looksLikeMp3(file)');
    expect(sources).toContain('Os.rename(partialFile.absolutePath, finalFile.absolutePath)');
    expect(sources.indexOf('output.fd.sync()')).toBeLessThan(sources.indexOf('Os.rename('));
    expect(sources).toContain('"$trackId.mp3.part"');
  });

  it('exposes only structured failures and exact-scope cleanup commands', () => {
    const generated = plugin.kotlinSources('top.logge.loggerythm');
    const sources = Object.values(generated).join('\n');
    const coordinator = generated['OfflineDownloadCoordinator.kt'];
    const enqueue = coordinator.slice(
      coordinator.indexOf('private fun <T> enqueueScopeOperation('),
      coordinator.indexOf('private fun admitLocked(', coordinator.indexOf('private fun <T> enqueueScopeOperation(')),
    );
    expect(sources).toContain('fun hydrate(scope: String, promise: Promise)');
    expect(sources).toContain('fun persistManifest(scope: String, generation: Double, manifestJson: String, promise: Promise)');
    expect(sources).toContain('fun startPlaylistDownload(');
    expect(sources).toContain('fun removeFiles(scope: String, generation: Double, fileNames: ReadableArray, promise: Promise)');
    expect(sources).toContain('fun clearScope(scope: String, promise: Promise)');
    expect(sources).toContain('fun clearAllScopes(promise: Promise)');
    expect(sources).toContain('generationCounter(scope.value).incrementAndGet()');
    expect(sources).toContain('val admission = admitLocked(scope.value, expectedGeneration)');
    expect(sources).toContain('requireAdmission(admission)');
    expect(sources).toContain('OfflineModuleException("offline-generation-stale"');
    expect(sources).toContain('current?.cancel()');
    expect(sources.indexOf('generationCounter(scope.value).incrementAndGet()')).toBeLessThan(
      sources.indexOf('current?.cancel()'),
    );
    expect(enqueue.indexOf('requireAdmission(admission)')).toBeLessThan(enqueue.indexOf('operation(admission)'));
    expect(sources).toContain('clearingScopes.contains(scope)');
    expect(sources).toContain('promise.reject(code, "Offline operation failed: $code")');
    expect(sources).not.toContain('promise.reject(code, error');
  });

  it('fails closed while globally deleting every scope and invalidates stale work', () => {
    const generated = plugin.kotlinSources('top.logge.loggerythm');
    const coordinator = generated['OfflineDownloadCoordinator.kt'];
    const storage = generated['OfflineDownloadStorage.kt'];
    const module = generated['OfflineDownloadsModule.kt'];
    const clearAll = coordinator.slice(
      coordinator.indexOf('fun clearAllScopes(callback:'),
      coordinator.indexOf('fun downloadPlaylist(', coordinator.indexOf('fun clearAllScopes(callback:')),
    );

    expect(module).toContain('@ReactMethod\n  fun clearAllScopes(promise: Promise)');
    expect(module).toContain('putDouble("cleanupGeneration", cleanupGeneration.toDouble())');
    expect(module).toContain('putBoolean("cleared", true)');
    expect(clearAll).toContain('allScopesCleanupCallbacks += callback');
    expect(clearAll).toContain('if (allScopesCleanupScheduled) return');
    expect(clearAll).toContain('allScopesClearing.set(true)');
    expect(clearAll).toContain('activeJob.get()?.cancel()');
    expect(clearAll).toContain('globalCleanupGeneration.incrementAndGet()');
    expect(clearAll).toContain('generations.values.forEach { counter -> counter.incrementAndGet() }');
    expect(clearAll).toContain('storage.clearAllScopes()');
    expect(clearAll.indexOf('activeJob.get()?.cancel()')).toBeLessThan(
      clearAll.indexOf('storage.clearAllScopes()'),
    );
    expect(clearAll.indexOf('globalCleanupGeneration.incrementAndGet()')).toBeLessThan(
      clearAll.indexOf('storage.clearAllScopes()'),
    );
    expect(clearAll).toContain('if (result.isSuccess)');
    expect(clearAll).toContain('allScopesClearing.set(false)');
    expect(coordinator).toContain('throw OfflineModuleException("offline-all-scopes-clearing", true)');
    expect(coordinator).toContain('AtomicLong(globalCleanupGeneration.get())');
    expect(coordinator).toContain('Admission and executor enqueue deliberately share stateLock');

    expect(storage).toContain('fun clearAllScopes()');
    expect(storage).toContain('val safeRoot = existingStoreRootOrNull() ?: return');
    expect(storage).toContain('deleteTree(safeRoot, safeContainer, safeRoot)');
    expect(storage).toContain('check(existingSafeDirectory(File(safeContainer, "v1"), safeContainer) == null)');
    expect(storage).toContain('clearAll remains failed and');
    expect(storage).not.toContain('if (isSymbolicLink(file))');
  });

  it('rejects links at every storage boundary before canonical reads, writes, or deletes', () => {
    const storage = plugin.kotlinSources('top.logge.loggerythm')['OfflineDownloadStorage.kt'];
    const noBackup = storage.slice(
      storage.indexOf('private fun requireNoBackupBoundary()'),
      storage.indexOf('private fun ensureSafeDirectory(', storage.indexOf('private fun requireNoBackupBoundary()')),
    );
    const directoryValidation = storage.slice(
      storage.indexOf('private fun validateExistingDirectory('),
      storage.indexOf('private fun requireSafeRegularFileSlot(', storage.indexOf('private fun validateExistingDirectory(')),
    );
    const fileValidation = storage.slice(
      storage.indexOf('private fun requireSafeRegularFileSlot('),
      storage.indexOf('private fun deleteSafeRegularFile(', storage.indexOf('private fun requireSafeRegularFileSlot(')),
    );
    const treeValidation = storage.slice(
      storage.indexOf('private fun requireSafeTreeEntry('),
      storage.indexOf('private fun requireLexicalDirectChild(', storage.indexOf('private fun requireSafeTreeEntry(')),
    );
    const treeDelete = storage.slice(
      storage.indexOf('private fun deleteTree('),
      storage.indexOf('private fun requireSafeTreeEntry(', storage.indexOf('private fun deleteTree(')),
    );

    expect(storage).toContain('Os.lstat(file.absolutePath)');
    expect(storage).toContain('check(!OsConstants.S_ISLNK(stat.st_mode))');
    expect(storage).toContain('OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW');
    expect(storage).toContain(
      'ensureSafeDirectory(File(boundary, storeContainer.name), boundary)',
    );
    expect(storage).toContain(
      'existingSafeDirectory(File(boundary, storeContainer.name), boundary)',
    );
    expect(storage).toContain('ensureSafeDirectory(File(container, root.name), container)');
    expect(storage).toContain('ensureSafeDirectory(File(scopes, scope.digest), scopes)');
    expect(storage).toContain('ensureSafeDirectory(File(scopeDirectory, "audio"), scopeDirectory)');
    expect(storage).toContain('requireSafeRegularFileSlot(File(file.path + ATOMIC_BACKUP_SUFFIX), directory)');
    expect(storage).toContain('existingSafeDirectory(File(safeRoot, "manifests"), safeRoot)');
    expect(storage).toContain('check(isStrictlyBeneath(boundary, candidate))');
    expect(storage).not.toContain('.mkdirs()');
    expect(storage).not.toContain('.exists()');
    expect(storage).not.toContain('.isFile');

    expect(noBackup.indexOf('lstatOrNull(noBackupRoot)')).toBeLessThan(
      noBackup.indexOf('canonicalAfterLstat(noBackupRoot)'),
    );
    expect(directoryValidation.indexOf('requireNotSymbolicLink(before)')).toBeLessThan(
      directoryValidation.indexOf('canonicalAfterLstat(directory)'),
    );
    expect(fileValidation.indexOf('val before = lstatOrNull(file)')).toBeLessThan(
      fileValidation.indexOf('canonicalAfterLstat(file)'),
    );
    expect(fileValidation.indexOf('requireNotSymbolicLink(before)')).toBeLessThan(
      fileValidation.lastIndexOf('canonicalAfterLstat(file)'),
    );
    expect(treeValidation.indexOf('requireNotSymbolicLink(before)')).toBeLessThan(
      treeValidation.indexOf('canonicalAfterLstat(file)'),
    );
    expect(treeDelete.indexOf('requireSafeTreeEntry(file, expectedParent, safeRoot)')).toBeLessThan(
      treeDelete.indexOf('entry.canonical.listFiles()'),
    );
    expect(treeDelete.indexOf('entry.canonical.listFiles()')).toBeLessThan(
      treeDelete.indexOf('file.delete()'),
    );
  });
});
