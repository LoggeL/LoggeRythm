package top.logge.loggerythm.player

import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaConstants
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

@UnstableApi
class LoggeRythmCarBrowseMetadataTest {
  private lateinit var tempRoot: File
  private lateinit var protocol: LoggeRythmPlayerProtocol
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:7",
    origin = "https://music.example.test",
  )

  @Before
  fun setUp() {
    tempRoot = Files.createTempDirectory("car-browse-meta").toFile()
    protocol = LoggeRythmPlayerProtocol(listOf(tempRoot))
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmPlayerRuntime.bindSession(binding)
  }

  @After
  fun tearDown() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    tempRoot.deleteRecursively()
  }

  @Test
  fun parsesAndPersistsGridHintsMediaTypesAndGroupTitlesCleanly() {
    val treeJson = """
      {
        "root": {
          "id": "loggerythm:root",
          "title": "LoggeRythm",
          "playable": false,
          "children": [
            {
              "id": "library:home",
              "title": "Home",
              "playable": false,
              "contentStyleBrowsable": "grid",
              "contentStylePlayable": "list",
              "mediaType": "folder_mixed",
              "children": [
                {
                  "id": "mix:daily-1",
                  "title": "Daily Mix 1",
                  "playable": false,
                  "mediaType": "playlist",
                  "groupTitle": "Made For You",
                  "children": [
                    {
                      "id": "mix:daily-1:0:100",
                      "title": "Midnight City",
                      "artist": "M83",
                      "playable": true,
                      "url": "https://music.example.test/api/tracks/100/stream"
                    }
                  ]
                }
              ]
            },
            {
              "id": "library:playlists",
              "title": "Playlists",
              "playable": false,
              "children": []
            },
            {
              "id": "library:radio",
              "title": "Radio & Moods",
              "playable": false,
              "children": []
            },
            {
              "id": "library:downloads",
              "title": "Downloads",
              "playable": false,
              "children": []
            }
          ]
        }
      }
    """.trimIndent()

    val parsed = protocol.parseBrowseTree(treeJson)
    val installed = LoggeRythmPlayerRuntime.installBrowseTree(parsed)

    val homeNode = installed.nodes.getValue("library:home")
    assertEquals(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED, homeNode.mediaItem.mediaMetadata.mediaType)
    assertEquals(
      MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
      homeNode.displayHints?.contentStyleBrowsable,
    )
    assertEquals(
      MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
      homeNode.displayHints?.contentStylePlayable,
    )

    val mixNode = installed.nodes.getValue("mix:daily-1")
    assertEquals(MediaMetadata.MEDIA_TYPE_PLAYLIST, mixNode.mediaItem.mediaMetadata.mediaType)
    assertEquals("Made For You", mixNode.displayHints?.groupTitle)

    val leafNode = installed.nodes.getValue("mix:daily-1:0:100")
    assertEquals(MediaMetadata.MEDIA_TYPE_MUSIC, leafNode.mediaItem.mediaMetadata.mediaType)
    assertNull(leafNode.mediaItem.mediaMetadata.extras)

    // Cover-heavy roots infer grid hints even when omitted from JSON
    assertEquals(
      MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
      installed.nodes.getValue("library:playlists").displayHints?.contentStyleBrowsable,
    )
    assertEquals(
      MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS,
      installed.nodes.getValue("library:playlists").mediaItem.mediaMetadata.mediaType,
    )
    assertEquals(
      MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
      installed.nodes.getValue("library:radio").displayHints?.contentStylePlayable,
    )
    assertEquals(
      MediaMetadata.MEDIA_TYPE_FOLDER_RADIO_STATIONS,
      installed.nodes.getValue("library:radio").mediaItem.mediaMetadata.mediaType,
    )
    assertEquals(
      MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
      installed.nodes.getValue("library:downloads").displayHints?.contentStyleBrowsable,
    )

    // Round-trip through encrypted persisted state codec preserves hints
    val codec = LoggeRythmPersistedStateCodec(protocol)
    val state = LoggeRythmPersistedPlayerState(
      sessionBinding = binding,
      queue = emptyList(),
      activeIndex = null,
      positionMs = 0L,
      repeatMode = "off",
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
      sleep = null,
      browseTree = parsed,
    )
    val decoded = codec.decode(codec.encode(state), binding)
    val decodedHome = decoded.browseTree?.root?.children?.first()
    assertEquals("grid", decodedHome?.contentStyleBrowsable)
    assertEquals("list", decodedHome?.contentStylePlayable)
    assertEquals("folder_mixed", decodedHome?.mediaType)
    assertEquals("Made For You", decodedHome?.children?.first()?.groupTitle)
  }

  @Test
  fun rejectsInvalidBrowseContentStylesAndMediaTypesLoudly() {
    val badStyle = assertThrows(PlayerProtocolException::class.java) {
      protocol.parseBrowseTree(
        """{"root":{"id":"loggerythm:root","title":"LoggeRythm","contentStyleBrowsable":"masonry"}}""",
      )
    }
    assertEquals("browse-content-style-invalid", badStyle.code)

    val badMediaType = assertThrows(PlayerProtocolException::class.java) {
      protocol.parseBrowseTree(
        """{"root":{"id":"loggerythm:root","title":"LoggeRythm","mediaType":"spaceship"}}""",
      )
    }
    assertEquals("browse-media-type-invalid", badMediaType.code)
  }
}
