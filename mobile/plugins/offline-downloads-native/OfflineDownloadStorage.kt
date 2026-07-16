package __PACKAGE__

import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructStat
import android.util.AtomicFile
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

internal data class OfflineScope(
  val value: String,
  val origin: String,
  val digest: String,
)

internal data class OfflineStoredFile(
  val trackId: String,
  val fileName: String,
  val uri: String,
  val sizeBytes: Long,
)

internal data class OfflineHydration(
  val scope: OfflineScope,
  val directoryUri: String,
  val manifestJson: String?,
  val files: List<OfflineStoredFile>,
  val interruptedTrackIds: List<String>,
  val invalidTrackIds: List<String>,
  val availableDiskBytes: Long,
)

/**
 * The explicit-download store is deliberately separate from RNTP's rolling
 * cacheDir/trackplayer_cache. Files here are never LRU-evicted and are only
 * removed by an explicit playlist/account cleanup transaction.
 */
internal class OfflineDownloadStorage(private val context: Context) {
  private val noBackupRoot = context.noBackupFilesDir.absoluteFile
  private val storeContainer = File(noBackupRoot, "loggerythm_explicit_downloads")
  private val root = File(storeContainer, "v1")
  private val scopesRoot = File(root, "scopes")
  private val manifestRoot = File(root, "manifests")

  init {
    // Establish the trust anchor before constructing or touching any store
    // path. lstat is intentional: File.isDirectory/canonicalFile alone would
    // follow a forged noBackupFilesDir entry.
    requireNoBackupBoundary()
  }

  fun parseScope(value: String): OfflineScope {
    val scope = value.trim()
    val separator = scope.lastIndexOf(SCOPE_SEPARATOR)
    require(separator > 0) { "scope-invalid" }
    val origin = scope.substring(0, separator)
    val userId = scope.substring(separator + SCOPE_SEPARATOR.length)
    require(POSITIVE_ID.matches(userId)) { "scope-invalid" }

    val uri = runCatching { URI(origin) }.getOrNull() ?: throw IllegalArgumentException("scope-invalid")
    val scheme = uri.scheme?.lowercase()
    require(scheme == "https" || scheme == "http") { "scope-invalid" }
    require(
      uri.host != null
        && uri.rawUserInfo == null
        && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
        && uri.rawQuery == null
        && uri.rawFragment == null,
    ) { "scope-invalid" }
    val normalizedOrigin = URI(scheme, null, uri.host.lowercase(), uri.port, null, null, null).toString()
    require(origin == normalizedOrigin) { "scope-invalid" }
    return OfflineScope(scope, origin, sha256(scope))
  }

  fun audioDirectory(scope: OfflineScope): File {
    val scopes = ensureScopesRoot()
    val scopeDirectory = ensureSafeDirectory(File(scopes, scope.digest), scopes)
    return ensureSafeDirectory(File(scopeDirectory, "audio"), scopeDirectory)
  }

  fun finalFile(scope: OfflineScope, trackIdValue: String): File {
    val trackId = requireTrackId(trackIdValue)
    val directory = audioDirectory(scope)
    return File(directory, "$trackId.mp3").also { file ->
      requireSafeRegularFileSlot(file, directory)
    }
  }

  fun partialFile(scope: OfflineScope, trackIdValue: String): File {
    val trackId = requireTrackId(trackIdValue)
    val directory = audioDirectory(scope)
    return File(directory, "$trackId.mp3.part").also { file ->
      requireSafeRegularFileSlot(file, directory)
    }
  }

