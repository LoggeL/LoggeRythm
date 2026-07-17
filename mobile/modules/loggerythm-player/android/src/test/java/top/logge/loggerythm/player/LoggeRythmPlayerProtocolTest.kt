package top.logge.loggerythm.player

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPlayerProtocolTest {
  private val privateRoot = Files.createTempDirectory("loggerythm-player-test").toFile()
  private val protocol = LoggeRythmPlayerProtocol(listOf(privateRoot))

  @Test
  fun setupRequiresExactAccountAndCanonicalOriginBinding() {
    val setup = protocol.parseSetup(
      """{"accountScope":"user:42","origin":"https://loggerythm.logge.top"}""",
    )
    assertEquals("user:42", setup.sessionBinding.accountScope)
    assertEquals("https://loggerythm.logge.top", setup.sessionBinding.origin)

    assertCode("required-key-missing") {
      protocol.parseSetup("""{"accountScope":"user:42"}""")
    }
    assertCode("unexpected-key") {
      protocol.parseSetup(
        """{"accountScope":"user:42","origin":"https://loggerythm.logge.top","extra":true}""",
      )
    }
    assertCode("account-scope-invalid") {
      protocol.parseSetup("""{"accountScope":"user:0","origin":"https://loggerythm.logge.top"}""")
    }
    assertCode("origin-not-canonical") {
      protocol.parseSetup(
        """{"accountScope":"user:42","origin":"https://loggerythm.logge.top:443"}""",
      )
    }
  }

  @Test
  fun parsesBoundedQueueAndPreservesSafeExtras() {
    val command = protocol.parseCommand(
      "setQueue",
      """{
        "items":[{
          "id":"entry:1",
          "url":"https://loggerythm.logge.top/api/tracks/1/stream?nonce=one",
          "title":"Track",
          "headers":{"Cookie":"sf_session=opaque"},
          "extras":{"stableId":"entry:1","queueOrigin":"playlist","order":0}
        }],
        "startIndex":0,
        "startPositionMs":42
      }""".trimIndent(),
    ) as PlayerCommand.SetQueue

    assertEquals(1, command.items.size)
    assertEquals(42L, command.startPositionMs)
    assertTrue(command.items.single().extrasJson.contains("queueOrigin"))
  }

  @Test
  fun rejectsUnknownKeysAndSensitiveExtras() {
    assertCode("unexpected-key") {
      protocol.parseCommand("play", """{"surprise":true}""")
    }
    assertCode("extras-key-invalid") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"https://example.test/one","extras":{"accessToken":"no"}}]}""",
      )
    }
  }

  @Test
  fun permitsOnlyHttpsOrExistingAppPrivateFiles() {
    assertCode("media-url-scheme-invalid") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"http://example.test/one"}]}""",
      )
    }
    val privateFile = File(privateRoot, "one.mp3").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    val local = protocol.parseCommand(
      "setQueue",
      """{"items":[{"id":"one","url":"${privateFile.toURI()}"}]}""",
    ) as PlayerCommand.SetQueue
    assertEquals(privateFile.canonicalFile.toURI().toASCIIString(), local.items.single().url)

    val outside = Files.createTempFile("loggerythm-outside", ".mp3").toFile()
    assertCode("media-file-outside-private-storage") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"${outside.toURI()}"}]}""",
      )
    }
  }

  @Test
  fun cookieHeadersAreHttpsOnlyAndRejectInjection() {
    assertCode("header-value-invalid") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"https://example.test/one","headers":{"Cookie":"a\nb"}}]}""",
      )
    }
    val privateFile = File(privateRoot, "two.mp3").apply { writeBytes(byteArrayOf(1)) }
    assertCode("header-url-invalid") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"${privateFile.toURI()}","headers":{"Cookie":"a=b"}}]}""",
      )
    }
  }

  @Test
  fun rejectsDuplicateQueueAndBrowseIds() {
    assertCode("queue-item-id-duplicate") {
      protocol.parseCommand(
        "setQueue",
        """{"items":[{"id":"one","url":"https://example.test/1"},{"id":"one","url":"https://example.test/2"}]}""",
      )
    }
    assertCode("browse-id-duplicate") {
      protocol.parseBrowseTree(
        """{"root":{"id":"root","title":"Root","children":[{"id":"root","title":"Again"}]}}""",
      )
    }
  }

  @Test
  fun parsesBrowseMetadataButRejectsSameAppQueueExtras() {
    val tree = protocol.parseBrowseTree(
      """{
        "root":{
          "id":"root",
          "title":"Library",
          "children":[{
            "id":"track:1",
            "title":"Track",
            "subtitle":"Subtitle",
            "artist":"Artist",
            "album":"Album",
            "artworkUrl":"https://example.test/art.jpg",
            "durationMs":1234,
            "playable":true,
            "url":"https://example.test/track.mp3"
          }]
        }
      }""".trimIndent(),
    )
    val track = tree.root.children.single()
    assertEquals("Artist", track.artist)
    assertEquals("Album", track.album)
    assertEquals(1234L, track.durationMs)

    assertCode("unexpected-key") {
      protocol.parseBrowseTree(
        """{"root":{"id":"root","title":"Library","extras":{"stableId":"root"}}}""",
      )
    }
  }

  @Test
  fun parsesBoundedProductShuffleAndSleepCommands() {
    val shuffle = protocol.parseCommand(
      "setQueuePersistenceState",
      """{"contextShuffleEnabled":true,"contextShuffleRestoreOrder":["stable:one"]}""",
    ) as PlayerCommand.SetQueuePersistenceState
    assertTrue(shuffle.contextShuffleEnabled)
    assertEquals(listOf("stable:one"), shuffle.contextShuffleRestoreOrder)

    val time = protocol.parseCommand(
      "sleepAfterTime",
      """{"seconds":60.25,"fadeOutSeconds":5}""",
    ) as PlayerCommand.SleepAfterTime
    assertEquals(60_250L, time.durationMs)
    assertEquals(5_000L, time.fadeOutMs)

    val item = protocol.parseCommand(
      "sleepAfterMediaItemAtIndex",
      """{"index":2}""",
    ) as PlayerCommand.SleepAfterMediaItemAtIndex
    assertEquals(2, item.index)
    assertEquals(PlayerCommand.CancelSleepTimer, protocol.parseCommand("cancelSleepTimer", "{}"))

    assertCode("shuffle-id-duplicate") {
      protocol.parseCommand(
        "setQueuePersistenceState",
        """{"contextShuffleEnabled":true,"contextShuffleRestoreOrder":["same","same"]}""",
      )
    }
    assertCode("sleep-fade-invalid") {
      protocol.parseCommand(
        "sleepAfterTime",
        """{"seconds":5,"fadeOutSeconds":6}""",
      )
    }
  }

  @Test
  fun parsesOnlyNativeRemoteCommandsAndGlobalShuffleDisable() {
    val commands = protocol.parseCommand(
      "setCommands",
      """{"capabilities":["playPause","next","seek"],"handling":"native"}""",
    ) as PlayerCommand.SetCommands
    assertEquals(
      setOf(
        RemotePlayerCapability.PLAY_PAUSE,
        RemotePlayerCapability.NEXT,
        RemotePlayerCapability.SEEK,
      ),
      commands.capabilities,
    )
    assertEquals(
      PlayerCommand.DisableGlobalShuffle,
      protocol.parseCommand("setShuffleEnabled", """{"enabled":false}"""),
    )

    assertCode("remote-capability-duplicate") {
      protocol.parseCommand(
        "setCommands",
        """{"capabilities":["next","next"],"handling":"native"}""",
      )
    }
    assertCode("remote-capability-invalid") {
      protocol.parseCommand(
        "setCommands",
        """{"capabilities":["shuffle"],"handling":"native"}""",
      )
    }
    assertCode("remote-command-handling-unsupported") {
      protocol.parseCommand(
        "setCommands",
        """{"capabilities":["playPause"],"handling":"hybrid"}""",
      )
    }
    assertCode("unexpected-key") {
      protocol.parseCommand(
        "setCommands",
        """{"capabilities":[],"handling":"native","forwardInterval":15}""",
      )
    }
    assertCode("global-shuffle-enable-forbidden") {
      protocol.parseCommand("setShuffleEnabled", """{"enabled":true}""")
    }
  }

  @Test
  fun parsesOnlyStrictBoundedRadioCompletionQueueItems() {
    val completion = protocol.parseRadioPlaybackCompletion(
      """{
        "schemaVersion":1,
        "expectedQueueGeneration":33,
        "expectedActiveMediaId":"radio:9:84",
        "items":[{
          "id":"radio:completion:101",
          "url":"https://loggerythm.logge.top/api/tracks/101/stream",
          "headers":{"Cookie":"sf_session=opaque"},
          "extras":{"track":{"id":"101"},"radio":true}
        }]
      }""".trimIndent(),
    )

    assertEquals(33L, completion.expectedQueueGeneration)
    assertEquals("radio:9:84", completion.expectedActiveMediaId)
    assertEquals("radio:completion:101", completion.items.single().id)
    assertTrue(completion.toString().contains("items=<redacted:1>"))
    assertTrue(!completion.toString().contains("sf_session"))

    assertCode("unexpected-key") {
      protocol.parseRadioPlaybackCompletion(
        """{"schemaVersion":1,"expectedQueueGeneration":33,"expectedActiveMediaId":"x","items":[],"error":"secret"}""",
      )
    }
    assertCode("radio-completion-version-unsupported") {
      protocol.parseRadioPlaybackCompletion(
        """{"schemaVersion":2,"expectedQueueGeneration":33,"expectedActiveMediaId":"x","items":[]}""",
      )
    }
    assertCode("radio-completion-items-too-large") {
      val item = """{"id":"x","url":"https://example.test/x"}"""
      protocol.parseRadioPlaybackCompletion(
        """{"schemaVersion":1,"expectedQueueGeneration":33,"expectedActiveMediaId":"x","items":[${List(6) { item }.joinToString()}]}""",
      )
    }
  }

  private fun assertCode(code: String, action: () -> Unit) {
    val error = assertThrows(PlayerProtocolException::class.java, action)
    assertEquals(code, error.code)
  }
}
