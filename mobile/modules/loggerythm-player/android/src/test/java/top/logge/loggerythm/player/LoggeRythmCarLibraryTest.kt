package top.logge.loggerythm.player

import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LoggeRythmCarLibraryTest {
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:77",
    origin = "https://music.example.test",
  )

  @Before
  fun setUp() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmPlayerRuntime.bindSession(binding)
  }

  @After
  fun tearDown() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
  }

  @Test
  fun onlyMedia3LegacyBrowserPlaceholderIsAFrameworkBootstrap() {
    assertEquals(
      LoggeRythmSessionLookup.FRAMEWORK_LEGACY_BROWSER_BOOTSTRAP,
      LoggeRythmSessionLookupPolicy.classify(
        uid = -1,
        packageName = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME,
        controllerVersion = MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION,
        trusted = false,
      ),
    )

    // Any Binder-attributed caller has a real UID and must pass controller admission.
    assertController(uid = 10_321, packageName = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME)
    // A trusted flag can only come from a real platform identity check.
    assertController(
      uid = -1,
      packageName = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME,
      trusted = true,
    )
    // Media3's media-button fallback (unknown UID, component package, Media3 version) is not the
    // browser bootstrap and keeps being rejected by admission.
    assertController(uid = -1, packageName = "top.logge.loggerythm", controllerVersion = 1_010_001)
    assertController(
      uid = -1,
      packageName = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME,
      controllerVersion = 1_010_001,
    )
    assertController(uid = -1, packageName = "com.google.android.projection.gearhead")
  }

  @Test
  fun rootAvailabilityDistinguishesSignedOutFromDiscardedColdRestore() {
    assertNull(LoggeRythmCarLibraryState.rootUnavailable(bound = true, coldRestoreFailed = true))
    assertEquals(
      LoggeRythmCarError.SIGNED_OUT,
      LoggeRythmCarLibraryState.rootUnavailable(bound = false, coldRestoreFailed = false),
    )
    assertEquals(
      LoggeRythmCarError.RESTORE_FAILED,
      LoggeRythmCarLibraryState.rootUnavailable(bound = false, coldRestoreFailed = true),
    )
  }

  @Test
  fun carErrorsUseExplicitMedia3CodesAndStableQueueAdmissionCodes() {
    // Media3 replicates only this code from library results to legacy hosts such as Android Auto.
    assertEquals(
      SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
      LoggeRythmCarError.SIGNED_OUT.sessionErrorCode,
    )
    assertEquals("player-session-not-ready", LoggeRythmCarError.SESSION_NOT_READY.code)
    assertEquals("player-cache-clearing", LoggeRythmCarError.CACHE_CLEARING.code)
    assertEquals("playback-event-queue-commit-active", LoggeRythmCarError.QUEUE_COMMIT_ACTIVE.code)
    assertEquals("media-item-not-available", LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE.code)
    assertEquals(
      LoggeRythmCarError.entries.size,
      LoggeRythmCarError.entries.map(LoggeRythmCarError::code).toSet().size,
    )
    LoggeRythmCarError.entries.forEach { error ->
      assertTrue(error.name, error.sessionErrorCode < 0)
    }
    val exception = LoggeRythmCarRequestException(LoggeRythmCarError.SEARCH_NO_MATCH, "query")
    assertEquals("car-search-no-match", exception.message)
    assertEquals("query", exception.messageArgument)
  }

  @Test
  fun pagingIsBoundedOverflowSafeAndEmptyBeyondTheEnd() {
    assertEquals(0..1, LoggeRythmBrowsePaging.range(size = 5, page = 0, pageSize = 2))
    assertEquals(4..4, LoggeRythmBrowsePaging.range(size = 5, page = 2, pageSize = 2))
    assertTrue(LoggeRythmBrowsePaging.range(size = 5, page = 3, pageSize = 2)!!.isEmpty())
    assertTrue(LoggeRythmBrowsePaging.range(size = 0, page = 0, pageSize = 1)!!.isEmpty())
    assertEquals(0..4, LoggeRythmBrowsePaging.range(size = 5, page = 0, pageSize = Int.MAX_VALUE))
    assertTrue(
      LoggeRythmBrowsePaging.range(size = 5, page = Int.MAX_VALUE, pageSize = Int.MAX_VALUE)!!
        .isEmpty(),
    )
    assertNull(LoggeRythmBrowsePaging.range(size = 5, page = -1, pageSize = 2))
    assertNull(LoggeRythmBrowsePaging.range(size = 5, page = 0, pageSize = 0))
  }

  @Test
  fun searchMatchesPublicMetadataAccentInsensitivelyAndDeduplicatesTracks() {
    val tree = LoggeRythmPlayerRuntime.installBrowseTree(libraryTree())

    assertEquals(
      listOf("liked:1:halo"),
      LoggeRythmLibrarySearch.search(tree, "HALO"),
    )
    // Artist match without accents; the same track in a playlist is shown once.
    assertEquals(
      listOf("liked:1:halo", "liked:2:formation"),
      LoggeRythmLibrarySearch.search(tree, "beyonce"),
    )
    // A title prefix ("Road Trip Song") ranks above a token match inside "Roadtrip"; containers
    // are results too, so the car can open a matching list.
    assertEquals(
      listOf("playlist:roadtrip:0:drive", "playlist:roadtrip"),
      LoggeRythmLibrarySearch.search(tree, "road trip"),
    )
    // An exact title wins.
    assertEquals(listOf("playlist:roadtrip"), LoggeRythmLibrarySearch.search(tree, "roadtrip"))
    assertTrue(LoggeRythmLibrarySearch.search(tree, "  !! ").isEmpty())
    assertTrue(LoggeRythmLibrarySearch.search(tree, "nothing like this").isEmpty())
    assertTrue(LoggeRythmLibrarySearch.search(tree, "LoggeRythm").none { it == tree.rootId })
    assertEquals(1, LoggeRythmLibrarySearch.search(tree, "a", limit = 1).size)
  }

  @Test
  fun voiceResolutionPrefersExactListsAndSongsAndSkipsUnplayableContainers() {
    val tree = LoggeRythmPlayerRuntime.installBrowseTree(libraryTree())

    assertEquals(
      LoggeRythmLibraryTarget.Container("playlist:roadtrip"),
      LoggeRythmLibrarySearch.resolvePlayRequest(tree, "Roadtrip", preferContainers = false),
    )
    assertEquals(
      LoggeRythmLibraryTarget.Leaf("liked:1:halo"),
      LoggeRythmLibrarySearch.resolvePlayRequest(tree, "halo beyoncé", preferContainers = false),
    )
    // "Focus" is both an empty playlist and a song title; the empty list is never a target.
    assertEquals(
      LoggeRythmLibraryTarget.Leaf("playlist:roadtrip:1:focus"),
      LoggeRythmLibrarySearch.resolvePlayRequest(tree, "focus", preferContainers = true),
    )
    assertNull(LoggeRythmLibrarySearch.resolvePlayRequest(tree, "zzz unknown", false))
    assertNull(LoggeRythmLibrarySearch.resolvePlayRequest(tree, " ", false))
    // Blank voice requests start the first list with directly playable children.
    assertEquals(
      LoggeRythmLibraryTarget.Container("library:liked"),
      LoggeRythmLibrarySearch.firstPlayableContainer(tree),
    )
  }

  @Test
  fun containerSelectionQueuesOnlyDirectlyPlayableChildrenFromTheStart() {
    LoggeRythmPlayerRuntime.installBrowseTree(libraryTree())

    val roadtrip = requireNotNull(LoggeRythmPlayerRuntime.playableBrowseChildren("playlist:roadtrip"))
    assertEquals(
      listOf("playlist:roadtrip:0:drive", "playlist:roadtrip:1:focus", "playlist:roadtrip:2:halo"),
      roadtrip.mediaItems.map { it.mediaId },
    )
    assertEquals(0, roadtrip.startIndex)
    assertNull(LoggeRythmPlayerRuntime.playableBrowseChildren(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID))
    assertNull(LoggeRythmPlayerRuntime.playableBrowseChildren("library:playlists"))
    assertNull(LoggeRythmPlayerRuntime.playableBrowseChildren("playlist:focus"))
    assertNull(LoggeRythmPlayerRuntime.playableBrowseChildren("liked:1:halo"))
    assertNull(LoggeRythmPlayerRuntime.playableBrowseChildren("unknown"))
  }

  @Test
  fun signedOutRuntimeHasNoPlayableTarget() {
    LoggeRythmPlayerRuntime.installBrowseTree(libraryTree())
    LoggeRythmPlayerRuntime.clearSessionAndAllData()

    val tree = LoggeRythmPlayerRuntime.browseTree()
    assertNull(LoggeRythmLibrarySearch.firstPlayableContainer(tree))
    assertTrue(LoggeRythmLibrarySearch.search(tree, "halo").isEmpty())
    assertNull(LoggeRythmPlayerRuntime.playableBrowseSiblings("liked:1:halo"))
  }

  private fun assertController(
    uid: Int,
    packageName: String,
    controllerVersion: Int = MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION,
    trusted: Boolean = false,
  ) {
    assertEquals(
      LoggeRythmSessionLookup.CONTROLLER,
      LoggeRythmSessionLookupPolicy.classify(uid, packageName, controllerVersion, trusted),
    )
  }

  private fun libraryTree() = BrowseTreeSpec(
    container(
      LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
      "LoggeRythm",
      listOf(
        container(
          "library:liked",
          "Liked Songs",
          listOf(
            track("liked:0:drive", "Drive", "Incubus", "Make Yourself"),
            track("liked:1:halo", "Halo", "Beyoncé", "I Am... Sasha Fierce"),
            track("liked:2:formation", "Formation", "Beyoncé", "Lemonade"),
          ),
        ),
        container(
          "library:playlists",
          "Playlists",
          listOf(
            container(
              "playlist:roadtrip",
              "Roadtrip",
              listOf(
                track("playlist:roadtrip:0:drive", "Road Trip Song", "Band", "Album"),
                track("playlist:roadtrip:1:focus", "Focus", "Ariana Grande", "Focus"),
                // Same public track as liked:1:halo under another parent.
                track("playlist:roadtrip:2:halo", "Halo", "Beyoncé", "I Am... Sasha Fierce"),
              ),
            ),
            container("playlist:focus", "Focus", emptyList()),
          ),
        ),
      ),
    ),
  )

  private fun container(id: String, title: String, children: List<BrowseNodeSpec>) =
    BrowseNodeSpec(
      id = id,
      title = title,
      subtitle = null,
      artist = null,
      album = null,
      artworkUrl = null,
      durationMs = null,
      playable = false,
      url = null,
      cookie = null,
      children = children,
    )

  private fun track(id: String, title: String, artist: String, album: String) = BrowseNodeSpec(
    id = id,
    title = title,
    subtitle = null,
    artist = artist,
    album = album,
    artworkUrl = null,
    durationMs = 200_000L,
    playable = true,
    url = "https://music.example.test/tracks/${id.substringAfterLast(':')}/stream",
    cookie = null,
    children = emptyList(),
  )
}