  fun hydrate(scopeValue: String): OfflineHydration {
    val scope = parseScope(scopeValue)
    val directory = audioDirectory(scope)
    val interrupted = mutableListOf<String>()
    val invalid = mutableListOf<String>()
    val stored = mutableListOf<OfflineStoredFile>()
    val manifestJson = readManifest(scope)
    val expectedSizes = expectedFileSizes(manifestJson)
    val children = directory.listFiles() ?: throw IllegalStateException("storage-unavailable")
    children.sortedBy { it.name }.forEach { file ->
      val stat = requireSafeRegularFileSlot(file, directory)
        ?: throw IllegalStateException("storage-corrupt")
      val finalMatch = FINAL_FILE.matchEntire(file.name)
      val partialMatch = PARTIAL_FILE.matchEntire(file.name)
      when {
        finalMatch != null -> {
          val size = stat.st_size
          val trackId = requireTrackId(finalMatch.groupValues[1])
          val expectedSize = expectedSizes[file.name]
          if (expectedSize == null) {
            interrupted += trackId
            deleteSafeRegularFile(file, directory, "storage-cleanup-failed")
          } else if (size != expectedSize || size <= 0L || !looksLikeMp3(file)) {
            invalid += trackId
            deleteSafeRegularFile(file, directory, "storage-cleanup-failed")
          } else {
            stored += OfflineStoredFile(trackId, file.name, Uri.fromFile(file).toString(), size)
          }
        }
        partialMatch != null -> {
          interrupted += requireTrackId(partialMatch.groupValues[1])
          deleteSafeRegularFile(file, directory, "storage-cleanup-failed")
        }
        else -> throw IllegalStateException("storage-corrupt")
      }
    }
    return OfflineHydration(
      scope = scope,
      directoryUri = Uri.fromFile(directory).toString().trimEnd('/') + "/",
      manifestJson = manifestJson,
      files = stored,
      interruptedTrackIds = interrupted,
      invalidTrackIds = invalid,
      availableDiskBytes = availableBytes(directory),
    )
  }

  fun persistManifest(scopeValue: String, manifestJson: String) {
    val scope = parseScope(scopeValue)
    val plaintext = manifestJson.toByteArray(StandardCharsets.UTF_8)
    require(plaintext.isNotEmpty() && plaintext.size <= MAX_MANIFEST_BYTES) { "manifest-invalid" }
    val manifest = runCatching { JSONObject(manifestJson) }.getOrNull()
      ?: throw IllegalArgumentException("manifest-invalid")
    require(manifest.optString("scope", "") == scope.value) { "manifest-scope-mismatch" }
    require(manifest.optInt("version", -1) > 0) { "manifest-invalid" }
    assertNoSecretKeys(manifest)

    val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateManifestKey())
    cipher.updateAAD(scope.value.toByteArray(StandardCharsets.UTF_8))
    val ciphertext = cipher.doFinal(plaintext)
    val iv = cipher.iv
    check(iv.size == GCM_IV_BYTES) { "manifest-encryption-failed" }

