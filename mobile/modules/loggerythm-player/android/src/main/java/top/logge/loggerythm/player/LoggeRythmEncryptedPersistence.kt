package top.logge.loggerythm.player

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.KeyStore
import java.util.concurrent.Executor
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class LoggeRythmEncryptedPayload(
  val iv: ByteArray,
  val ciphertext: ByteArray,
) {
  override fun toString(): String =
    "LoggeRythmEncryptedPayload(iv=<redacted>, ciphertext=<redacted>)"
}

/** Cryptographic boundary kept independent from state and filesystem behavior for JVM tests. */
internal interface LoggeRythmEncryptedCipher {
  fun encrypt(plaintext: ByteArray, aad: ByteArray): LoggeRythmEncryptedPayload
  fun decrypt(payload: LoggeRythmEncryptedPayload, aad: ByteArray): ByteArray
  fun clearKey()
}

/** Durable encrypted-blob boundary kept independent from Android storage for JVM tests. */
internal interface LoggeRythmEncryptedBlobFile {
  fun read(): ByteArray?
  fun replace(blob: ByteArray)
  fun clear()
}

internal sealed interface LoggeRythmEncryptedLoadOutcome {
  data object Absent : LoggeRythmEncryptedLoadOutcome
  data class Restored(val state: LoggeRythmPersistedPlayerState) : LoggeRythmEncryptedLoadOutcome
  data object DiscardedInvalid : LoggeRythmEncryptedLoadOutcome
}

/** Strict binary wrapper around the AES-GCM IV and ciphertext. No plaintext field is present. */
internal object LoggeRythmEncryptedEnvelopeCodec {
  private val MAGIC = byteArrayOf(0x4c, 0x52, 0x50, 0x53) // "LRPS"
  private const val VERSION = 1
  private const val GCM_IV_BYTES = 12
  private const val GCM_TAG_BYTES = 16
  internal const val MAX_ENVELOPE_BYTES = LoggeRythmPersistedStateCodec.MAX_STATE_JSON_BYTES + 128

  fun encode(payload: LoggeRythmEncryptedPayload): ByteArray {
    if (payload.iv.size != GCM_IV_BYTES) envelopeFailure()
    if (payload.ciphertext.size !in GCM_TAG_BYTES..MAX_ENVELOPE_BYTES) envelopeFailure()
    val output = ByteArrayOutputStream(HEADER_BYTES + payload.iv.size + payload.ciphertext.size)
    DataOutputStream(output).use { stream ->
      stream.write(MAGIC)
      stream.writeByte(VERSION)
      stream.writeByte(payload.iv.size)
      stream.writeInt(payload.ciphertext.size)
      stream.write(payload.iv)
      stream.write(payload.ciphertext)
    }
    return output.toByteArray().also {
      if (it.size > MAX_ENVELOPE_BYTES) envelopeFailure()
    }
  }

  fun decode(envelope: ByteArray): LoggeRythmEncryptedPayload {
    if (envelope.size !in (HEADER_BYTES + GCM_IV_BYTES + GCM_TAG_BYTES)..MAX_ENVELOPE_BYTES) {
      envelopeFailure()
    }
    return try {
      DataInputStream(ByteArrayInputStream(envelope)).use { stream ->
        val magic = ByteArray(MAGIC.size)
        stream.readFully(magic)
        if (!magic.contentEquals(MAGIC) || stream.readUnsignedByte() != VERSION) envelopeFailure()
        val ivLength = stream.readUnsignedByte()
        val ciphertextLength = stream.readInt()
        if (ivLength != GCM_IV_BYTES || ciphertextLength < GCM_TAG_BYTES) envelopeFailure()
        if (HEADER_BYTES + ivLength + ciphertextLength != envelope.size) envelopeFailure()
        val iv = ByteArray(ivLength).also(stream::readFully)
        val ciphertext = ByteArray(ciphertextLength).also(stream::readFully)
        if (stream.read() != -1) envelopeFailure()
        LoggeRythmEncryptedPayload(iv, ciphertext)
      }
    } catch (error: LoggeRythmPersistedStateException) {
      throw error
    } catch (_: Exception) {
      envelopeFailure()
    }
  }

  private fun envelopeFailure(): Nothing =
    throw LoggeRythmPersistedStateException("encrypted-envelope-invalid")

  private const val HEADER_BYTES = 10
}

/**
 * Synchronous core intended to run on a dedicated I/O executor through
 * [LoggeRythmEncryptedPersistence]. It never writes codec plaintext to disk and clears temporary
 * plaintext buffers after each operation.
 */
