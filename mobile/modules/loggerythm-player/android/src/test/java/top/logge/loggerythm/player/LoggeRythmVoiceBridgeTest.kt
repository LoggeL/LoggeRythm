package top.logge.loggerythm.player

import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmVoiceBridgeTest {
  @Test
  fun buildValidatedQueryRejectsBlankRequiredOverlongAndControlCharacters() {
    val blankAllowed = LoggeRythmVoiceBridge.buildValidatedQuery(
      rawQuery = "   ",
      mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
      artist = null,
      album = null,
      title = null,
      playlist = null,
      requireNonBlank = false,
    )
    assertTrue(blankAllowed.isBlank())

    val blankRejected = assertThrows(LoggeRythmVoiceException::class.java) {
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = "   ",
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = null,
        album = null,
        title = null,
        playlist = null,
        requireNonBlank = true,
      )
    }
    assertEquals(LoggeRythmVoiceErrorCode.INVALID_ARGUMENT, blankRejected.code)

    val tooLong = assertThrows(LoggeRythmVoiceException::class.java) {
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = "a".repeat(257),
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = null,
        album = null,
        title = null,
        playlist = null,
        requireNonBlank = false,
      )
    }
    assertEquals(LoggeRythmVoiceErrorCode.INVALID_ARGUMENT, tooLong.code)

    val controlChar = assertThrows(LoggeRythmVoiceException::class.java) {
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = "Daft\nPunk",
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = null,
        album = null,
        title = null,
        playlist = null,
        requireNonBlank = false,
      )
    }
    assertEquals(LoggeRythmVoiceErrorCode.INVALID_ARGUMENT, controlChar.code)
  }

  @Test
  fun buildValidatedQueryInfersFocusFromStructuredFieldsWhenFocusIsAny() {
    assertEquals(
      LoggeRythmVoiceMediaFocus.PLAYLIST,
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = null,
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = "Daft Punk",
        album = "Discovery",
        title = "One More Time",
        playlist = "Roadtrip",
        requireNonBlank = true,
      ).mediaFocus,
    )
    assertEquals(
      LoggeRythmVoiceMediaFocus.TRACK,
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = null,
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = "Daft Punk",
        album = "Discovery",
        title = "One More Time",
        playlist = null,
        requireNonBlank = true,
      ).mediaFocus,
    )
    assertEquals(
      LoggeRythmVoiceMediaFocus.ALBUM,
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = null,
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = "Daft Punk",
        album = "Discovery",
        title = null,
        playlist = null,
        requireNonBlank = true,
      ).mediaFocus,
    )
    assertEquals(
      LoggeRythmVoiceMediaFocus.ARTIST,
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = null,
        mediaFocus = LoggeRythmVoiceMediaFocus.ANY,
        artist = "Daft Punk",
        album = null,
        title = null,
        playlist = null,
        requireNonBlank = true,
      ).mediaFocus,
    )
    // Explicit focus overrides inference
    assertEquals(
      LoggeRythmVoiceMediaFocus.ALBUM,
      LoggeRythmVoiceBridge.buildValidatedQuery(
        rawQuery = "Discovery",
        mediaFocus = LoggeRythmVoiceMediaFocus.ALBUM,
        artist = "Daft Punk",
        album = "Discovery",
        title = "Digital Love",
        playlist = null,
        requireNonBlank = true,
      ).mediaFocus,
    )
  }

  @Test
  fun mapCarErrorAndAsVoiceExceptionCoverAllErrorsWithoutLeakingSecrets() {
    LoggeRythmCarError.entries.forEach { carError ->
      val mapped = LoggeRythmVoiceBridge.mapCarError(carError)
      val wrapped = LoggeRythmVoiceBridge.asVoiceException(LoggeRythmCarRequestException(carError))
      assertEquals(mapped, wrapped.code)
      assertEquals(carError.code, wrapped.message)
    }
    assertEquals(
      LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
      LoggeRythmVoiceBridge.mapCarError(LoggeRythmCarError.SIGNED_OUT),
    )
    assertEquals(
      LoggeRythmVoiceErrorCode.NETWORK_ERROR,
      LoggeRythmVoiceBridge.mapCarError(LoggeRythmCarError.SEARCH_NETWORK_ERROR),
    )
    val direct = LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH, "no-match")
    assertSame(direct, LoggeRythmVoiceBridge.asVoiceException(direct))
    val protocol = LoggeRythmVoiceBridge.asVoiceException(PlayerProtocolException("queue-too-large"))
    assertEquals(LoggeRythmVoiceErrorCode.INVALID_ARGUMENT, protocol.code)
    assertEquals("queue-too-large", protocol.message)
    val unknown = LoggeRythmVoiceBridge.asVoiceException(
      IllegalStateException("https://secret.example/token=abc"),
    )
    assertEquals(LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE, unknown.code)
    assertEquals("IllegalStateException", unknown.message)
  }

  @Test
  fun serviceBridgeDispatchesWaitersRejectsDuplicateControlAndSupportsCancellation() {
    val first = stubControl()
    val second = stubControl()
    val deliveries = AtomicInteger(0)
    val cancelledDeliveries = AtomicInteger(0)
    try {
      assertNull(LoggeRythmVoiceServiceBridge.current())
      LoggeRythmVoiceServiceBridge.awaitOrCurrent { deliveries.incrementAndGet() }
      val cancel = LoggeRythmVoiceServiceBridge.awaitOrCurrent { cancelledDeliveries.incrementAndGet() }
      cancel()

      LoggeRythmVoiceServiceBridge.attach(first)
      assertSame(first, LoggeRythmVoiceServiceBridge.current())
      assertEquals(1, deliveries.get())
      assertEquals(0, cancelledDeliveries.get())

      // Immediate delivery when already attached
      LoggeRythmVoiceServiceBridge.awaitOrCurrent { deliveries.incrementAndGet() }
      assertEquals(2, deliveries.get())

      // Distinct active control fails loudly
      val conflict = assertThrows(LoggeRythmVoiceException::class.java) {
        LoggeRythmVoiceServiceBridge.attach(second)
      }
      assertEquals(LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE, conflict.code)
    } finally {
      LoggeRythmVoiceServiceBridge.detach(first)
      LoggeRythmVoiceServiceBridge.detach(second)
    }
    assertNull(LoggeRythmVoiceServiceBridge.current())
  }

  private fun stubControl(): LoggeRythmVoiceServiceControl = object : LoggeRythmVoiceServiceControl {
    override fun executePlayMusic(
      request: LoggeRythmVoiceQuery,
      callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
    ) = Unit

    override fun executeControlPlayback(
      action: LoggeRythmVoicePlaybackAction,
      callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
    ) = Unit

    override fun executeQueueMusic(
      request: LoggeRythmVoiceQuery,
      position: LoggeRythmVoiceQueuePosition,
      callback: (Result<LoggeRythmVoiceQueueResult>) -> Unit,
    ) = Unit

    override fun executeSetCurrentTrackFavorite(
      liked: Boolean,
      callback: (Result<LoggeRythmVoiceFavoriteResult>) -> Unit,
    ) = Unit

    override fun executeGetNowPlaying(
      callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
    ) = Unit
  }
}