    val atomicFile = AtomicFile(manifestFile(scope))
    var output: FileOutputStream? = null
    try {
      val stream = atomicFile.startWrite()
      output = stream
      stream.write(MAGIC)
      stream.write(iv.size)
      stream.write(iv)
      stream.write(ciphertext)
      stream.flush()
      stream.fd.sync()
      atomicFile.finishWrite(stream)
      output = null
      // AtomicFile may create/remove its .bak entry. Re-validate both slots
      // before considering the encrypted commit durable.
      manifestFile(scope)
    } catch (error: Exception) {
      output?.let(atomicFile::failWrite)
      throw IllegalStateException("manifest-write-failed", error)
    }
  }

  fun readManifest(scope: OfflineScope): String? {
    val file = manifestFile(scope)
    val directory = file.parentFile ?: throw IllegalStateException("storage-scope-invalid")
    val backup = File(file.path + ATOMIC_BACKUP_SUFFIX)
    val fileStat = requireSafeRegularFileSlot(file, directory)
    val backupStat = requireSafeRegularFileSlot(backup, directory)
    if (fileStat == null && backupStat == null) return null
    listOfNotNull(fileStat, backupStat).forEach { stat ->
      check(stat.st_size in 1L..MAX_ENCRYPTED_MANIFEST_BYTES.toLong()) { "manifest-corrupt" }
    }
    // AtomicFile treats a surviving backup as the last committed value. Read
    // that inode directly with O_NOFOLLOW; the next successful AtomicFile
    // write will retire the backup normally.
    val source = if (backupStat != null) backup else file
    val expectedSourceStat = backupStat ?: fileStat
      ?: throw IllegalStateException("manifest-corrupt")
    try {
      DataInputStream(openNoFollow(source, expectedSourceStat)).use { input ->
        val magic = ByteArray(MAGIC.size)
        input.readFully(magic)
        check(magic.contentEquals(MAGIC)) { "manifest-corrupt" }
        val ivSize = input.readUnsignedByte()
        check(ivSize == GCM_IV_BYTES) { "manifest-corrupt" }
        val iv = ByteArray(ivSize)
        input.readFully(iv)
        val ciphertext = input.readBytes()
        check(ciphertext.isNotEmpty()) { "manifest-corrupt" }
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateManifestKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(scope.value.toByteArray(StandardCharsets.UTF_8))
        val plaintext = cipher.doFinal(ciphertext)
        check(plaintext.isNotEmpty() && plaintext.size <= MAX_MANIFEST_BYTES) { "manifest-corrupt" }
        val value = String(plaintext, StandardCharsets.UTF_8)
        val manifest = JSONObject(value)
        check(manifest.optString("scope", "") == scope.value) { "manifest-scope-mismatch" }
        assertNoSecretKeys(manifest)
        return value
      }
    } catch (error: Exception) {
      throw IllegalStateException("manifest-read-failed", error)
    }
  }

  fun removeFiles(scopeValue: String, fileNames: List<String>): Long {
    val scope = parseScope(scopeValue)
    val directory = audioDirectory(scope)
    fileNames.distinct().forEach { fileName ->
      val match = FINAL_FILE.matchEntire(fileName) ?: throw IllegalArgumentException("file-name-invalid")
      requireTrackId(match.groupValues[1])
      val file = File(directory, fileName)
      if (requireSafeRegularFileSlot(file, directory) != null) {
        deleteSafeRegularFile(file, directory, "remove-failed")
      }
      val partial = File(directory, "$fileName.part")
      if (requireSafeRegularFileSlot(partial, directory) != null) {
        deleteSafeRegularFile(partial, directory, "remove-failed")
      }
    }
    return availableBytes(directory)
  }

  fun clearScope(scopeValue: String) {
    val scope = parseScope(scopeValue)
    val safeRoot = existingStoreRootOrNull() ?: return
    val scopes = existingSafeDirectory(File(safeRoot, "scopes"), safeRoot)
    val scopeDirectory = scopes?.let { existingSafeDirectory(File(it, scope.digest), it) }
    if (scopeDirectory != null) deleteTree(scopeDirectory, scopes, safeRoot)

    val manifests = existingSafeDirectory(File(safeRoot, "manifests"), safeRoot)
    if (manifests != null) {
      val manifest = File(manifests, "${scope.digest}.bin")
      val backup = File(manifest.path + ATOMIC_BACKUP_SUFFIX)
      val manifestStat = requireSafeRegularFileSlot(manifest, manifests)
      val backupStat = requireSafeRegularFileSlot(backup, manifests)
      if (manifestStat != null) deleteSafeRegularFile(manifest, manifests, "remove-failed")
      if (backupStat != null) deleteSafeRegularFile(backup, manifests, "remove-failed")
      check(requireSafeRegularFileSlot(manifest, manifests) == null) { "remove-failed" }
      check(requireSafeRegularFileSlot(backup, manifests) == null) { "remove-failed" }
    }

    val scopesAfter = existingSafeDirectory(File(safeRoot, "scopes"), safeRoot)
    if (scopesAfter != null) {
      check(existingSafeDirectory(File(scopesAfter, scope.digest), scopesAfter) == null) { "remove-failed" }
    }
  }

  /**
   * Erases the complete first-party explicit-download store, including every
   * account scope, encrypted AtomicFile backup, committed MP3, and partial.
   * The caller serializes this against every operation that can recreate root.
   */
  fun clearAllScopes() {
    val safeRoot = existingStoreRootOrNull() ?: return
    val safeContainer = safeRoot.parentFile ?: throw IllegalStateException("storage-scope-invalid")
    deleteTree(safeRoot, safeContainer, safeRoot)
    check(existingSafeDirectory(File(safeContainer, "v1"), safeContainer) == null) { "remove-failed" }
  }

  fun availableBytes(directory: File): Long {
    val safeDirectory = requireKnownSafeAudioDirectory(directory)
    return StatFs(safeDirectory.absolutePath).availableBytes.coerceAtLeast(0L)
  }

  fun verifiedExistingFile(scope: OfflineScope, trackIdValue: String): OfflineStoredFile? {
    val trackId = requireTrackId(trackIdValue)
    val file = finalFile(scope, trackId)
    val directory = file.parentFile ?: throw IllegalStateException("storage-scope-invalid")
    val initialStat = requireSafeRegularFileSlot(file, directory) ?: return null
    val expectedSize = expectedFileSizes(readManifest(scope))[file.name]
    val valid = expectedSize != null
      && initialStat.st_size == expectedSize
      && initialStat.st_size > 0L
      && looksLikeMp3(file)
    if (!valid) {
      deleteSafeRegularFile(file, directory, "storage-cleanup-failed")
      return null
    }
    val verifiedStat = requireSafeRegularFileSlot(file, directory)
      ?: throw IllegalStateException("storage-corrupt")
    check(sameEntry(initialStat, verifiedStat)) { "storage-corrupt" }
    return OfflineStoredFile(trackId, file.name, Uri.fromFile(file).toString(), verifiedStat.st_size)
  }

  fun looksLikeMp3(file: File): Boolean {
    val directory = file.parentFile ?: throw IllegalStateException("storage-scope-invalid")
    val safeDirectory = requireKnownSafeAudioDirectory(directory)
    val stat = requireSafeRegularFileSlot(file, safeDirectory) ?: return false
    if (stat.st_size < 2L) return false
    val prefix = ByteArray(3)
    val descriptor = try {
      Os.open(file.absolutePath, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
    } catch (error: ErrnoException) {
      throw IllegalStateException("storage-scope-invalid", error)
    }
    val openedStat = Os.fstat(descriptor)
    if (!OsConstants.S_ISREG(openedStat.st_mode) || !sameEntry(stat, openedStat)) {
      Os.close(descriptor)
      throw IllegalStateException("storage-scope-invalid")
    }
    val count = FileInputStream(descriptor).use { input -> input.read(prefix) }
    if (count >= 3 && prefix[0] == 'I'.code.toByte() && prefix[1] == 'D'.code.toByte() && prefix[2] == '3'.code.toByte()) {
      return true
    }
    return count >= 2
      && prefix[0].toInt() and 0xff == 0xff
      && prefix[1].toInt() and 0xe0 == 0xe0
  }

  fun requireTrackId(value: String): String {
    require(TRACK_ID.matches(value)) { "track-id-invalid" }
    return value
  }

  private fun manifestFile(scope: OfflineScope): File {
    val directory = ensureManifestRoot()
    return File(directory, "${scope.digest}.bin").also { file ->
      // AtomicFile may read, replace, or delete either entry. Both must be
      // proven regular (or absent) before AtomicFile receives the base path.
      requireSafeRegularFileSlot(file, directory)
      requireSafeRegularFileSlot(File(file.path + ATOMIC_BACKUP_SUFFIX), directory)
    }
  }

  private fun expectedFileSizes(manifestJson: String?): Map<String, Long> {
    if (manifestJson == null) return emptyMap()
    val manifest = JSONObject(manifestJson)
    val tracks = manifest.optJSONObject("tracks") ?: throw IllegalStateException("manifest-corrupt")
    val expected = mutableMapOf<String, Long>()
    tracks.keys().forEach { key ->
      val trackId = requireTrackId(key)
      val entry = tracks.optJSONObject(key) ?: throw IllegalStateException("manifest-corrupt")
      val fileName = entry.optString("fileName", "")
      check(fileName == "$trackId.mp3") { "manifest-corrupt" }
      val rawSize = entry.opt("sizeBytes") as? Number ?: throw IllegalStateException("manifest-corrupt")
      val size = rawSize.toLong()
      check(size > 0L && rawSize.toDouble() == size.toDouble()) { "manifest-corrupt" }
      expected[fileName] = size
    }
    return expected
  }

  private fun getOrCreateManifestKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  private fun assertNoSecretKeys(value: Any?) {
    when (value) {
      is JSONObject -> value.keys().forEach { key ->
        check(key.lowercase() !in SECRET_KEYS) { "manifest-secret-field" }
        assertNoSecretKeys(value.opt(key))
      }
      is JSONArray -> repeat(value.length()) { index -> assertNoSecretKeys(value.opt(index)) }
    }
  }

  private fun ensureStoreRoot(): File {
    val boundary = requireNoBackupBoundary()
    // Rebase every child on the canonical, inode-validated Android boundary.
    // context.noBackupFilesDir may use an emulated-storage alias whose textual
    // path differs from File.canonicalFile even though both name the same inode.
    val container = ensureSafeDirectory(File(boundary, storeContainer.name), boundary)
    return ensureSafeDirectory(File(container, root.name), container)
  }

  private fun existingStoreRootOrNull(): File? {
    val boundary = requireNoBackupBoundary()
    val container = existingSafeDirectory(File(boundary, storeContainer.name), boundary)
      ?: return null
    return existingSafeDirectory(File(container, root.name), container)
  }

  private fun ensureScopesRoot(): File {
    val safeRoot = ensureStoreRoot()
    return ensureSafeDirectory(File(safeRoot, scopesRoot.name), safeRoot)
  }

  private fun ensureManifestRoot(): File {
    val safeRoot = ensureStoreRoot()
    return ensureSafeDirectory(File(safeRoot, manifestRoot.name), safeRoot)
  }

  /**
   * The Android-provided noBackup directory is the only trust anchor. Reject
   * the entry with lstat before asking for its canonical path, then ensure the
   * same inode is still present afterwards. System-owned ancestor aliases are
   * allowed; an attacker-controlled link at the noBackup entry is not.
   */
  private fun requireNoBackupBoundary(): File {
    val before = lstatOrNull(noBackupRoot) ?: throw IllegalStateException("storage-unavailable")
    requireNotSymbolicLink(before)
    check(OsConstants.S_ISDIR(before.st_mode)) { "storage-unavailable" }
    val canonical = canonicalAfterLstat(noBackupRoot)
    val after = lstatOrNull(noBackupRoot) ?: throw IllegalStateException("storage-unavailable")
    requireNotSymbolicLink(after)
    check(OsConstants.S_ISDIR(after.st_mode) && sameEntry(before, after)) { "storage-scope-invalid" }
    return canonical
  }

  private fun ensureSafeDirectory(directory: File, expectedParent: File): File {
    requireLexicalDirectChild(directory, expectedParent)
    var stat = lstatOrNull(directory)
    if (stat == null) {
      if (!directory.mkdir()) {
        stat = lstatOrNull(directory)
          ?: throw IllegalStateException("storage-unavailable")
      } else {
        stat = lstatOrNull(directory)
          ?: throw IllegalStateException("storage-unavailable")
      }
    }
    return validateExistingDirectory(directory, expectedParent, stat)
  }

  private fun existingSafeDirectory(directory: File, expectedParent: File): File? {
    requireLexicalDirectChild(directory, expectedParent)
    val stat = lstatOrNull(directory)
    if (stat == null) {
      // A missing entry has no inode to canonicalize. Validate the trusted
      // parent and lexical child relation, then close the appearance race with
      // a second lstat. Canonicalizing a missing child is platform-dependent
      // and can rewrite Android's /data alias into a different textual parent.
      requireCanonicalDirectChild(directory.absoluteFile, expectedParent)
      // A newly appeared entry is a race. Do not accept it until a fresh
      // operation validates it from the beginning.
      check(lstatOrNull(directory) == null) { "storage-scope-invalid" }
      return null
    }
    return validateExistingDirectory(directory, expectedParent, stat)
  }

  private fun validateExistingDirectory(
    directory: File,
    expectedParent: File,
    before: StructStat,
  ): File {
    requireNotSymbolicLink(before)
    check(OsConstants.S_ISDIR(before.st_mode)) { "storage-scope-invalid" }
    val canonical = canonicalAfterLstat(directory)
    requireCanonicalDirectChild(canonical, expectedParent)
    val after = lstatOrNull(directory) ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(after)
    check(OsConstants.S_ISDIR(after.st_mode) && sameEntry(before, after)) { "storage-scope-invalid" }
    return canonical
  }

  /**
   * Validates a manifest/audio file slot without following it. Missing slots
   * are canonicalized only after lstat proves absence, and must remain absent.
   */
  private fun requireSafeRegularFileSlot(file: File, expectedParent: File): StructStat? {
    requireLexicalDirectChild(file, expectedParent)
    val before = lstatOrNull(file)
    if (before == null) {
      val canonical = canonicalAfterLstat(file)
      requireCanonicalDirectChild(canonical, expectedParent)
      check(lstatOrNull(file) == null) { "storage-scope-invalid" }
      return null
    }
    requireNotSymbolicLink(before)
    check(OsConstants.S_ISREG(before.st_mode)) { "storage-scope-invalid" }
    val canonical = canonicalAfterLstat(file)
    requireCanonicalDirectChild(canonical, expectedParent)
    val after = lstatOrNull(file) ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(after)
    check(OsConstants.S_ISREG(after.st_mode) && sameEntry(before, after)) { "storage-scope-invalid" }
    return after
  }

  private fun deleteSafeRegularFile(file: File, expectedParent: File, errorCode: String) {
    val before = requireSafeRegularFileSlot(file, expectedParent) ?: return
    val immediatelyBeforeDelete = requireSafeRegularFileSlot(file, expectedParent)
      ?: throw IllegalStateException("storage-scope-invalid")
    check(sameEntry(before, immediatelyBeforeDelete)) { "storage-scope-invalid" }
    check(file.delete()) { errorCode }
  }

  private fun requireKnownSafeAudioDirectory(directory: File): File {
    val safeRoot = existingStoreRootOrNull() ?: throw IllegalStateException("storage-unavailable")
    val scopes = existingSafeDirectory(File(safeRoot, scopesRoot.name), safeRoot)
      ?: throw IllegalStateException("storage-unavailable")
    val requested = directory.absoluteFile
    val requestedScope = requested.parentFile ?: throw IllegalStateException("storage-scope-invalid")
    check(requested.name == "audio" && SCOPE_DIGEST.matches(requestedScope.name)) {
      "storage-scope-invalid"
    }
    requireLexicalDirectChild(requestedScope, scopes)
    val scope = existingSafeDirectory(File(scopes, requestedScope.name), scopes)
      ?: throw IllegalStateException("storage-unavailable")
    val audio = existingSafeDirectory(File(scope, "audio"), scope)
      ?: throw IllegalStateException("storage-unavailable")
    check(requested.path == audio.path) { "storage-scope-invalid" }
    return audio
  }

  /**
   * Recursive cleanup rejects links and special nodes. In particular it never
   * unlinks a suspicious link as proof of cleanup: clearAll remains failed and
   * retryable until the invalid entry is removed through a trusted boundary.
   */
  private fun deleteTree(file: File, expectedParent: File, safeRoot: File) {
    val entry = requireSafeTreeEntry(file, expectedParent, safeRoot)
    if (OsConstants.S_ISDIR(entry.stat.st_mode)) {
      val children = entry.canonical.listFiles() ?: throw IllegalStateException("remove-failed")
      children.forEach { child -> deleteTree(child, entry.canonical, safeRoot) }
    }
    val immediatelyBeforeDelete = requireSafeTreeEntry(file, expectedParent, safeRoot)
    check(sameEntry(entry.stat, immediatelyBeforeDelete.stat)) { "storage-scope-invalid" }
    check(file.delete()) { "remove-failed" }
  }

  private fun requireSafeTreeEntry(file: File, expectedParent: File, safeRoot: File): SafeTreeEntry {
    requireLexicalDirectChild(file, expectedParent)
    val before = lstatOrNull(file) ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(before)
    check(OsConstants.S_ISDIR(before.st_mode) || OsConstants.S_ISREG(before.st_mode)) {
      "storage-scope-invalid"
    }
    val canonical = canonicalAfterLstat(file)
    requireCanonicalDirectChild(canonical, expectedParent)
    check(canonical.path == safeRoot.path || isStrictlyBeneath(safeRoot, canonical)) {
      "storage-scope-invalid"
    }
    val after = lstatOrNull(file) ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(after)
    check(sameEntry(before, after)) { "storage-scope-invalid" }
    return SafeTreeEntry(canonical, after)
  }

  private fun requireLexicalDirectChild(candidate: File, expectedParent: File) {
    val candidateAbsolute = candidate.absoluteFile
    val expectedAbsolute = expectedParent.absoluteFile
    check(candidateAbsolute.parentFile?.path == expectedAbsolute.path) { "storage-scope-invalid" }
  }

  private fun requireCanonicalDirectChild(candidate: File, expectedParent: File) {
    val boundary = requireNoBackupBoundary()
    val parentBefore = lstatOrNull(expectedParent)
      ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(parentBefore)
    check(OsConstants.S_ISDIR(parentBefore.st_mode)) { "storage-scope-invalid" }
    val parentCanonical = canonicalAfterLstat(expectedParent)
    val parentAfter = lstatOrNull(expectedParent)
      ?: throw IllegalStateException("storage-scope-invalid")
    requireNotSymbolicLink(parentAfter)
    check(OsConstants.S_ISDIR(parentAfter.st_mode) && sameEntry(parentBefore, parentAfter)) {
      "storage-scope-invalid"
    }
    check(
      parentCanonical.path == boundary.path || isStrictlyBeneath(boundary, parentCanonical),
    ) { "storage-scope-invalid" }
    check(candidate.parentFile?.path == parentCanonical.path) { "storage-scope-invalid" }
    check(isStrictlyBeneath(boundary, candidate)) { "storage-scope-invalid" }
  }

  private fun isStrictlyBeneath(boundary: File, candidate: File): Boolean =
    candidate.path.startsWith(boundary.path.trimEnd(File.separatorChar) + File.separator)

  private fun canonicalAfterLstat(file: File): File = try {
    file.canonicalFile
  } catch (error: Exception) {
    throw IllegalStateException("storage-scope-invalid", error)
  }

  private fun openNoFollow(file: File, expected: StructStat): FileInputStream {
    val descriptor = try {
      Os.open(file.absolutePath, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
    } catch (error: ErrnoException) {
      throw IllegalStateException("storage-scope-invalid", error)
    }
    val opened = try {
      Os.fstat(descriptor)
    } catch (error: ErrnoException) {
      Os.close(descriptor)
      throw IllegalStateException("storage-scope-invalid", error)
    }
    if (!OsConstants.S_ISREG(opened.st_mode) || !sameEntry(expected, opened)) {
      Os.close(descriptor)
      throw IllegalStateException("storage-scope-invalid")
    }
    return FileInputStream(descriptor)
  }

  private fun lstatOrNull(file: File): StructStat? = try {
    Os.lstat(file.absolutePath)
  } catch (error: ErrnoException) {
    if (error.errno == OsConstants.ENOENT) null
    else throw IllegalStateException("storage-unavailable", error)
  }

  private fun requireNotSymbolicLink(stat: StructStat) {
    check(!OsConstants.S_ISLNK(stat.st_mode)) { "storage-scope-invalid" }
  }

  private fun sameEntry(left: StructStat, right: StructStat): Boolean =
    left.st_dev == right.st_dev && left.st_ino == right.st_ino

  private data class SafeTreeEntry(val canonical: File, val stat: StructStat)

  private fun sha256(value: String): String =
    MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

  companion object {
    private const val SCOPE_SEPARATOR = "::user:"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "loggerythm.offline.manifest.v1"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BITS = 128
    private const val MAX_MANIFEST_BYTES = 8 * 1024 * 1024
    private const val MAX_ENCRYPTED_MANIFEST_BYTES = MAX_MANIFEST_BYTES + 1024
    private const val ATOMIC_BACKUP_SUFFIX = ".bak"
    private val MAGIC = byteArrayOf(0x4c, 0x52, 0x4f, 0x46, 0x01)
    private val POSITIVE_ID = Regex("[1-9][0-9]{0,18}")
    private val TRACK_ID = Regex("[1-9][0-9]{0,31}")
    private val FINAL_FILE = Regex("([1-9][0-9]{0,31})\\.mp3")
    private val PARTIAL_FILE = Regex("([1-9][0-9]{0,31})\\.mp3\\.part")
    private val SCOPE_DIGEST = Regex("[a-f0-9]{64}")
    private val SECRET_KEYS = setOf("authorization", "cookie", "headers", "session", "token")
  }
}