internal class LoggeRythmEncryptedStateStore(
  private val codec: LoggeRythmPersistedStateCodec,
  private val cipher: LoggeRythmEncryptedCipher,
  private val blobFile: LoggeRythmEncryptedBlobFile,
  private val expectedBinding: LoggeRythmPersistedSessionBinding,
) {
  init {
    codec.requireValidBinding(expectedBinding)
  }

  @Synchronized
  fun loadOutcome(): LoggeRythmEncryptedLoadOutcome {
    var plaintext: ByteArray? = null
    return try {
      val envelope = blobFile.read() ?: return LoggeRythmEncryptedLoadOutcome.Absent
      val payload = LoggeRythmEncryptedEnvelopeCodec.decode(envelope)
      plaintext = cipher.decrypt(payload, AAD)
      LoggeRythmEncryptedLoadOutcome.Restored(codec.decode(plaintext, expectedBinding))
    } catch (_: Exception) {
      clearAfterInvalidState()
      LoggeRythmEncryptedLoadOutcome.DiscardedInvalid
    } finally {
      plaintext?.fill(0)
    }
  }

  @Synchronized
  fun load(): LoggeRythmPersistedPlayerState? =
    (loadOutcome() as? LoggeRythmEncryptedLoadOutcome.Restored)?.state

  @Synchronized
  fun save(state: LoggeRythmPersistedPlayerState) {
    if (state.sessionBinding != expectedBinding) {
      throw LoggeRythmPersistedStateException("session-binding-mismatch")
    }
    var plaintext: ByteArray? = null
    try {
      plaintext = codec.encode(state)
      val payload = cipher.encrypt(plaintext, AAD)
      blobFile.replace(LoggeRythmEncryptedEnvelopeCodec.encode(payload))
    } finally {
      plaintext?.fill(0)
    }
  }

  /** Delete ciphertext and its key. Both cleanup steps are attempted even when one fails. */
  @Synchronized
  fun clear() {
    var failure: Exception? = null
    try {
      cipher.clearKey()
    } catch (error: Exception) {
      failure = error
    }
    try {
      blobFile.clear()
    } catch (error: Exception) {
      failure?.addSuppressed(error) ?: run { failure = error }
    }
    failure?.let { throw it }
  }

  private fun clearAfterInvalidState() {
    try {
      clear()
    } catch (cleanup: Exception) {
      throw IllegalStateException("encrypted-state-cleanup-failed", cleanup)
    }
  }

  companion object {
    /** Fixed app/schema identity only: account, origin, URI, and secrets never enter AAD. */
    private val AAD =
      "top.logge.loggerythm.player|persisted-state|json-v1|envelope-v1"
        .toByteArray(Charsets.UTF_8)
  }
}

/** Small callback facade that prevents service/UI callers from doing disk or KeyStore work inline. */
internal class LoggeRythmEncryptedPersistence(
  private val store: LoggeRythmEncryptedStateStore,
  private val ioExecutor: Executor,
) {
  fun load(completion: (Result<LoggeRythmPersistedPlayerState?>) -> Unit) {
    submit(completion) { store.load() }
  }

  fun loadOutcome(completion: (Result<LoggeRythmEncryptedLoadOutcome>) -> Unit) {
    submit(completion) { store.loadOutcome() }
  }

  fun save(state: LoggeRythmPersistedPlayerState, completion: (Result<Unit>) -> Unit) {
    submit(completion) { store.save(state) }
  }

  fun clear(completion: (Result<Unit>) -> Unit) {
    submit(completion) { store.clear() }
  }

  private fun <T> submit(completion: (Result<T>) -> Unit, operation: () -> T) {
    ioExecutor.execute { completion(runCatching(operation)) }
  }
}

