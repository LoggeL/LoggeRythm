package top.logge.loggerythm.player

import android.service.quicksettings.Tile
import java.net.InetAddress
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LoggeRythmWidgetAndTileTest {
  private lateinit var server: MockWebServer
  private lateinit var client: LoggeRythmVoiceCatalogClient
  private lateinit var origin: String

  @Before
  fun setUp() {
    val localhost = InetAddress.getByName("127.0.0.1").canonicalHostName
    val serverCert = HeldCertificate.Builder()
      .addSubjectAlternativeName("localhost")
      .addSubjectAlternativeName("127.0.0.1")
      .addSubjectAlternativeName(localhost)
      .build()
    val serverCerts = HandshakeCertificates.Builder()
      .heldCertificate(serverCert)
      .build()
    val clientCerts = HandshakeCertificates.Builder()
      .addTrustedCertificate(serverCert.certificate)
      .build()
    server = MockWebServer()
    server.useHttps(serverCerts.sslSocketFactory(), false)
    server.start()
    origin = "https://${server.hostName}:${server.port}"
    client = LoggeRythmVoiceCatalogClient(
      failClosedMediaHttpClient {
        sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager)
      },
    )
  }

  @After
  fun tearDown() {
    server.shutdown()
  }

  @Test
  fun widgetPolicyResolvesActionsLabelsAndTogglesCleanly() {
    assertEquals(
      LoggeRythmWidgetAction.TOGGLE_PLAY_PAUSE,
      LoggeRythmWidgetAction.fromIntentAction(LoggeRythmWidgetAction.TOGGLE_PLAY_PAUSE.actionString),
    )
    assertNull(LoggeRythmWidgetAction.fromIntentAction("unrelated.action"))

    val empty = LoggeRythmWidgetSnapshot(false, null, "  ", null, false, null)
    assertEquals("Nothing playing", LoggeRythmWidgetPolicy.resolveTitle(empty, "Nothing playing"))
    assertEquals("Tap to open", LoggeRythmWidgetPolicy.resolveSubtitle(empty, "Tap to open"))
    assertEquals(LoggeRythmVoicePlaybackAction.PLAY, LoggeRythmWidgetPolicy.togglePlaybackAction(false))
    assertEquals(LoggeRythmVoicePlaybackAction.PAUSE, LoggeRythmWidgetPolicy.togglePlaybackAction(true))
    assertTrue(LoggeRythmWidgetPolicy.nextLikedState(null))
    assertTrue(LoggeRythmWidgetPolicy.nextLikedState(false))
    assertFalse(LoggeRythmWidgetPolicy.nextLikedState(true))

    val trackDefaultArt = LoggeRythmVoiceTrackSummary("t:2", "2", "Track", "Artist", "Album", 180_000L)
    assertNull(trackDefaultArt.artworkUrl)
    val trackWithArt = LoggeRythmVoiceTrackSummary(
      mediaId = "t:3",
      trackId = "3",
      title = "Track",
      artist = "Artist",
      album = "Album",
      durationMs = 180_000L,
      artworkUrl = "https://cdn.example.test/art.jpg",
    )
    assertEquals("https://cdn.example.test/art.jpg", trackWithArt.artworkUrl)
  }

  @Test
  fun quickSettingsTilePolicyDecidesPauseResumeOrPersonalRadioAndPresentation() {
    val track = LoggeRythmVoiceTrackSummary("t:1", "1", "Midnight City", "M83", "HUWD", 243_000L)
    val playing = LoggeRythmVoiceNowPlaying(
      hasActiveTrack = true,
      track = track,
      isPlaying = true,
      playWhenReady = true,
      playbackState = LoggeRythmVoicePlaybackState.READY,
      positionMs = 10_000L,
      durationMs = 243_000L,
      liked = true,
      queueSize = 4,
      currentIndex = 0,
    )
    val paused = playing.copy(isPlaying = false, playWhenReady = false)
    val empty = playing.copy(hasActiveTrack = false, track = null, isPlaying = false, queueSize = 0, currentIndex = null)

    assertEquals(LoggeRythmQuickTileClickDecision.PAUSE, LoggeRythmQuickTilePolicy.decideClick(playing))
    assertEquals(LoggeRythmQuickTileClickDecision.RESUME, LoggeRythmQuickTilePolicy.decideClick(paused))
    assertEquals(LoggeRythmQuickTileClickDecision.START_PERSONAL_RADIO, LoggeRythmQuickTilePolicy.decideClick(empty))
    assertEquals(LoggeRythmQuickTileClickDecision.START_PERSONAL_RADIO, LoggeRythmQuickTilePolicy.decideClick(null))

    val activePres = LoggeRythmQuickTilePolicy.presentation(playing, "Resume / Radio", "Playing", "Paused")
    assertEquals(Tile.STATE_ACTIVE, activePres.tileState)
    assertEquals("Midnight City", activePres.subtitle)

    val idlePres = LoggeRythmQuickTilePolicy.presentation(empty, "Resume / Radio", "Playing", "Paused")
    assertEquals(Tile.STATE_INACTIVE, idlePres.tileState)
    assertEquals("Resume / Radio", idlePres.subtitle)
  }

  @Test
  fun voiceCatalogClientResolvesMoodSeededAndPersonalMixRadioWithRadioExtrasFlag() {
    val trackJson = """
      {
        "id": "555",
        "title": "Nightcall",
        "artist": "Kavinsky",
        "artist_id": 123,
        "artists": [{"id": 123, "name": "Kavinsky"}],
        "album": "OutRun",
        "album_id": 999,
        "cover": "https://cdn.example.test/cover.jpg",
        "duration_sec": 258,
        "preview_url": null,
        "rank": 500000,
        "release_date": "2010-04-02"
      }
    """.trimIndent()

    // 1. Mood/genre radio -> /api/home/mood/synthwave
    server.enqueue(MockResponse().setResponseCode(200).setBody("[$trackJson]"))
    val moodSel = client.resolveRadio(
      origin = origin,
      cookie = "sf_session=radio-cookie",
      moodOrGenre = "Synthwave",
      seedTrackId = null,
    )
    assertEquals("/api/home/mood/synthwave", server.takeRequest().path)
    assertEquals("Synthwave", moodSel.matchedTitle)
    assertEquals(1, moodSel.items.size)
    assertTrue(JSONObject(moodSel.items.first().extrasJson).getBoolean("radio"))

    // 2. Track-seeded personal radio -> /api/radio/777
    server.enqueue(MockResponse().setResponseCode(200).setBody("[$trackJson]"))
    val seededSel = client.resolveRadio(
      origin = origin,
      cookie = "sf_session=radio-cookie",
      moodOrGenre = null,
      seedTrackId = "777",
    )
    assertEquals("/api/radio/777", server.takeRequest().path)
    assertEquals("Personal Radio", seededSel.matchedTitle)
    assertTrue(JSONObject(seededSel.items.first().extrasJson).getBoolean("radio"))

    // 3. Personalized mixes when no seed track is active -> /api/home/mixes
    server.enqueue(
      MockResponse().setResponseCode(200).setBody(
        """[{"key":"daily","title":"Für dich Mix","subtitle":"","cover":"","tracks":[$trackJson]}]""",
      ),
    )
    val mixSel = client.resolveRadio(
      origin = origin,
      cookie = "sf_session=radio-cookie",
      moodOrGenre = null,
      seedTrackId = null,
    )
    assertEquals("/api/home/mixes", server.takeRequest().path)
    assertEquals("Für dich Mix", mixSel.matchedTitle)
    assertTrue(JSONObject(mixSel.items.first().extrasJson).getBoolean("radio"))

    // 4. Empty mixes fails loud with NOTHING_TO_PLAY
    server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
    val emptyError = assertThrows(LoggeRythmVoiceException::class.java) {
      client.resolveRadio(origin, "sf_session=radio-cookie", null, null)
    }
    assertEquals(LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY, emptyError.code)
  }
}
