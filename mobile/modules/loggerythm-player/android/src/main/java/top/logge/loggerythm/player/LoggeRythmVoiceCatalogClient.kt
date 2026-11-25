package top.logge.loggerythm.player

import android.os.Bundle
import android.provider.MediaStore
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import kotlin.math.log10
import kotlin.math.pow
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Structured voice query parsed from Media3 `RequestMetadata` extras or [LoggeRythmVoiceBridge]. */
internal data class LoggeRythmVoiceQuery(
  val rawQuery: String,
  val mediaFocus: LoggeRythmVoiceMediaFocus = LoggeRythmVoiceMediaFocus.ANY,
  val artist: String? = null,
  val album: String? = null,
  val title: String? = null,
  val playlist: String? = null,
) {
  fun isBlank(): Boolean =
    rawQuery.isBlank() &&
      artist.isNullOrBlank() &&
      album.isNullOrBlank() &&
      title.isNullOrBlank() &&
      playlist.isNullOrBlank()

  fun effectiveQuery(): String {
    val trimmed = rawQuery.trim()
    if (trimmed.isNotEmpty()) return trimmed
    return listOfNotNull(
      playlist?.trim()?.takeIf(String::isNotEmpty),
      title?.trim()?.takeIf(String::isNotEmpty),
      album?.trim()?.takeIf(String::isNotEmpty),
      artist?.trim()?.takeIf(String::isNotEmpty),
    ).joinToString(" ")
  }

  companion object {
    @Suppress("DEPRECATION")
    private val PLAYLIST_FOCUS_MIME = MediaStore.Audio.Playlists.ENTRY_CONTENT_TYPE
    private const val ARTIST_FOCUS_MIME = MediaStore.Audio.Artists.ENTRY_CONTENT_TYPE
    private const val ALBUM_FOCUS_MIME = MediaStore.Audio.Albums.ENTRY_CONTENT_TYPE
    private const val TRACK_FOCUS_MIME = MediaStore.Audio.Media.ENTRY_CONTENT_TYPE

    fun inferFocus(
      artist: String?,
      album: String?,
      title: String?,
      playlist: String?,
    ): LoggeRythmVoiceMediaFocus = when {
      !playlist.isNullOrBlank() -> LoggeRythmVoiceMediaFocus.PLAYLIST
      !title.isNullOrBlank() -> LoggeRythmVoiceMediaFocus.TRACK
      !album.isNullOrBlank() -> LoggeRythmVoiceMediaFocus.ALBUM
      !artist.isNullOrBlank() -> LoggeRythmVoiceMediaFocus.ARTIST
      else -> LoggeRythmVoiceMediaFocus.ANY
    }

    @Suppress("DEPRECATION")
    fun fromMedia3(searchQuery: String?, extras: Bundle?): LoggeRythmVoiceQuery {
      val artist = extras?.getString(MediaStore.EXTRA_MEDIA_ARTIST)?.trim()?.takeIf(String::isNotEmpty)
      val album = extras?.getString(MediaStore.EXTRA_MEDIA_ALBUM)?.trim()?.takeIf(String::isNotEmpty)
      val title = extras?.getString(MediaStore.EXTRA_MEDIA_TITLE)?.trim()?.takeIf(String::isNotEmpty)
      val playlist = extras?.getString(MediaStore.EXTRA_MEDIA_PLAYLIST)?.trim()?.takeIf(String::isNotEmpty)
      val rawFocus = extras?.getString(MediaStore.EXTRA_MEDIA_FOCUS)?.trim()
      val focus = when (rawFocus) {
        PLAYLIST_FOCUS_MIME, "vnd.android.cursor.item/playlist" -> LoggeRythmVoiceMediaFocus.PLAYLIST
        ALBUM_FOCUS_MIME, "vnd.android.cursor.item/album" -> LoggeRythmVoiceMediaFocus.ALBUM
        ARTIST_FOCUS_MIME, "vnd.android.cursor.item/artist" -> LoggeRythmVoiceMediaFocus.ARTIST
        TRACK_FOCUS_MIME, "vnd.android.cursor.item/audio" -> LoggeRythmVoiceMediaFocus.TRACK
        else -> inferFocus(artist = artist, album = album, title = title, playlist = playlist)
      }
      return LoggeRythmVoiceQuery(
        rawQuery = searchQuery?.trim().orEmpty(),
        mediaFocus = focus,
        artist = artist,
        album = album,
        title = title,
        playlist = playlist,
      )
    }
  }
}

internal data class LoggeRythmVoiceCatalogSelection(
  val matchedTitle: String,
  val items: List<PlayerItemSpec>,
  val startIndex: Int = 0,
) {
  override fun toString(): String =
    "LoggeRythmVoiceCatalogSelection(matchedTitle=<redacted>, items=<redacted:${items.size}>, startIndex=$startIndex)"
}

internal data class LoggeRythmVoiceCatalogArtistRef(
  val id: Any,
  val name: String,
)

internal data class LoggeRythmVoiceCatalogTrack(
  val id: String,
  val title: String,
  val artist: String,
  val artistId: Any,
  val artists: List<LoggeRythmVoiceCatalogArtistRef>,
  val album: String,
  val albumId: Any,
  val cover: String,
  val durationSec: Double,
  val previewUrl: String?,
  val rank: Double,
  val releaseDate: String,
  val loudnessGainDb: Double?,
  val loudnessLufs: Double?,
  val loudnessPeak: Double?,
)