/** AndroidKeyStore AES-256-GCM. The provider creates a fresh randomized IV for every encryption. */
internal class LoggeRythmEncryptedAndroidKeyStoreCipher(
) : LoggeRythmEncryptedCipher {
  override fun encrypt(plaintext: ByteArray, aad: ByteArray): LoggeRythmEncryptedPayload {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    cipher.updateAAD(aad)
    val ciphertext = cipher.doFinal(plaintext)
    val iv = cipher.iv ?: throw IllegalStateException("keystore-iv-missing")
    if (iv.size != GCM_IV_BYTES) throw IllegalStateException("keystore-iv-invalid")
    return LoggeRythmEncryptedPayload(iv.copyOf(), ciphertext)
  }

  override fun decrypt(payload: LoggeRythmEncryptedPayload, aad: ByteArray): ByteArray {
    if (payload.iv.size != GCM_IV_BYTES) {
      throw LoggeRythmPersistedStateException("encrypted-envelope-invalid")
    }
    val key = existingKey() ?: throw IllegalStateException("keystore-key-missing")
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, payload.iv))
    cipher.updateAAD(aad)
    return cipher.doFinal(payload.ciphertext)
  }

  override fun clearKey() {
    val keyStore = loadKeyStore()
    if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
  }

  private fun getOrCreateKey(): SecretKey {
    existingKey()?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }

  private fun existingKey(): SecretKey? =
    loadKeyStore().getKey(KEY_ALIAS, null) as? SecretKey

  private fun loadKeyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

  companion object {
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
    private const val KEY_ALIAS = "top.logge.loggerythm.player.persisted-state.v1"
  }
}

/**
 * App-private, no-backup, bounded blob file. Replacement is same-directory atomic rename with
 * fsync of both the file and directory, so a successful return is durable across process loss.
 */
internal class LoggeRythmEncryptedAndroidBlobFile(context: Context) :
  LoggeRythmEncryptedBlobFile {
  private val appContext = context.applicationContext
  // Store construction happens on the service main thread; defer every filesystem touch until the
  // persistence executor invokes read/replace/clear.
  private val directory: File by lazy(::initializeDirectory)
  private val target: File by lazy { File(directory, FILE_NAME) }

  override fun read(): ByteArray? {
    if (!target.exists()) return null
    if (!target.isFile) throw IllegalStateException("storage-file-invalid")
    val length = target.length()
    if (length <= 0L || length > LoggeRythmEncryptedEnvelopeCodec.MAX_ENVELOPE_BYTES) {
      throw LoggeRythmPersistedStateException("encrypted-envelope-invalid")
    }
    val result = ByteArray(length.toInt())
    FileInputStream(target).use { input ->
      var offset = 0
      while (offset < result.size) {
        val count = input.read(result, offset, result.size - offset)
        if (count < 0) throw IllegalStateException("storage-read-truncated")
        offset += count
      }
      if (input.read() != -1) throw IllegalStateException("storage-read-expanded")
    }
    return result
  }

  override fun replace(blob: ByteArray) {
    if (blob.isEmpty() || blob.size > LoggeRythmEncryptedEnvelopeCodec.MAX_ENVELOPE_BYTES) {
      throw LoggeRythmPersistedStateException("encrypted-envelope-invalid")
    }
    val temporary = File.createTempFile(TEMP_PREFIX, TEMP_SUFFIX, directory)
    try {
      Os.chmod(temporary.absolutePath, PRIVATE_FILE_MODE)
      FileOutputStream(temporary).use { output ->
        output.write(blob)
        output.flush()
        output.fd.sync()
      }
      Os.rename(temporary.absolutePath, target.absolutePath)
      syncDirectory()
    } finally {
      if (temporary.exists() && !temporary.delete()) {
        // The temp file contains ciphertext only. A later app-private cleanup may remove it.
      }
    }
  }

  override fun clear() {
    if (target.exists() && !target.delete()) throw IllegalStateException("storage-delete-failed")
    syncDirectory()
  }

  private fun syncDirectory() {
    syncPath(directory)
  }

  private fun initializeDirectory(): File {
    val noBackupRoot = appContext.noBackupFilesDir.canonicalFile
    val candidate = File(noBackupRoot, DIRECTORY_NAME).canonicalFile
    if (candidate.parentFile != noBackupRoot) throw IllegalStateException("storage-root-invalid")
    if (!candidate.exists()) {
      if (!candidate.mkdir()) throw IllegalStateException("storage-create-failed")
      syncPath(noBackupRoot)
    }
    if (!candidate.isDirectory) throw IllegalStateException("storage-directory-invalid")
    return candidate
  }

  private fun syncPath(path: File) {
    val descriptor = Os.open(path.absolutePath, OsConstants.O_RDONLY, 0)
    try {
      Os.fsync(descriptor)
    } finally {
      Os.close(descriptor)
    }
  }

  companion object {
    private const val DIRECTORY_NAME = "loggerythm-player"
    private const val FILE_NAME = "player-state.enc"
    private const val TEMP_PREFIX = ".player-state-"
    private const val TEMP_SUFFIX = ".tmp"
    private const val PRIVATE_FILE_MODE = 0x180 // 0600
  }
}
