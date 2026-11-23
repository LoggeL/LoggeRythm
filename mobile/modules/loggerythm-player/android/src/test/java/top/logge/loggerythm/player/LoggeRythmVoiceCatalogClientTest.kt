package top.logge.loggerythm.player

import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmVoiceCatalogClientTest {
  @Test
  fun searchTracksForBrowseSendsCookieDeduplicatesAndBuildsPhoneCompatibleExtras() {
    withTlsServer { server, origin, client ->
      val body = JSONArray()
        .put(
          trackJson(
            id = "3135556",
            title = "Harder, Better, Faster, Stronger",
            artist = "Daft Punk",
            album = "Discovery",
            cover = "/api/cover/3135556.jpg",
            loudnessGainDb = -6.0,
            loudnessLufs = -8.0,
            loudnessPeak = 0.9,
          ),
        )
        .put(
          // Duplicate Deezer ID must be collapsed to one item.
          trackJson(
            id = "3135556",
            title = "Harder, Better, Faster, Stronger (Duplicate)",
            artist = "Daft Punk",
            album = "Discovery",
            cover = "https://cdn.example.test/dup.jpg",
          ),
        )
        .put(
          trackJson(
            id = "3135557",
            title = "Aerodynamic",
            artist = "Daft Punk",
            album = "Discovery",
            // Cleartext HTTP cover must never pass through as an HTTPS artwork URI.
            cover = "http://insecure.example.test/cover.jpg",
          ),
        )
        .toString()
      server.enqueue(MockResponse().setResponseCode(200).setBody(body))

      val items = client.searchTracksForBrowse(
        origin = origin,
        cookie = "sf_session=secret-cookie",
        query = "Daft Punk",
        limit = 10,
        mediaIdPrefix = "voice:search:1",
      )

      val request = server.takeRequest(1, TimeUnit.SECONDS)
      assertEquals("/api/search?q=Daft+Punk&type=track", request?.path)
      assertEquals("sf_session=secret-cookie", request?.getHeader("Cookie"))
      assertEquals("application/json", request?.getHeader("Accept"))

      assertEquals(2, items.size)
      val first = items[0]
      assertEquals("voice:search:1:0:3135556", first.id)
      assertEquals("$origin/api/tracks/3135556/stream", first.url)
      assertEquals("sf_session=secret-cookie", first.cookie)
      assertEquals("$origin/api/cover/3135556.jpg", first.artworkUrl)
      assertEquals(224_000L, first.durationMs)
      assertTrue(LoggeRythmCarLibraryState.hasPhoneTrackMetadata(first.extrasJson))

      val extras = JSONObject(first.extrasJson)
      assertEquals("3135556", extras.getJSONObject("track").getString("id"))
      assertEquals(false, extras.getBoolean("radio"))
      assertEquals(false, extras.getBoolean("explicitDownload"))
      val loudness = extras.getJSONObject("loudnessNormalization")
      assertEquals("metadata", loudness.getString("source"))
      assertEquals(-6.0, loudness.getDouble("gainDb"), 0.001)

      val second = items[1]
      assertEquals("voice:search:1:1:3135557", second.id)
      assertNull(second.artworkUrl)
      assertTrue(LoggeRythmCarLibraryState.hasPhoneTrackMetadata(second.extrasJson))
      assertEquals(
        "none",
        JSONObject(second.extrasJson).getJSONObject("loudnessNormalization").getString("source"),
      )
    }
  }

  @Test
  fun resolveForPlaybackTrackFocusRanksStructuredTitleAndArtistFirst() {
    withTlsServer { server, origin, client ->
      val body = JSONArray()
        .put(
          trackJson(
            id = "100",
            title = "Around the World (Acoustic Cover)",
            artist = "Cover Band",
            album = "Covers",
          ),
        )
        .put(
          trackJson(
            id = "200",
            title = "Around the World",
            artist = "Daft Punk",
            album = "Homework",
          ),
        )
        .toString()
      server.enqueue(MockResponse().setResponseCode(200).setBody(body))

      val selection = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "",
          mediaFocus = LoggeRythmVoiceMediaFocus.TRACK,
          title = "Around the World",
          artist = "Daft Punk",
        ),
      )

      assertEquals("Around the World", selection.matchedTitle)
      assertEquals(0, selection.startIndex)
      assertEquals(2, selection.items.size)
      assertEquals("$origin/api/tracks/200/stream", selection.items[0].url)
      assertEquals("$origin/api/tracks/100/stream", selection.items[1].url)
    }
  }

  @Test
  fun resolveForPlaybackAlbumFocusFetchesAlbumDetailAndStartsAtRequestedTitle() {
    withTlsServer { server, origin, client ->
      val searchBody = JSONArray()
        .put(
          trackJson(
            id = "302127",
            title = "Discovery",
            artist = "Daft Punk",
            album = "Discovery",
            albumId = "302127",
          ),
        )
        .toString()
      val detailBody = JSONObject()
        .put("id", "302127")
        .put("title", "Discovery")
        .put(
          "tracks",
          JSONArray()
            .put(trackJson(id = "3135553", title = "One More Time", artist = "Daft Punk", album = "Discovery"))
            .put(trackJson(id = "3135555", title = "Digital Love", artist = "Daft Punk", album = "Discovery")),
        )
        .toString()
      server.enqueue(MockResponse().setResponseCode(200).setBody(searchBody))
      server.enqueue(MockResponse().setResponseCode(200).setBody(detailBody))

      val selection = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "",
          mediaFocus = LoggeRythmVoiceMediaFocus.ALBUM,
          album = "Discovery",
          artist = "Daft Punk",
          title = "Digital Love",
        ),
      )

      assertEquals("/api/search?q=Discovery+Daft+Punk&type=album", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("/api/albums/302127", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("Discovery", selection.matchedTitle)
      assertEquals(1, selection.startIndex)
      assertEquals(2, selection.items.size)
      assertEquals("Digital Love", selection.items[selection.startIndex].title)
    }
  }

  @Test
  fun resolveForPlaybackArtistFocusUsesTopTracksAndFallsBackToFirstAlbumWhenTopEmpty() {
    withTlsServer { server, origin, client ->
      // Case 1: top tracks available
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(JSONObject().put("id", "27").put("name", "Daft Punk")).toString(),
        ),
      )
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", "27")
            .put("name", "Daft Punk")
            .put("top", JSONArray().put(trackJson(id = "3135553", title = "One More Time", artist = "Daft Punk", album = "Discovery")))
            .put("albums", JSONArray())
            .toString(),
        ),
      )

      val topSelection = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "",
          mediaFocus = LoggeRythmVoiceMediaFocus.ARTIST,
          artist = "Daft Punk",
        ),
      )
      assertEquals("Daft Punk", topSelection.matchedTitle)
      assertEquals(1, topSelection.items.size)
      assertEquals("One More Time", topSelection.items[0].title)

      // Case 2: empty top tracks -> falls back cleanly to artist's first album
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(JSONObject().put("id", "28").put("name", "Justice")).toString(),
        ),
      )
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", "28")
            .put("name", "Justice")
            .put("top", JSONArray())
            .put("albums", JSONArray().put(JSONObject().put("id", "9001").put("title", "Cross")))
            .toString(),
        ),
      )
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", "9001")
            .put("title", "Cross")
            .put("tracks", JSONArray().put(trackJson(id = "90011", title = "Genesis", artist = "Justice", album = "Cross")))
            .toString(),
        ),
      )

      val albumFallback = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "Justice",
          mediaFocus = LoggeRythmVoiceMediaFocus.ARTIST,
        ),
      )
      assertEquals("Justice", albumFallback.matchedTitle)
      assertEquals("Genesis", albumFallback.items.single().title)
    }
  }

  @Test
  fun resolveForPlaybackPlaylistFocusChecksOwnPlaylistsBeforeDeezerCatalog() {
    withTlsServer { server, origin, client ->
      // Case 1: user's own playlist matches -> does not hit /api/search/playlist
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(JSONObject().put("id", 42).put("name", "Workout Mix")).toString(),
        ),
      )
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", 42)
            .put("name", "Workout Mix")
            .put("tracks", JSONArray().put(trackJson(id = "501", title = "Pump It", artist = "Band", album = "Gym")))
            .toString(),
        ),
      )

      val own = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "",
          mediaFocus = LoggeRythmVoiceMediaFocus.PLAYLIST,
          playlist = "Workout Mix",
        ),
      )
      assertEquals("/api/playlists", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("/api/playlists/42", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("Workout Mix", own.matchedTitle)
      assertEquals("Pump It", own.items.single().title)

      // Case 2: own playlists do not match -> searches Deezer catalog playlists (release_date optional)
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(JSONObject().put("id", "908622995").put("title", "Synthwave Classics")).toString(),
        ),
      )
      val deezerTrackWithoutReleaseDate = trackJson(
        id = "777",
        title = "Nightcall",
        artist = "Kavinsky",
        album = "OutRun",
      ).apply { remove("release_date") }
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", "908622995")
            .put("name", "Synthwave Classics")
            .put("tracks", JSONArray().put(deezerTrackWithoutReleaseDate))
            .toString(),
        ),
      )

      val catalog = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(
          rawQuery = "",
          mediaFocus = LoggeRythmVoiceMediaFocus.PLAYLIST,
          playlist = "Synthwave",
        ),
      )
      assertEquals("/api/playlists", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("/api/search/playlist?q=Synthwave", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("/api/deezer-playlist/908622995", server.takeRequest(1, TimeUnit.SECONDS)?.path)
      assertEquals("Synthwave Classics", catalog.matchedTitle)
      assertEquals("Nightcall", catalog.items.single().title)
      assertTrue(LoggeRythmCarLibraryState.hasPhoneTrackMetadata(catalog.items.single().extrasJson))
    }
  }

  @Test
  fun resolveForPlaybackAnyFocusFallsThroughEmptyResultsAndFailsLoudlyOnNoMatch() {
    withTlsServer { server, origin, client ->
      // Track empty -> Artist empty -> Playlist matches
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(JSONObject().put("id", "555").put("title", "Focus Beats")).toString(),
        ),
      )
      server.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONObject()
            .put("id", "555")
            .put("name", "Focus Beats")
            .put("tracks", JSONArray().put(trackJson(id = "5551", title = "Deep Study", artist = "LoFi", album = "Calm")))
            .toString(),
        ),
      )

      val playlistHit = client.resolveForPlayback(
        origin = origin,
        cookie = "sf_session=ok",
        request = LoggeRythmVoiceQuery(rawQuery = "Focus Beats"),
      )
      assertEquals("Focus Beats", playlistHit.matchedTitle)
      assertEquals("Deep Study", playlistHit.items.single().title)

      // All three return [] -> explicit SEARCH_NO_MATCH (never silent empty selection)
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      val noMatch = assertThrows(LoggeRythmVoiceException::class.java) {
        client.resolveForPlayback(
          origin = origin,
          cookie = "sf_session=ok",
          request = LoggeRythmVoiceQuery(rawQuery = "completely unknown zzz"),
        )
      }
      assertEquals(LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH, noMatch.code)
    }
  }

  @Test
  fun authErrorsRedirectsServerErrorsAndMalformedPayloadsFailLoudlyWithoutFallback() {
    val cert = HeldCertificate.Builder()
      .commonName("localhost")
      .addSubjectAlternativeName("localhost")
      .build()
    val serverCerts = HandshakeCertificates.Builder().heldCertificate(cert).build()
    val clientCerts = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
    val originServer = MockWebServer()
    val redirectTarget = MockWebServer()
    originServer.useHttps(serverCerts.sslSocketFactory(), false)
    redirectTarget.useHttps(serverCerts.sslSocketFactory(), false)
    originServer.start()
    redirectTarget.start()
    try {
      val origin = "https://localhost:${originServer.port}"
      val client = LoggeRythmVoiceCatalogClient(
        failClosedMediaHttpClient {
          sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager)
        },
      )

      // 401 -> AUTH_REQUIRED
      originServer.enqueue(MockResponse().setResponseCode(401).setBody("""{"detail":"expired"}"""))
      val unauth = assertThrows(LoggeRythmVoiceException::class.java) {
        client.searchTracksForBrowse(origin, "sf_session=expired", "daft punk")
      }
      assertEquals(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, unauth.code)

      // 403 -> AUTH_REQUIRED
      originServer.enqueue(MockResponse().setResponseCode(403).setBody("""{"detail":"forbidden"}"""))
      val forbidden = assertThrows(LoggeRythmVoiceException::class.java) {
        client.resolveForPlayback(origin, "sf_session=expired", LoggeRythmVoiceQuery("daft punk"))
      }
      assertEquals(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, forbidden.code)

      // 302 redirect -> NETWORK_ERROR and target host receives ZERO requests (no Cookie leak!)
      originServer.enqueue(
        MockResponse().setResponseCode(302).setHeader("Location", redirectTarget.url("/steal")),
      )
      redirectTarget.enqueue(MockResponse().setResponseCode(200).setBody("[]"))
      val redirectErr = assertThrows(LoggeRythmVoiceException::class.java) {
        client.searchTracksForBrowse(origin, "sf_session=private", "daft punk")
      }
      assertEquals(LoggeRythmVoiceErrorCode.NETWORK_ERROR, redirectErr.code)
      assertNull(redirectTarget.takeRequest(250, TimeUnit.MILLISECONDS))

      // 500 -> NETWORK_ERROR (must NEVER be downgraded to empty search results)
      originServer.enqueue(MockResponse().setResponseCode(500).setBody("internal error"))
      val serverErr = assertThrows(LoggeRythmVoiceException::class.java) {
        client.resolveForPlayback(origin, "sf_session=ok", LoggeRythmVoiceQuery("daft punk"))
      }
      assertEquals(LoggeRythmVoiceErrorCode.NETWORK_ERROR, serverErr.code)

      // Malformed JSON -> NETWORK_ERROR
      originServer.enqueue(MockResponse().setResponseCode(200).setBody("{not-valid-json"))
      val jsonErr = assertThrows(LoggeRythmVoiceException::class.java) {
        client.searchTracksForBrowse(origin, "sf_session=ok", "daft punk")
      }
      assertEquals(LoggeRythmVoiceErrorCode.NETWORK_ERROR, jsonErr.code)

      // Invalid track ID shape -> NETWORK_ERROR
      originServer.enqueue(
        MockResponse().setResponseCode(200).setBody(
          JSONArray().put(trackJson(id = "not-numeric", title = "Bad", artist = "X", album = "Y")).toString(),
        ),
      )
      val idErr = assertThrows(LoggeRythmVoiceException::class.java) {
        client.searchTracksForBrowse(origin, "sf_session=ok", "bad")
      }
      assertEquals(LoggeRythmVoiceErrorCode.NETWORK_ERROR, idErr.code)

      // Non-HTTPS origin or blank cookie -> AUTH_REQUIRED before any network request
      assertEquals(
        LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
        assertThrows(LoggeRythmVoiceException::class.java) {
          client.searchTracksForBrowse("http://localhost:${originServer.port}", "sf_session=ok", "x")
        }.code,
      )
      assertEquals(
        LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
        assertThrows(LoggeRythmVoiceException::class.java) {
          client.searchTracksForBrowse(origin, "   ", "x")
        }.code,
      )
    } finally {
      originServer.shutdown()
      redirectTarget.shutdown()
    }
  }

  private fun withTlsServer(block: (MockWebServer, String, LoggeRythmVoiceCatalogClient) -> Unit) {
    val cert = HeldCertificate.Builder()
      .commonName("localhost")
      .addSubjectAlternativeName("localhost")
      .build()
    val serverCerts = HandshakeCertificates.Builder().heldCertificate(cert).build()
    val clientCerts = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
    val server = MockWebServer()
    server.useHttps(serverCerts.sslSocketFactory(), false)
    server.start()
    try {
      val origin = "https://localhost:${server.port}"
      val client = LoggeRythmVoiceCatalogClient(
        failClosedMediaHttpClient {
          sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager)
        },
      )
      block(server, origin, client)
    } finally {
      server.shutdown()
    }
  }

  private fun trackJson(
    id: String,
    title: String,
    artist: String,
    album: String,
    albumId: String = "1001",
    cover: String = "https://cdn.example.test/cover.jpg",
    loudnessGainDb: Double? = null,
    loudnessLufs: Double? = null,
    loudnessPeak: Double? = null,
  ): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("artist", artist)
    put("artist_id", 27)
    put("artists", JSONArray().put(JSONObject().put("id", 27).put("name", artist)))
    put("album", album)
    put("album_id", albumId)
    put("cover", cover)
    put("duration_sec", 224.0)
    put("preview_url", JSONObject.NULL)
    put("rank", 850000)
    put("release_date", "2001-03-12")
    if (loudnessGainDb != null) put("loudness_gain_db", loudnessGainDb)
    if (loudnessLufs != null) put("loudness_lufs", loudnessLufs)
    if (loudnessPeak != null) put("loudness_peak", loudnessPeak)
  }
}