/**
 * Authenticated, fail-closed native HTTP client for LoggeRythm backend v2 catalog search.
 *
 * Uses [failClosedMediaHttpClient] (redirects disabled so the vaulted session Cookie can never be
 * replayed to a redirected host), validates every response strictly against the v2 wire contract,
 * and maps every auth/network/empty-result condition to an explicit [LoggeRythmVoiceException].
 */
internal class LoggeRythmVoiceCatalogClient(
  private val httpClient: OkHttpClient = defaultHttpClient(),
) {
  fun searchTracksForBrowse(
    origin: String,
    cookie: String,
    query: String,
    limit: Int = MAX_BROWSE_SEARCH_RESULTS,
    mediaIdPrefix: String = "voice:search",
  ): List<PlayerItemSpec> {
    requireOriginAndCookie(origin, cookie)
    require(limit > 0) { "search-limit-invalid" }
    val trimmed = query.trim()
    if (trimmed.isEmpty()) return emptyList()
    val encoded = urlEncode(trimmed)
    val tracks = fetchTrackArray(origin, cookie, "/api/search?q=$encoded&type=track")
    val deduplicated = deduplicateTracksById(tracks).take(limit.coerceAtMost(MAX_BROWSE_SEARCH_RESULTS))
    return deduplicated.mapIndexed { index, track ->
      toPlayerItemSpec(track, origin, cookie, mediaIdPrefix, index)
    }
  }

  fun resolveForPlayback(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String = "voice:play",
  ): LoggeRythmVoiceCatalogSelection {
    requireOriginAndCookie(origin, cookie)
    if (request.isBlank()) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
        "catalog-query-blank",
      )
    }
    return when (request.mediaFocus) {
      LoggeRythmVoiceMediaFocus.PLAYLIST -> resolvePlaylist(origin, cookie, request, mediaIdPrefix)
      LoggeRythmVoiceMediaFocus.ALBUM -> resolveAlbum(origin, cookie, request, mediaIdPrefix)
      LoggeRythmVoiceMediaFocus.ARTIST -> resolveArtist(origin, cookie, request, mediaIdPrefix)
      LoggeRythmVoiceMediaFocus.TRACK -> resolveTrack(origin, cookie, request, mediaIdPrefix)
      LoggeRythmVoiceMediaFocus.ANY -> resolveAny(origin, cookie, request, mediaIdPrefix)
    }
  }

  /**
   * Starts endless radio from either a specific mood/genre tag (`/api/home/mood/{tag}`), an
   * active/liked seed track (`/api/radio/{trackId}`), or the user's personalized mixes
   * (`/api/home/mixes`). Every item is tagged `"radio": true` so native auto-refill triggers.
   */
  fun resolveRadio(
    origin: String,
    cookie: String,
    moodOrGenre: String?,
    seedTrackId: String?,
    mediaIdPrefix: String = "voice:radio",
  ): LoggeRythmVoiceCatalogSelection {
    requireOriginAndCookie(origin, cookie)
    val cleanMood = moodOrGenre?.trim()?.takeIf(String::isNotEmpty)
    if (cleanMood != null) {
      val slug = urlEncode(cleanMood.lowercase(java.util.Locale.ROOT))
      val tracks = deduplicateTracksById(
        fetchTrackArray(origin, cookie, "/api/home/mood/$slug"),
      ).take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isEmpty()) {
        throw LoggeRythmVoiceException(
          LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
          "radio-mood-no-match",
        )
      }
      return selectionOf(
        matchedTitle = cleanMood,
        tracks = tracks,
        origin = origin,
        cookie = cookie,
        mediaIdPrefix = "$mediaIdPrefix:mood",
        radio = true,
      )
    }

    val validSeed = seedTrackId?.trim()?.takeIf(DEEZER_ID_PATTERN::matches)
    if (validSeed != null) {
      val tracks = deduplicateTracksById(
        fetchTrackArray(origin, cookie, "/api/radio/$validSeed"),
      ).take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isNotEmpty()) {
        return selectionOf(
          matchedTitle = "Personal Radio",
          tracks = tracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:seed:$validSeed",
          radio = true,
        )
      }
    }

    val shelves = executeJsonArray(origin, cookie, "/api/home/mixes")
    for (index in 0 until shelves.length()) {
      val shelf = shelves.optJSONObject(index) ?: continue
      val rawTracks = shelf.optJSONArray("tracks") ?: continue
      val decoded = mutableListOf<LoggeRythmVoiceCatalogTrack>()
      for (t in 0 until rawTracks.length()) {
        val obj = rawTracks.optJSONObject(t) ?: throw invalidPayload("mix-track-not-object")
        decoded += decodeTrack(obj, allowMissingReleaseDate = true)
      }
      val tracks = deduplicateTracksById(decoded).take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isNotEmpty()) {
        val title = shelf.optString("title", "").trim().ifEmpty { "Personal Radio" }
        return selectionOf(
          matchedTitle = title,
          tracks = tracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:mix",
          radio = true,
        )
      }
    }

    throw LoggeRythmVoiceException(
      LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY,
      "radio-no-tracks",
    )
  }

  private fun resolvePlaylist(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String,
  ): LoggeRythmVoiceCatalogSelection {
    val targetQuery = request.playlist?.takeIf(String::isNotBlank) ?: request.effectiveQuery()
    // 1. User's own playlists first (authenticated /api/playlists)
    val ownPlaylists = fetchOwnPlaylistSummaries(origin, cookie)
    val bestOwn = bestRanked(ownPlaylists, targetQuery) { it.name }
    if (bestOwn != null) {
      val detail = fetchOwnPlaylistDetail(origin, cookie, bestOwn.id)
      val tracks = deduplicateTracksById(detail.tracks).take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isNotEmpty()) {
        return selectionOf(detail.name, tracks, origin, cookie, "$mediaIdPrefix:pl:${detail.id}")
      }
    }
    // 2. Public Deezer catalog playlists (/api/search/playlist + /api/deezer-playlist/{id})
    val catalogPlaylists = fetchCatalogPlaylistResults(origin, cookie, targetQuery)
    val bestCatalog = bestRanked(catalogPlaylists, targetQuery) { it.title }
      ?: catalogPlaylists.firstOrNull()
    if (bestCatalog != null) {
      val detail = fetchDeezerPlaylistDetail(origin, cookie, bestCatalog.id)
      val tracks = deduplicateTracksById(detail.tracks).take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isNotEmpty()) {
        return selectionOf(detail.name, tracks, origin, cookie, "$mediaIdPrefix:dpl:${detail.id}")
      }
    }
    throw LoggeRythmVoiceException(
      LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
      "catalog-playlist-no-match",
    )
  }

  private fun resolveAlbum(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String,
  ): LoggeRythmVoiceCatalogSelection {
    val albumTerm = request.album?.takeIf(String::isNotBlank) ?: request.effectiveQuery()
    val searchTerm = listOfNotNull(albumTerm, request.artist?.takeIf(String::isNotBlank))
      .joinToString(" ")
    val rawAlbums = fetchTrackArray(origin, cookie, "/api/search?q=${urlEncode(searchTerm)}&type=album")
    val candidates = rawAlbums.mapNotNull { item ->
      val albumId = nonEmptyDeezerId(item.albumId) ?: item.id.takeIf(DEEZER_ID_PATTERN::matches)
      val albumTitle = item.album.trim().ifEmpty { item.title.trim() }
      if (albumId == null || albumTitle.isEmpty()) null
      else AlbumCandidate(id = albumId, title = albumTitle, artist = item.artist)
    }
    val best = bestRanked(candidates, albumTerm, secondaryQuery = request.artist) {
      it.title to it.artist
    } ?: candidates.firstOrNull()
    if (best != null) {
      val detail = fetchAlbumDetail(origin, cookie, best.id)
      val tracks = detail.tracks.take(MAX_VOICE_QUEUE_ITEMS)
      if (tracks.isNotEmpty()) {
        val startIndex = request.title?.takeIf(String::isNotBlank)?.let { wanted ->
          findTrackIndex(tracks, wanted)
        } ?: 0
        return selectionOf(
          matchedTitle = detail.title.ifBlank { best.title },
          tracks = tracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:alb:${detail.id}",
          startIndex = startIndex,
        )
      }
    }
    throw LoggeRythmVoiceException(
      LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
      "catalog-album-no-match",
    )
  }

  private fun resolveArtist(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String,
  ): LoggeRythmVoiceCatalogSelection {
    val artistTerm = request.artist?.takeIf(String::isNotBlank) ?: request.effectiveQuery()
    val artists = fetchArtistSummaries(origin, cookie, artistTerm)
    val best = bestRanked(artists, artistTerm) { it.name } ?: artists.firstOrNull()
    if (best != null) {
      val detail = fetchArtistDetail(origin, cookie, best.id)
      val topTracks = deduplicateTracksById(detail.top).take(MAX_VOICE_QUEUE_ITEMS)
      if (topTracks.isNotEmpty()) {
        return selectionOf(
          matchedTitle = detail.name.ifBlank { best.name },
          tracks = topTracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:art:${detail.id}",
        )
      }
      val firstAlbum = detail.firstAlbumId
      if (firstAlbum != null) {
        val albumDetail = fetchAlbumDetail(origin, cookie, firstAlbum)
        val albumTracks = albumDetail.tracks.take(MAX_VOICE_QUEUE_ITEMS)
        if (albumTracks.isNotEmpty()) {
          return selectionOf(
            matchedTitle = detail.name.ifBlank { best.name },
            tracks = albumTracks,
            origin = origin,
            cookie = cookie,
            mediaIdPrefix = "$mediaIdPrefix:art:${detail.id}",
          )
        }
      }
    }
    throw LoggeRythmVoiceException(
      LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
      "catalog-artist-no-match",
    )
  }

  private fun resolveTrack(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String,
  ): LoggeRythmVoiceCatalogSelection {
    val searchTerm = listOfNotNull(
      request.title?.takeIf(String::isNotBlank),
      request.artist?.takeIf(String::isNotBlank),
      request.album?.takeIf(String::isNotBlank),
    ).joinToString(" ").ifBlank { request.effectiveQuery() }
    val tracks = deduplicateTracksById(
      fetchTrackArray(origin, cookie, "/api/search?q=${urlEncode(searchTerm)}&type=track"),
    )
    if (tracks.isEmpty()) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
        "catalog-track-no-match",
      )
    }
    val ranked = rankTracks(tracks, request).take(MAX_VOICE_QUEUE_ITEMS)
    return selectionOf(
      matchedTitle = ranked.first().title,
      tracks = ranked,
      origin = origin,
      cookie = cookie,
      mediaIdPrefix = "$mediaIdPrefix:trk",
    )
  }

  private fun resolveAny(
    origin: String,
    cookie: String,
    request: LoggeRythmVoiceQuery,
    mediaIdPrefix: String,
  ): LoggeRythmVoiceCatalogSelection {
    val query = request.effectiveQuery()
    val tracks = deduplicateTracksById(
      fetchTrackArray(origin, cookie, "/api/search?q=${urlEncode(query)}&type=track"),
    )
    if (tracks.isNotEmpty()) {
      val ranked = rankTracks(tracks, request).take(MAX_VOICE_QUEUE_ITEMS)
      return selectionOf(
        matchedTitle = ranked.first().title,
        tracks = ranked,
        origin = origin,
        cookie = cookie,
        mediaIdPrefix = "$mediaIdPrefix:any",
      )
    }
    val artists = fetchArtistSummaries(origin, cookie, query)
    val bestArtist = bestRanked(artists, query) { it.name } ?: artists.firstOrNull()
    if (bestArtist != null) {
      val detail = fetchArtistDetail(origin, cookie, bestArtist.id)
      val topTracks = deduplicateTracksById(detail.top).take(MAX_VOICE_QUEUE_ITEMS)
      if (topTracks.isNotEmpty()) {
        return selectionOf(
          matchedTitle = detail.name.ifBlank { bestArtist.name },
          tracks = topTracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:art:${detail.id}",
        )
      }
    }
    val playlists = fetchCatalogPlaylistResults(origin, cookie, query)
    val bestPlaylist = bestRanked(playlists, query) { it.title } ?: playlists.firstOrNull()
    if (bestPlaylist != null) {
      val detail = fetchDeezerPlaylistDetail(origin, cookie, bestPlaylist.id)
      val plTracks = deduplicateTracksById(detail.tracks).take(MAX_VOICE_QUEUE_ITEMS)
      if (plTracks.isNotEmpty()) {
        return selectionOf(
          matchedTitle = detail.name,
          tracks = plTracks,
          origin = origin,
          cookie = cookie,
          mediaIdPrefix = "$mediaIdPrefix:dpl:${detail.id}",
        )
      }
    }
    throw LoggeRythmVoiceException(
      LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
      "catalog-search-no-match",
    )
  }

  private fun selectionOf(
    matchedTitle: String,
    tracks: List<LoggeRythmVoiceCatalogTrack>,
    origin: String,
    cookie: String,
    mediaIdPrefix: String,
    startIndex: Int = 0,
    radio: Boolean = false,
  ): LoggeRythmVoiceCatalogSelection {
    val specs = tracks.mapIndexed { index, track ->
      toPlayerItemSpec(track, origin, cookie, mediaIdPrefix, index, radio = radio)
    }
    return LoggeRythmVoiceCatalogSelection(
      matchedTitle = matchedTitle,
      items = specs,
      startIndex = startIndex.coerceIn(0, (specs.size - 1).coerceAtLeast(0)),
    )
  }

  private fun fetchTrackArray(
    origin: String,
    cookie: String,
    path: String,
  ): List<LoggeRythmVoiceCatalogTrack> {
    val array = executeJsonArray(origin, cookie, path)
    return List(array.length()) { index ->
      val item = array.optJSONObject(index)
        ?: throw invalidPayload("track-array-item-not-object")
      decodeTrack(item, allowMissingReleaseDate = false)
    }
  }

  private fun fetchAlbumDetail(
    origin: String,
    cookie: String,
    albumId: String,
  ): AlbumDetailData {
    val obj = executeJsonObject(origin, cookie, "/api/albums/${urlEncode(albumId)}")
    val id = requireDeezerId(obj, "id")
    val title = requireString(obj, "title")
    val rawTracks = obj.optJSONArray("tracks") ?: throw invalidPayload("album-tracks-missing")
    val tracks = List(rawTracks.length()) { index ->
      val item = rawTracks.optJSONObject(index)
        ?: throw invalidPayload("album-track-not-object")
      decodeTrack(item, allowMissingReleaseDate = false)
    }
    return AlbumDetailData(id = id, title = title, tracks = tracks)
  }

  private fun fetchArtistSummaries(
    origin: String,
    cookie: String,
    query: String,
  ): List<ArtistSummaryData> {
    val array = executeJsonArray(origin, cookie, "/api/search/artist?q=${urlEncode(query)}")
    return List(array.length()) { index ->
      val obj = array.optJSONObject(index) ?: throw invalidPayload("artist-summary-not-object")
      ArtistSummaryData(
        id = requireDeezerId(obj, "id"),
        name = requireString(obj, "name"),
      )
    }
  }

  private fun fetchArtistDetail(
    origin: String,
    cookie: String,
    artistId: String,
  ): ArtistDetailData {
    val obj = executeJsonObject(origin, cookie, "/api/artists/${urlEncode(artistId)}")
    val id = requireDeezerId(obj, "id")
    val name = requireString(obj, "name")
    val rawTop = obj.optJSONArray("top") ?: throw invalidPayload("artist-top-missing")
    val top = List(rawTop.length()) { index ->
      val item = rawTop.optJSONObject(index) ?: throw invalidPayload("artist-top-item-not-object")
      decodeTrack(item, allowMissingReleaseDate = false)
    }
    val rawAlbums = obj.optJSONArray("albums")
    val firstAlbumId = if (rawAlbums != null && rawAlbums.length() > 0) {
      rawAlbums.optJSONObject(0)?.optString("id")?.takeIf(DEEZER_ID_PATTERN::matches)
    } else {
      null
    }
    return ArtistDetailData(id = id, name = name, top = top, firstAlbumId = firstAlbumId)
  }

  private fun fetchOwnPlaylistSummaries(
    origin: String,
    cookie: String,
  ): List<OwnPlaylistSummary> {
    val array = executeJsonArray(origin, cookie, "/api/playlists")
    return List(array.length()) { index ->
      val obj = array.optJSONObject(index) ?: throw invalidPayload("playlist-summary-not-object")
      val id = obj.optLong("id", -1L)
      if (id < 0L) throw invalidPayload("playlist-summary-id-invalid")
      OwnPlaylistSummary(id = id, name = requireString(obj, "name"))
    }
  }

  private fun fetchOwnPlaylistDetail(
    origin: String,
    cookie: String,
    playlistId: Long,
  ): PlaylistDetailData {
    val obj = executeJsonObject(origin, cookie, "/api/playlists/$playlistId")
    val name = requireString(obj, "name")
    val rawTracks = obj.optJSONArray("tracks") ?: throw invalidPayload("playlist-tracks-missing")
    val tracks = List(rawTracks.length()) { index ->
      val item = rawTracks.optJSONObject(index)
        ?: throw invalidPayload("playlist-track-not-object")
      decodeTrack(item, allowMissingReleaseDate = false)
    }
    return PlaylistDetailData(id = playlistId.toString(), name = name, tracks = tracks)
  }

  private fun fetchCatalogPlaylistResults(
    origin: String,
    cookie: String,
    query: String,
  ): List<CatalogPlaylistSummary> {
    val array = executeJsonArray(origin, cookie, "/api/search/playlist?q=${urlEncode(query)}")
    return List(array.length()) { index ->
      val obj = array.optJSONObject(index)
        ?: throw invalidPayload("catalog-playlist-not-object")
      CatalogPlaylistSummary(
        id = requireDeezerId(obj, "id"),
        title = requireString(obj, "title"),
      )
    }
  }

  private fun fetchDeezerPlaylistDetail(
    origin: String,
    cookie: String,
    playlistId: String,
  ): PlaylistDetailData {
    val obj = executeJsonObject(origin, cookie, "/api/deezer-playlist/${urlEncode(playlistId)}")
    val id = requireDeezerId(obj, "id")
    val name = requireString(obj, "name")
    val rawTracks = obj.optJSONArray("tracks")
      ?: throw invalidPayload("deezer-playlist-tracks-missing")
    val tracks = List(rawTracks.length()) { index ->
      val item = rawTracks.optJSONObject(index)
        ?: throw invalidPayload("deezer-playlist-track-not-object")
      decodeTrack(item, allowMissingReleaseDate = true)
    }
    return PlaylistDetailData(id = id, name = name, tracks = tracks)
  }

  private fun executeJsonObject(origin: String, cookie: String, path: String): JSONObject {
    val body = executeGet(origin, cookie, path)
    return try {
      JSONObject(body)
    } catch (_: JSONException) {
      throw invalidPayload("json-object-invalid")
    }
  }

  private fun executeJsonArray(origin: String, cookie: String, path: String): JSONArray {
    val body = executeGet(origin, cookie, path)
    return try {
      JSONArray(body)
    } catch (_: JSONException) {
      throw invalidPayload("json-array-invalid")
    }
  }

  private fun executeGet(origin: String, cookie: String, path: String): String {
    require(path.startsWith("/api/")) { "catalog-path-invalid" }
    val request = Request.Builder()
      .url("$origin$path")
      .header("Accept", "application/json")
      .header("Cookie", cookie)
      .get()
      .build()
    try {
      httpClient.newCall(request).execute().use { response ->
        val code = response.code
        when {
          code == 401 || code == 403 -> throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
            "catalog-auth-required:$code",
          )
          code in 300..399 -> throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.NETWORK_ERROR,
            "catalog-redirect-rejected:$code",
          )
          code != 200 -> throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.NETWORK_ERROR,
            "catalog-http-error:$code",
          )
        }
        val body = response.body ?: throw invalidPayload("empty-response-body")
        val contentLength = body.contentLength()
        if (contentLength > MAX_RESPONSE_BYTES) {
          throw invalidPayload("response-too-large")
        }
        val bytes = body.byteStream().use { input ->
          val output = ByteArrayOutputStream()
          val chunk = ByteArray(8192)
          var total = 0L
          while (true) {
            val read = input.read(chunk)
            if (read == -1) break
            total += read
            if (total > MAX_RESPONSE_BYTES) throw invalidPayload("response-too-large")
            output.write(chunk, 0, read)
          }
          output.toByteArray()
        }
        if (bytes.isEmpty()) throw invalidPayload("empty-response-body")
        return String(bytes, StandardCharsets.UTF_8)
      }
    } catch (error: LoggeRythmVoiceException) {
      throw error
    } catch (error: IOException) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.NETWORK_ERROR,
        "catalog-network-error",
        error,
      )
    }
  }

  private fun decodeTrack(
    obj: JSONObject,
    allowMissingReleaseDate: Boolean,
  ): LoggeRythmVoiceCatalogTrack {
    val id = requireDeezerId(obj, "id")
    val title = requireString(obj, "title")
    val artist = requireString(obj, "artist")
    val artistId = requireReferenceId(obj, "artist_id")
    val rawArtists = obj.optJSONArray("artists") ?: throw invalidPayload("track-artists-missing")
    val artists = List(rawArtists.length()) { index ->
      val entry = rawArtists.optJSONObject(index) ?: throw invalidPayload("track-artist-not-object")
      LoggeRythmVoiceCatalogArtistRef(
        id = requireReferenceId(entry, "id"),
        name = requireString(entry, "name"),
      )
    }
    val album = requireString(obj, "album")
    val albumId = requireReferenceId(obj, "album_id")
    val cover = requireString(obj, "cover")
    val durationSec = requireFiniteDouble(obj, "duration_sec")
    val previewUrl = if (!obj.has("preview_url") || obj.isNull("preview_url")) {
      null
    } else {
      obj.opt("preview_url") as? String ?: throw invalidPayload("track-preview-url-invalid")
    }
    val rank = requireFiniteDouble(obj, "rank")
    val releaseDate = if (allowMissingReleaseDate && !obj.has("release_date")) {
      ""
    } else {
      requireString(obj, "release_date")
    }
    return LoggeRythmVoiceCatalogTrack(
      id = id,
      title = title,
      artist = artist,
      artistId = artistId,
      artists = artists,
      album = album,
      albumId = albumId,
      cover = cover,
      durationSec = durationSec,
      previewUrl = previewUrl,
      rank = rank,
      releaseDate = releaseDate,
      loudnessGainDb = optionalNullableFiniteDouble(obj, "loudness_gain_db"),
      loudnessLufs = optionalNullableFiniteDouble(obj, "loudness_lufs"),
      loudnessPeak = optionalNullableFiniteDouble(obj, "loudness_peak"),
    )
  }

  private fun rankTracks(
    tracks: List<LoggeRythmVoiceCatalogTrack>,
    request: LoggeRythmVoiceQuery,
  ): List<LoggeRythmVoiceCatalogTrack> {
    val targetTitle = request.title?.takeIf(String::isNotBlank)?.let(LoggeRythmLibrarySearch::normalize)
    val targetArtist = request.artist?.takeIf(String::isNotBlank)?.let(LoggeRythmLibrarySearch::normalize)
    val targetAlbum = request.album?.takeIf(String::isNotBlank)?.let(LoggeRythmLibrarySearch::normalize)
    val fullQuery = LoggeRythmLibrarySearch.normalize(request.effectiveQuery())
    val fullTokens = if (fullQuery.isEmpty()) emptyList() else fullQuery.split(' ')

    return tracks.mapIndexed { order, track ->
      val titleNorm = LoggeRythmLibrarySearch.normalize(track.title)
      val artistNorm = LoggeRythmLibrarySearch.normalize(trackArtistLabel(track))
      val albumNorm = LoggeRythmLibrarySearch.normalize(track.album)
      var score = 0
      if (targetTitle != null) {
        score += when {
          titleNorm == targetTitle -> 0
          titleNorm.startsWith(targetTitle) -> 1
          targetTitle.split(' ').all(titleNorm::contains) -> 2
          else -> 8
        }
      }
      if (targetArtist != null) {
        score += when {
          artistNorm == targetArtist -> 0
          artistNorm.startsWith(targetArtist) -> 1
          targetArtist.split(' ').all(artistNorm::contains) -> 2
          else -> 6
        }
      }
      if (targetAlbum != null) {
        score += when {
          albumNorm == targetAlbum -> 0
          targetAlbum.split(' ').all(albumNorm::contains) -> 2
          else -> 5
        }
      }
      if (targetTitle == null && targetArtist == null && targetAlbum == null && fullQuery.isNotEmpty()) {
        val haystack = "$titleNorm $artistNorm $albumNorm"
        score += when {
          titleNorm == fullQuery -> 0
          titleNorm.startsWith(fullQuery) -> 1
          fullTokens.all(titleNorm::contains) -> 2
          fullTokens.all(haystack::contains) -> 3
          else -> 6
        }
      }
      Triple(score, order, track)
    }
      .sortedWith(compareBy<Triple<Int, Int, LoggeRythmVoiceCatalogTrack>> { it.first }.thenBy { it.second })
      .map { it.third }
  }

  private fun <T> bestRanked(
    items: List<T>,
    primaryQuery: String,
    secondaryQuery: String? = null,
    primaryText: (T) -> Any,
  ): T? {
    val normPrimary = LoggeRythmLibrarySearch.normalize(primaryQuery)
    if (normPrimary.isEmpty() || items.isEmpty()) return null
    val primaryTokens = normPrimary.split(' ')
    val normSecondary = secondaryQuery?.takeIf(String::isNotBlank)?.let(LoggeRythmLibrarySearch::normalize)
    val secondaryTokens = normSecondary?.split(' ').orEmpty()

    return items.mapIndexedNotNull { order, item ->
      val extracted = primaryText(item)
      val (rawMain, rawAux) = when (extracted) {
        is Pair<*, *> -> extracted.first.toString() to extracted.second.toString()
        else -> extracted.toString() to ""
      }
      val main = LoggeRythmLibrarySearch.normalize(rawMain)
      val aux = LoggeRythmLibrarySearch.normalize(rawAux)
      val baseRank = when {
        main == normPrimary -> 0
        main.startsWith(normPrimary) -> 1
        primaryTokens.all(main::contains) -> 2
        primaryTokens.all("$main $aux"::contains) -> 3
        else -> return@mapIndexedNotNull null
      }
      val auxPenalty = if (secondaryTokens.isNotEmpty() && !secondaryTokens.all(aux::contains)) 4 else 0
      Triple(baseRank + auxPenalty, order, item)
    }
      .minWithOrNull(compareBy<Triple<Int, Int, T>> { it.first }.thenBy { it.second })
      ?.third
  }

  private fun findTrackIndex(tracks: List<LoggeRythmVoiceCatalogTrack>, titleQuery: String): Int {
    val norm = LoggeRythmLibrarySearch.normalize(titleQuery)
    if (norm.isEmpty()) return 0
    val tokens = norm.split(' ')
    tracks.indexOfFirst { LoggeRythmLibrarySearch.normalize(it.title) == norm }.let {
      if (it >= 0) return it
    }
    tracks.indexOfFirst { tokens.all(LoggeRythmLibrarySearch.normalize(it.title)::contains) }.let {
      if (it >= 0) return it
    }
    return 0
  }

  private fun deduplicateTracksById(
    tracks: List<LoggeRythmVoiceCatalogTrack>,
  ): List<LoggeRythmVoiceCatalogTrack> {
    val seen = linkedSetOf<String>()
    return tracks.filter { seen.add(it.id) }
  }

  private fun requireOriginAndCookie(origin: String, cookie: String) {
    val uri = try {
      URI(origin)
    } catch (_: Exception) {
      throw LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "catalog-origin-invalid")
    }
    if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) {
      throw LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "catalog-origin-invalid")
    }
    if (cookie.isBlank() || cookie.any { ch -> ch == '\r' || ch == '\n' }) {
      throw LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "catalog-cookie-invalid")
    }
  }

  private fun requireDeezerId(obj: JSONObject, key: String): String {
    val value = obj.opt(key) as? String ?: throw invalidPayload("$key-not-string")
    if (!DEEZER_ID_PATTERN.matches(value)) throw invalidPayload("$key-not-deezer-id")
    return value
  }

  private fun requireString(obj: JSONObject, key: String): String =
    obj.opt(key) as? String ?: throw invalidPayload("$key-not-string")

  private fun requireReferenceId(obj: JSONObject, key: String): Any {
    val value = obj.opt(key) ?: throw invalidPayload("$key-missing")
    return when (value) {
      "" -> ""
      is String -> {
        if (!DEEZER_ID_PATTERN.matches(value)) throw invalidPayload("$key-invalid")
        value
      }
      is Number -> {
        val number = value.toLong()
        if (number < 0L || value.toDouble() != number.toDouble()) {
          throw invalidPayload("$key-invalid")
        }
        number
      }
      else -> throw invalidPayload("$key-invalid")
    }
  }

  private fun requireFiniteDouble(obj: JSONObject, key: String): Double {
    val value = obj.opt(key) as? Number ?: throw invalidPayload("$key-not-number")
    val parsed = value.toDouble()
    if (!parsed.isFinite()) throw invalidPayload("$key-not-finite")
    return parsed
  }

  private fun optionalNullableFiniteDouble(obj: JSONObject, key: String): Double? {
    if (!obj.has(key) || obj.isNull(key)) return null
    val value = obj.opt(key) as? Number ?: throw invalidPayload("$key-not-number")
    val parsed = value.toDouble()
    if (!parsed.isFinite()) throw invalidPayload("$key-not-finite")
    return parsed
  }

  private fun nonEmptyDeezerId(value: Any): String? = when (value) {
    is String -> value.takeIf(DEEZER_ID_PATTERN::matches)
    is Number -> value.toLong().takeIf { it > 0L }?.toString()
    else -> null
  }

  private fun invalidPayload(reason: String): LoggeRythmVoiceException =
    LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.NETWORK_ERROR, "catalog-payload-invalid:$reason")

  private fun urlEncode(value: String): String =
    URLEncoder.encode(value, StandardCharsets.UTF_8.name())

  private data class AlbumCandidate(val id: String, val title: String, val artist: String)
  private data class AlbumDetailData(
    val id: String,
    val title: String,
    val tracks: List<LoggeRythmVoiceCatalogTrack>,
  )
  private data class ArtistSummaryData(val id: String, val name: String)
  private data class ArtistDetailData(
    val id: String,
    val name: String,
    val top: List<LoggeRythmVoiceCatalogTrack>,
    val firstAlbumId: String?,
  )
  private data class OwnPlaylistSummary(val id: Long, val name: String)
  private data class CatalogPlaylistSummary(val id: String, val title: String)
  private data class PlaylistDetailData(
    val id: String,
    val name: String,
    val tracks: List<LoggeRythmVoiceCatalogTrack>,
  )

  companion object {
    const val MAX_VOICE_QUEUE_ITEMS = 25
    const val MAX_BROWSE_SEARCH_RESULTS = 20
    private const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024L
    private const val CONNECT_TIMEOUT_SECONDS = 8L
    private const val READ_TIMEOUT_SECONDS = 10L
    private const val CALL_TIMEOUT_SECONDS = 12L
    private const val LOUDNESS_TARGET_LUFS = -14.0
    private const val MIN_LOUDNESS_GAIN_DB = -24.0
    private const val MAX_LOUDNESS_GAIN_DB = 0.0
    private val DEEZER_ID_PATTERN = Regex("[0-9]{1,32}")

    internal fun defaultHttpClient(): OkHttpClient = failClosedMediaHttpClient {
      connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }

    internal fun trackArtistLabel(track: LoggeRythmVoiceCatalogTrack): String {
      val names = track.artists.mapNotNull { it.name.trim().takeIf(String::isNotEmpty) }
      return if (names.isNotEmpty()) names.joinToString(", ") else track.artist
    }

    internal fun resolveHttpsArtworkUrl(raw: String, origin: String): String? {
      val trimmed = raw.trim()
      if (trimmed.isEmpty()) return null
      val candidate = when {
        trimmed.startsWith("https://") -> trimmed
        trimmed.startsWith("/") -> "$origin$trimmed"
        else -> return null
      }
      return try {
        val uri = URI(candidate)
        if (uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
          uri.toASCIIString()
        } else {
          null
        }
      } catch (_: Exception) {
        null
      }
    }

    internal fun toPlayerItemSpec(
      track: LoggeRythmVoiceCatalogTrack,
      origin: String,
      cookie: String,
      mediaIdPrefix: String,
      index: Int,
      radio: Boolean = false,
    ): PlayerItemSpec {
      val artistLabel = trackArtistLabel(track)
      val artworkUrl = resolveHttpsArtworkUrl(track.cover, origin)
      val durationMs = (track.durationSec * 1000.0).toLong().takeIf { it > 0L }
      val extrasJson = buildPhoneTrackExtrasJson(track, radio = radio)
      require(LoggeRythmCarLibraryState.hasPhoneTrackMetadata(extrasJson)) {
        "voice-track-extras-invalid"
      }
      return PlayerItemSpec(
        id = "$mediaIdPrefix:$index:${track.id}",
        url = "$origin/api/tracks/${track.id}/stream",
        title = track.title,
        artist = artistLabel,
        album = track.album.takeIf(String::isNotBlank),
        artworkUrl = artworkUrl,
        durationMs = durationMs,
        cookie = cookie,
        extrasJson = extrasJson,
      )
    }

    internal fun buildPhoneTrackExtrasJson(
      track: LoggeRythmVoiceCatalogTrack,
      radio: Boolean = false,
    ): String {
      val artistsJson = JSONArray().apply {
        track.artists.forEach { ref ->
          put(JSONObject().apply {
            put("id", ref.id)
            put("name", ref.name)
          })
        }
      }
      val trackJson = JSONObject().apply {
        put("id", track.id)
        put("title", track.title)
        put("artist", track.artist)
        put("artist_id", track.artistId)
        put("artists", artistsJson)
        put("album", track.album)
        put("album_id", track.albumId)
        put("cover", track.cover)
        put("duration_sec", track.durationSec)
        put("preview_url", track.previewUrl ?: JSONObject.NULL)
        put("rank", track.rank)
        put("release_date", track.releaseDate)
        track.loudnessGainDb?.let { put("loudness_gain_db", it) }
        track.loudnessLufs?.let { put("loudness_lufs", it) }
        track.loudnessPeak?.let { put("loudness_peak", it) }
      }
      val loudnessJson = calculateLoudnessJson(
        replayGainDb = track.loudnessGainDb,
        integratedLufs = track.loudnessLufs,
        peak = track.loudnessPeak,
      )
      return JSONObject().apply {
        put("track", trackJson)
        put("radio", radio)
        put("explicitDownload", false)
        put("loudnessNormalization", loudnessJson)
      }.toString()
    }

    private fun calculateLoudnessJson(
      replayGainDb: Double?,
      integratedLufs: Double?,
      peak: Double?,
    ): JSONObject {
      val rawGainDb = replayGainDb ?: integratedLufs?.let { LOUDNESS_TARGET_LUFS - it }
      if (rawGainDb == null || !rawGainDb.isFinite()) {
        return JSONObject().apply {
          put("targetLufs", LOUDNESS_TARGET_LUFS)
          put("gainDb", 0.0)
          put("gainLinear", 1.0)
          put("source", "none")
        }
      }
      val ceilingDb = if (peak == null || !peak.isFinite() || peak <= 0.0 || peak >= 1.0) {
        0.0
      } else {
        -20.0 * log10(peak)
      }
      val gainDb = rawGainDb.coerceIn(MIN_LOUDNESS_GAIN_DB, minOf(MAX_LOUDNESS_GAIN_DB, ceilingDb))
      val gainLinear = 10.0.pow(gainDb / 20.0)
      return JSONObject().apply {
        put("targetLufs", LOUDNESS_TARGET_LUFS)
        put("gainDb", gainDb)
        put("gainLinear", gainLinear)
        put("source", "metadata")
      }
    }
  }
}
