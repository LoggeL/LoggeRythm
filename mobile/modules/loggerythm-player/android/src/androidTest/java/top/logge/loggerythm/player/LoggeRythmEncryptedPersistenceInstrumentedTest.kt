package top.logge.loggerythm.player

import android.content.Context
import android.system.Os
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Device evidence for the AndroidKeyStore and no-backup persistence implementation. */
@RunWith(AndroidJUnit4::class)
class LoggeRythmEncryptedPersistenceInstrumentedTest {
  private lateinit var context: Context
  private lateinit var blobFile: LoggeRythmEncryptedAndroidBlobFile
  private lateinit var codec: LoggeRythmPersistedStateCodec

  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:771",
    origin = "https://loggerythm.logge.top",
  )

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
    // The library's generated test application must never share the production app's storage.
    assertNotEquals(PRODUCTION_APPLICATION_ID, context.packageName)
    blobFile = LoggeRythmEncryptedAndroidBlobFile(context)
    codec = LoggeRythmPersistedStateCodec(
      LoggeRythmPlayerProtocol(
        listOf(context.filesDir, context.noBackupFilesDir, context.cacheDir),
      ),
    )
    clearTestArtifacts()
  }

  @After
  fun tearDown() {
    clearTestArtifacts()
  }

  @Test
  fun androidKeyStoreAesGcmRoundTripUsesFreshIvAndPersistsNoPlaintext() {
    val cipher = LoggeRythmEncryptedAndroidKeyStoreCipher()
    val store = store(cipher = cipher)
    val initial = sampleState(positionMs = 7L)
    val updated = sampleState(positionMs = 91L)

    store.save(initial)
    val firstEnvelope = requireNotNull(blobFile.read())
    val firstIv = LoggeRythmEncryptedEnvelopeCodec.decode(firstEnvelope).iv
    assertKeyPresent()

    store.save(updated)
    val secondEnvelope = requireNotNull(blobFile.read())
    val secondIv = LoggeRythmEncryptedEnvelopeCodec.decode(secondEnvelope).iv
    val durableText = String(secondEnvelope, StandardCharsets.ISO_8859_1)

    assertFalse(firstIv.contentEquals(secondIv))
    assertFalse(durableText.contains(FIXTURE_COOKIE))
    assertFalse(durableText.contains(binding.accountScope))
    assertFalse(durableText.contains(binding.origin))
    assertFalse(durableText.contains(FIXTURE_MEDIA_PATH))
    assertEquals(updated, store.load())
  }

  @Test
  fun sessionBindingMismatchFailsClosedAndDeletesCiphertextAndKey() {
    val cipher = LoggeRythmEncryptedAndroidKeyStoreCipher()
    store(cipher = cipher).save(sampleState())
    assertNotNull(blobFile.read())
    assertKeyPresent()

    val mismatchedStore = LoggeRythmEncryptedStateStore(
      codec = codec,
      cipher = cipher,
      blobFile = blobFile,
      expectedBinding = binding.copy(accountScope = "user:772"),
    )

    assertEquals(
      LoggeRythmEncryptedLoadOutcome.DiscardedInvalid,
      mismatchedStore.loadOutcome(),
    )
    assertNull(blobFile.read())
    assertKeyAbsent()
  }

  @Test
  fun tamperedCiphertextFailsClosedAndDeletesCiphertextAndKey() {
    val cipher = LoggeRythmEncryptedAndroidKeyStoreCipher()
    val store = store(cipher = cipher)
    store.save(sampleState())
    val tampered = requireNotNull(blobFile.read()).copyOf().also { envelope ->
      envelope[envelope.lastIndex] = (envelope.last().toInt() xor 0x01).toByte()
    }
    blobFile.replace(tampered)

    assertEquals(LoggeRythmEncryptedLoadOutcome.DiscardedInvalid, store.loadOutcome())
    assertNull(blobFile.read())
    assertKeyAbsent()
  }

  @Test
  fun ciphertextReplacementStaysInNoBackupWithPrivateModeAndNoTempFile() {
    val store = store(cipher = LoggeRythmEncryptedAndroidKeyStoreCipher())
    store.save(sampleState(positionMs = 11L))
    store.save(sampleState(positionMs = 22L))

    val directory = persistenceDirectory()
    val target = persistenceTarget()
    val noBackupRoot = context.noBackupFilesDir.canonicalFile
    val mode = Os.stat(target.absolutePath).st_mode and PERMISSION_MASK

    assertEquals(noBackupRoot, directory.parentFile?.canonicalFile)
    assertEquals(noBackupRoot, target.parentFile?.parentFile?.canonicalFile)
    assertTrue(target.isFile)
    assertEquals(PRIVATE_FILE_MODE, mode)
    assertEquals(listOf(PERSISTENCE_FILE_NAME), directory.listFiles().orEmpty().map { it.name }.sorted())
    assertEquals(sampleState(positionMs = 22L), store.load())
  }

  @Test
  fun concurrentClearWaitsForAdmittedSaveThenRemovesCiphertextAndKey() {
    val blockingFile = BlockingReplaceBlobFile(blobFile)
    val store = store(
      cipher = LoggeRythmEncryptedAndroidKeyStoreCipher(),
      file = blockingFile,
    )
    val executor = Executors.newFixedThreadPool(2)
    val clearStarted = CountDownLatch(1)
    val clearFinished = CountDownLatch(1)
    try {
      val saveFuture = executor.submit<Unit> { store.save(sampleState()) }
      assertTrue(blockingFile.replaceEntered.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))

      val clearFuture = executor.submit<Unit> {
        clearStarted.countDown()
        try {
          store.clear()
        } finally {
          clearFinished.countDown()
        }
      }
      assertTrue(clearStarted.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
      assertFalse(clearFinished.await(CLEAR_BLOCK_ASSERTION_MS, TimeUnit.MILLISECONDS))

      blockingFile.allowReplace.countDown()
      saveFuture.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      clearFuture.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)

      assertNull(blobFile.read())
      assertKeyAbsent()
    } finally {
      blockingFile.allowReplace.countDown()
      executor.shutdownNow()
      executor.awaitTermination(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }
  }

  private fun store(
    cipher: LoggeRythmEncryptedAndroidKeyStoreCipher,
    file: LoggeRythmEncryptedBlobFile = blobFile,
  ): LoggeRythmEncryptedStateStore = LoggeRythmEncryptedStateStore(
    codec = codec,
    cipher = cipher,
    blobFile = file,
    expectedBinding = binding,
  )

  private fun sampleState(positionMs: Long = 7L): LoggeRythmPersistedPlayerState =
    LoggeRythmPersistedPlayerState(
      sessionBinding = binding,
      queue = listOf(
        LoggeRythmPersistedQueueItem(
          id = "instrumentation-one",
          url = "${binding.origin}$FIXTURE_MEDIA_PATH?nonce=fixture",
          title = "Instrumentation One",
          cookie = FIXTURE_COOKIE,
          extrasJson = """{"queueStableId":"instrumentation:one"}""",
        ),
      ),
      activeIndex = 0,
      positionMs = positionMs,
      repeatMode = "one",
      contextShuffle = LoggeRythmPersistedContextShuffle(
        enabled = true,
        restoreOrder = listOf("instrumentation:one"),
      ),
      sleep = null,
    )

  private fun clearTestArtifacts() {
    runCatching { LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey() }
      .getOrThrow()
    runCatching { LoggeRythmEncryptedAndroidBlobFile(context).clear() }
      .getOrThrow()
  }

  private fun persistenceDirectory() =
    context.noBackupFilesDir.resolve(PERSISTENCE_DIRECTORY_NAME).canonicalFile

  private fun persistenceTarget() =
    persistenceDirectory().resolve(PERSISTENCE_FILE_NAME).canonicalFile

  private fun assertKeyPresent() {
    assertTrue(loadAndroidKeyStore().containsAlias(PERSISTENCE_KEY_ALIAS))
  }

  private fun assertKeyAbsent() {
    assertFalse(loadAndroidKeyStore().containsAlias(PERSISTENCE_KEY_ALIAS))
  }

  private fun loadAndroidKeyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

  private class BlockingReplaceBlobFile(
    private val delegate: LoggeRythmEncryptedBlobFile,
  ) : LoggeRythmEncryptedBlobFile {
    val replaceEntered = CountDownLatch(1)
    val allowReplace = CountDownLatch(1)

    override fun read(): ByteArray? = delegate.read()

    override fun replace(blob: ByteArray) {
      replaceEntered.countDown()
      check(allowReplace.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
        "instrumentation-replace-timeout"
      }
      delegate.replace(blob)
    }

    override fun clear() = delegate.clear()
  }

  companion object {
    private const val PRODUCTION_APPLICATION_ID = "top.logge.loggerythm"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val PERSISTENCE_KEY_ALIAS =
      "top.logge.loggerythm.player.persisted-state.v1"
    private const val PERSISTENCE_DIRECTORY_NAME = "loggerythm-player"
    private const val PERSISTENCE_FILE_NAME = "player-state.enc"
    private const val FIXTURE_COOKIE = "fixture_session=instrumentation-only-value"
    private const val FIXTURE_MEDIA_PATH = "/api/tracks/instrumentation-one/stream"
    private const val DEVICE_TIMEOUT_SECONDS = 10L
    private const val CLEAR_BLOCK_ASSERTION_MS = 250L
    private const val PERMISSION_MASK = 0x1ff
    private const val PRIVATE_FILE_MODE = 0x180
  }
}
