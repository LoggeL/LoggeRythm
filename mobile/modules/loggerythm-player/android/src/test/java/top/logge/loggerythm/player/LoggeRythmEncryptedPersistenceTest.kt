package top.logge.loggerythm.player

import androidx.media3.common.Player
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.SecureRandom
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure JVM store tests. AndroidKeyStore behavior remains an instrumentation gate. */
class LoggeRythmEncryptedPersistenceTest {
  private val privateRoot = Files.createTempDirectory("loggerythm-encrypted-state").toFile()
  private val codec = LoggeRythmPersistedStateCodec(LoggeRythmPlayerProtocol(listOf(privateRoot)))
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:771",
    origin = "https://loggerythm.logge.top",
  )

  @Test
  fun envelopeRoundTripIsStrictAndContainsNoPlaintextField() {
    val payload = LoggeRythmEncryptedPayload(
      iv = ByteArray(12) { it.toByte() },
      ciphertext = ByteArray(32) { (it + 20).toByte() },
    )

    val envelope = LoggeRythmEncryptedEnvelopeCodec.encode(payload)
    val restored = LoggeRythmEncryptedEnvelopeCodec.decode(envelope)

    assertArrayEquals(payload.iv, restored.iv)
    assertArrayEquals(payload.ciphertext, restored.ciphertext)
    assertFalse(String(envelope, StandardCharsets.ISO_8859_1).contains("Cookie"))
    assertEnvelopeInvalid(envelope + byteArrayOf(0))
    assertEnvelopeInvalid(envelope.copyOf().also { it[4] = 2 })
  }

  @Test
  fun encryptedStoreRoundTripsWithoutPersistingCookieScopeOriginOrUriPlaintext() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val store = store(file, cipher)
    val state = sampleState()

    store.save(state)

    assertTrue(requireNotNull(cipher.lastEncryptedPlaintext).all { it == 0.toByte() })

    val durableText = String(requireNotNull(file.blob), StandardCharsets.ISO_8859_1)
    assertFalse(durableText.contains("sf_session"))
    assertFalse(durableText.contains(binding.accountScope))
    assertFalse(durableText.contains(binding.origin))
    assertFalse(durableText.contains("/api/tracks/one"))
    assertFalse(durableText.contains("/api/tracks/auto-one"))
    assertFalse(durableText.contains("browse_session"))
    assertEquals(state, store.load())
    assertTrue(requireNotNull(cipher.lastDecryptedPlaintext).all { it == 0.toByte() })
  }

  @Test
  fun serviceOnlyBootstrapRestoresAuthenticatedSelfBindingButCannotSaveOrBypassExactRebind() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val state = sampleState()
    store(file, cipher).save(state)
    val bootstrap = LoggeRythmEncryptedStateStore(codec, cipher, file, expectedBinding = null)

    assertEquals(state, bootstrap.load())
    val saveError = org.junit.Assert.assertThrows(LoggeRythmPersistedStateException::class.java) {
      bootstrap.save(state)
    }
    assertEquals("session-binding-required", saveError.code)
    assertEquals(state, store(file, cipher).load())

    val otherAccount = LoggeRythmEncryptedStateStore(
      codec,
      cipher,
      file,
      binding.copy(accountScope = "user:772"),
    )
    assertNull(otherAccount.load())
    assertNull(file.blob)
  }

  @Test
  fun everySaveUsesANewGcmIv() {
    val file = MemoryBlobFile()
    val store = store(file, JvmAesGcmCipher())

    store.save(sampleState())
    val first = LoggeRythmEncryptedEnvelopeCodec.decode(requireNotNull(file.blob)).iv
    store.save(sampleState().copy(positionMs = 99L))
    val second = LoggeRythmEncryptedEnvelopeCodec.decode(requireNotNull(file.blob)).iv

    assertFalse(first.contentEquals(second))
  }

  @Test
  fun corruptionFailsClosedAndCryptoClearsFileAndKey() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val store = store(file, cipher)
    store.save(sampleState())
    file.blob = requireNotNull(file.blob).copyOf().also { bytes ->
      bytes[bytes.lastIndex] = (bytes.last().toInt() xor 0x01).toByte()
    }

    assertNull(store.load())
    assertNull(file.blob)
    assertEquals(1, cipher.clearCount)
  }

  @Test
  fun missingKeyFailsClosedAndClearsCiphertext() {
    val file = MemoryBlobFile()
    store(file, JvmAesGcmCipher()).save(sampleState())
    val replacementCipher = JvmAesGcmCipher()

    assertNull(store(file, replacementCipher).load())
    assertNull(file.blob)
    assertEquals(1, replacementCipher.clearCount)
  }

  @Test
  fun crossAccountOrOriginRestoreFailsClosed() {
    val accountFile = MemoryBlobFile()
    val accountCipher = JvmAesGcmCipher()
    store(accountFile, accountCipher).save(sampleState())
    val otherAccount = LoggeRythmEncryptedStateStore(
      codec,
      accountCipher,
      accountFile,
      binding.copy(accountScope = "user:772"),
    )
    assertNull(otherAccount.load())
    assertNull(accountFile.blob)

    val originFile = MemoryBlobFile()
    val originCipher = JvmAesGcmCipher()
    store(originFile, originCipher).save(sampleState())
    val otherOrigin = LoggeRythmEncryptedStateStore(
      codec,
      originCipher,
      originFile,
      binding.copy(origin = "https://other.example"),
    )
    assertNull(otherOrigin.load())
    assertNull(originFile.blob)
  }

  @Test
  fun clearAlwaysAttemptsBothKeyAndFileDeletion() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val store = store(file, cipher)
    store.save(sampleState())

    store.clear()

    assertNull(file.blob)
    assertEquals(1, file.clearCount)
    assertEquals(1, cipher.clearCount)
  }

  @Test
  fun clearStillDeletesCiphertextWhenKeyDeletionFails() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val store = store(file, cipher)
    store.save(sampleState())
    cipher.failClear = true

    org.junit.Assert.assertThrows(IllegalStateException::class.java) { store.clear() }

    assertNull(file.blob)
    assertEquals(1, file.clearCount)
    assertEquals(1, cipher.clearCount)
  }

  @Test
  fun readFailureAlsoFailsClosed() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val store = store(file, cipher)
    store.save(sampleState())
    file.failRead = true

    assertNull(store.load())
    assertNull(file.blob)
    assertEquals(1, cipher.clearCount)
  }

  @Test
  fun callbackFacadeRunsStoreOperationsOnInjectedExecutor() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val submissions = mutableListOf<Runnable>()
    val persistence = LoggeRythmEncryptedPersistence(
      store(file, cipher),
      Executor(submissions::add),
    )
    val saveResult = AtomicReference<Result<Unit>>()
    val loadResult = AtomicReference<Result<LoggeRythmPersistedPlayerState?>>()

    persistence.save(sampleState(), saveResult::set)
    assertNull(saveResult.get())
    submissions.removeAt(0).run()
    assertTrue(requireNotNull(saveResult.get()).isSuccess)

    persistence.load(loadResult::set)
    submissions.removeAt(0).run()
    assertEquals(sampleState(), requireNotNull(loadResult.get()).getOrThrow())
  }

  @Test
  fun fifoClearAdmittedAfterUnacknowledgedPolicySaveRemovesItsCiphertext() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val submissions = mutableListOf<Runnable>()
    val persistence = LoggeRythmEncryptedPersistence(
      store(file, cipher),
      Executor(submissions::add),
    )
    val widening = sampleState().copy(
      remoteCapabilities = RemotePlayerCapability.entries.toSet(),
    )
    val saveResult = AtomicReference<Result<Unit>>()
    val clearResult = AtomicReference<Result<Unit>>()

    persistence.save(widening, saveResult::set)
    persistence.clear(clearResult::set)

    assertEquals(2, submissions.size)
    submissions.removeAt(0).run()
    assertTrue(requireNotNull(saveResult.get()).isSuccess)
    assertTrue(file.blob != null)

    submissions.removeAt(0).run()
    assertTrue(requireNotNull(clearResult.get()).isSuccess)
    assertNull(file.blob)
  }

  @Test
  fun acknowledgedNarrowPolicyIsThePolicyRecoveredByAuthenticatedColdRestore() {
    val file = MemoryBlobFile()
    val cipher = JvmAesGcmCipher()
    val exactStore = store(file, cipher)
    exactStore.save(sampleState())
    val submissions = mutableListOf<Runnable>()
    val persistence = LoggeRythmEncryptedPersistence(exactStore, Executor(submissions::add))
    val policy = LoggeRythmRemoteCommandPolicy().apply {
      install(RemotePlayerCapability.entries.toSet())
    }
    val installer = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = policy::reset,
      installPolicy = policy::install,
      refreshConnectedControllers = {},
      persist = { capabilities, completion ->
        persistence.save(sampleState().copy(remoteCapabilities = capabilities), completion)
      },
    )
    val narrowed = setOf(RemotePlayerCapability.PLAY_PAUSE)
    val acknowledgement = AtomicReference<Result<Unit>>()

    installer.install(narrowed, acknowledgement::set)

    assertNull(acknowledgement.get())
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    val beforeReplacement = LoggeRythmEncryptedStateStore(codec, cipher, file, null).load()
    assertEquals(sampleState().remoteCapabilities, beforeReplacement?.remoteCapabilities)

    submissions.removeAt(0).run()

    assertTrue(requireNotNull(acknowledgement.get()).isSuccess)
    assertTrue(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_SEEK_TO_NEXT))
    val afterReplacement = LoggeRythmEncryptedStateStore(codec, cipher, file, null).load()
    assertEquals(narrowed, afterReplacement?.remoteCapabilities)
  }

  private fun store(
    file: MemoryBlobFile,
    cipher: JvmAesGcmCipher,
  ): LoggeRythmEncryptedStateStore =
    LoggeRythmEncryptedStateStore(codec, cipher, file, binding)

  private fun sampleState(): LoggeRythmPersistedPlayerState =
    LoggeRythmPersistedPlayerState(
      sessionBinding = binding,
      queue = listOf(
        LoggeRythmPersistedQueueItem(
          id = "one",
          url = "https://loggerythm.logge.top/api/tracks/one/stream?nonce=opaque",
          title = "One",
          cookie = "sf_session=secret-cookie",
          extrasJson = """{"queueStableId":"stable:one"}""",
        ),
      ),
      activeIndex = 0,
      positionMs = 7L,
      repeatMode = "one",
      contextShuffle = LoggeRythmPersistedContextShuffle(true, listOf("stable:one")),
      sleep = null,
      browseTree = BrowseTreeSpec(
        BrowseNodeSpec(
          id = LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
          title = "LoggeRythm",
          subtitle = null,
          artist = null,
          album = null,
          artworkUrl = null,
          durationMs = null,
          playable = false,
          url = null,
          cookie = null,
          children = listOf(
            BrowseNodeSpec(
              id = "track:auto-one",
              title = "Auto One",
              subtitle = null,
              artist = "Artist",
              album = null,
              artworkUrl = null,
              durationMs = 90_000L,
              playable = true,
              url = "${binding.origin}/api/tracks/auto-one/stream",
              cookie = "browse_session=secret-cookie",
              children = emptyList(),
            ),
          ),
        ),
      ),
      remoteCapabilities = setOf(
        RemotePlayerCapability.PLAY_PAUSE,
        RemotePlayerCapability.NEXT,
      ),
    )

  private fun assertEnvelopeInvalid(envelope: ByteArray) {
    val error = org.junit.Assert.assertThrows(LoggeRythmPersistedStateException::class.java) {
      LoggeRythmEncryptedEnvelopeCodec.decode(envelope)
    }
    assertEquals("encrypted-envelope-invalid", error.code)
  }

  private class MemoryBlobFile : LoggeRythmEncryptedBlobFile {
    var blob: ByteArray? = null
    var clearCount = 0
    var failRead = false

    override fun read(): ByteArray? {
      if (failRead) throw IllegalStateException("test-read-failure")
      return blob?.copyOf()
    }

    override fun replace(blob: ByteArray) {
      this.blob = blob.copyOf()
    }

    override fun clear() {
      clearCount += 1
      blob = null
    }
  }

  /** Real JVM AES-GCM test boundary; this is intentionally not AndroidKeyStore device evidence. */
  private class JvmAesGcmCipher : LoggeRythmEncryptedCipher {
    private var key: SecretKey? = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val random = SecureRandom()
    var clearCount = 0
    var failClear = false
    var lastEncryptedPlaintext: ByteArray? = null
    var lastDecryptedPlaintext: ByteArray? = null

    override fun encrypt(plaintext: ByteArray, aad: ByteArray): LoggeRythmEncryptedPayload {
      lastEncryptedPlaintext = plaintext
      val iv = ByteArray(12).also(random::nextBytes)
      val operation = Cipher.getInstance("AES/GCM/NoPadding")
      operation.init(Cipher.ENCRYPT_MODE, requireNotNull(key), GCMParameterSpec(128, iv))
      operation.updateAAD(aad)
      return LoggeRythmEncryptedPayload(iv, operation.doFinal(plaintext))
    }

    override fun decrypt(payload: LoggeRythmEncryptedPayload, aad: ByteArray): ByteArray {
      val operation = Cipher.getInstance("AES/GCM/NoPadding")
      operation.init(
        Cipher.DECRYPT_MODE,
        requireNotNull(key) { "test-key-missing" },
        GCMParameterSpec(128, payload.iv),
      )
      operation.updateAAD(aad)
      return operation.doFinal(payload.ciphertext).also { lastDecryptedPlaintext = it }
    }

    override fun clearKey() {
      clearCount += 1
      key = null
      if (failClear) throw IllegalStateException("test-key-clear-failure")
    }
  }
}
