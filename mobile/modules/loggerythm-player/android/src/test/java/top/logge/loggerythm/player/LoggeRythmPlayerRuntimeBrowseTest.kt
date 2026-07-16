package top.logge.loggerythm.player

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LoggeRythmPlayerRuntimeBrowseTest {
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:42",
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
  fun stableRootAndEmptyContainersRemainBrowsable() {
    val emptyCategory = container("library:empty", "Empty")
    val sourceTree = tree(emptyCategory)
    val installed = LoggeRythmPlayerRuntime.installBrowseTree(sourceTree)

    assertEquals(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID, installed.rootId)
    assertEquals(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID, installed.nodes.keys.first())
    assertTrue(installed.nodes.getValue(installed.rootId).mediaItem.mediaMetadata.isBrowsable == true)
    assertTrue(installed.nodes.getValue(emptyCategory.id).mediaItem.mediaMetadata.isBrowsable == true)
    assertFalse(installed.nodes.getValue(emptyCategory.id).mediaItem.mediaMetadata.isPlayable == true)
    assertEquals(sourceTree, LoggeRythmPlayerRuntime.persistedBrowseTree())

    val wrongRoot = tree(emptyCategory).copy(
      root = tree(emptyCategory).root.copy(id = "unstable-root"),
    )
    val error = assertThrows(PlayerProtocolException::class.java) {
      LoggeRythmPlayerRuntime.installBrowseTree(wrongRoot)
    }
    assertEquals("browse-root-id-invalid", error.code)
  }

  @Test
  fun selectionBuildsOrderedPlayableDirectSiblingsAndExactIndex() {
    val first = playable("track:first", "First", "/first", "session=one")
    val nested = container(
      "folder:nested",
      "Nested",
      listOf(playable("track:nested", "Nested track", "/nested", "session=one")),
    )
    val selected = playable("track:selected", "Selected", "/selected", "session=one")
    LoggeRythmPlayerRuntime.installBrowseTree(
      tree(container("library:mix", "Mixed", listOf(first, nested, selected))),
    )

    val resolved = LoggeRythmPlayerRuntime.playableBrowseSiblings(selected.id)
    requireNotNull(resolved)
    assertEquals(listOf(first.id, selected.id), resolved.mediaItems.map { it.mediaId })
    assertEquals(1, resolved.startIndex)
    assertNull(LoggeRythmPlayerRuntime.playableBrowseSiblings(nested.id))
    assertNull(LoggeRythmPlayerRuntime.playableBrowseSiblings("track:unknown"))
  }

  @Test
  fun publicDiffIgnoresPrivateSourceReplacementButReportsMetadataAndClear() {
    val changes = mutableListOf<RuntimeBrowseTreeChange>()
    val observer = object : LoggeRythmBrowseTreeObserver {
      override fun onBrowseTreeChanged(change: RuntimeBrowseTreeChange) {
        changes += change
      }
    }
    LoggeRythmBrowseTreeServiceBridge.attach(observer)
    try {
      val first = playable("track:one", "Original", "/one", "session=one")
      val category = container("library:liked", "Liked", listOf(first))
      LoggeRythmPlayerRuntime.installBrowseTree(tree(category))
      changes.clear()

      val refreshedCookie = playable("track:one", "Original", "/one", "session=two")
      LoggeRythmPlayerRuntime.installBrowseTree(
        tree(container("library:liked", "Liked", listOf(refreshedCookie))),
      )
      assertTrue(changes.isEmpty())
      assertEquals("session=two", LoggeRythmPlayerRuntime.cookieFor(refreshedCookie.url!!))

      val refreshedUrl = playable("track:one", "Original", "/one?signature=refreshed", "session=two")
      LoggeRythmPlayerRuntime.installBrowseTree(
        tree(container("library:liked", "Liked", listOf(refreshedUrl))),
      )
      assertTrue(changes.isEmpty())
      assertEquals("session=two", LoggeRythmPlayerRuntime.cookieFor(refreshedUrl.url!!))

      val renamed = playable("track:one", "Renamed", "/one?signature=refreshed", "session=two")
      LoggeRythmPlayerRuntime.installBrowseTree(
        tree(container("library:liked", "Liked", listOf(renamed))),
      )
      assertEquals(mapOf("library:liked" to 1), changes.single().childCountByParentId)

      changes.clear()
      LoggeRythmPlayerRuntime.clearSessionAndAllData()
      assertNull(LoggeRythmPlayerRuntime.persistedBrowseTree())
      assertEquals(
        mapOf(
          LoggeRythmPlayerRuntime.BROWSE_ROOT_ID to 0,
          "library:liked" to 0,
        ),
        changes.single().childCountByParentId,
      )
    } finally {
      LoggeRythmBrowseTreeServiceBridge.detach(observer)
    }
  }

  private fun tree(vararg children: BrowseNodeSpec): BrowseTreeSpec = BrowseTreeSpec(
    root = container(
      LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
      "LoggeRythm",
      children.toList(),
    ),
  )

  private fun container(
    id: String,
    title: String,
    children: List<BrowseNodeSpec> = emptyList(),
  ): BrowseNodeSpec = BrowseNodeSpec(
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

  private fun playable(
    id: String,
    title: String,
    path: String,
    cookie: String,
  ): BrowseNodeSpec = BrowseNodeSpec(
    id = id,
    title = title,
    subtitle = null,
    artist = "Artist",
    album = "Album",
    artworkUrl = "https://music.example.test/art.jpg",
    durationMs = 120_000L,
    playable = true,
    url = "https://music.example.test$path",
    cookie = cookie,
    children = emptyList(),
  )
}
