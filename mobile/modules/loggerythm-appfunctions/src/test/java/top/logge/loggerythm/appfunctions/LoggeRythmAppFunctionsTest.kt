package top.logge.loggerythm.appfunctions

import android.content.Context
import androidx.appfunctions.AppFunctionAppUnknownException
import androidx.appfunctions.AppFunctionContext
import androidx.appfunctions.AppFunctionDisabledException
import androidx.appfunctions.AppFunctionElementNotFoundException
import androidx.appfunctions.AppFunctionInvalidArgumentException
import androidx.appfunctions.AppFunctionPermissionRequiredException
import androidx.appfunctions.internal.AggregatedAppFunctionInventory
import androidx.appfunctions.service.internal.AggregatedAppFunctionInvoker
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import top.logge.loggerythm.player.LoggeRythmVoiceCommandExecutor
import top.logge.loggerythm.player.LoggeRythmVoiceErrorCode
import top.logge.loggerythm.player.LoggeRythmVoiceException
import top.logge.loggerythm.player.LoggeRythmVoiceFavoriteResult
import top.logge.loggerythm.player.LoggeRythmVoiceMediaFocus
import top.logge.loggerythm.player.LoggeRythmVoiceNowPlaying
import top.logge.loggerythm.player.LoggeRythmVoicePlayResult
import top.logge.loggerythm.player.LoggeRythmVoicePlaybackAction
import top.logge.loggerythm.player.LoggeRythmVoicePlaybackState
import top.logge.loggerythm.player.LoggeRythmVoiceQueuePosition
import top.logge.loggerythm.player.LoggeRythmVoiceQueueResult
import top.logge.loggerythm.player.LoggeRythmVoiceTrackSummary

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class LoggeRythmAppFunctionsTest {

    private val testContext: AppFunctionContext by lazy {
        object : AppFunctionContext {
            override val context: Context
                get() = RuntimeEnvironment.getApplication()
        }
    }

    private val sampleTrack = LoggeRythmVoiceTrackSummary(
        mediaId = "track:42",
        trackId = "42",
        title = "Midnight City",
        artist = "M83",
        album = "Hurry Up, We're Dreaming",
        durationMs = 243_000L,
    )

    private val sampleNowPlaying = LoggeRythmVoiceNowPlaying(
        hasActiveTrack = true,
        track = sampleTrack,
        isPlaying = true,
        playWhenReady = true,
        playbackState = LoggeRythmVoicePlaybackState.READY,
        positionMs = 15_000L,
        durationMs = 243_000L,
        liked = true,
        queueSize = 5,
        currentIndex = 1,
    )

    private class FakeVoiceExecutor(
        private val playHandler: (
            query: String?,
            mediaFocus: LoggeRythmVoiceMediaFocus,
            artist: String?,
            album: String?,
            title: String?,
            playlist: String?,
        ) -> CompletableFuture<LoggeRythmVoicePlayResult> = { _, _, _, _, _, _ ->
            throw AssertionError("Unexpected playMusic invocation")
        },
        private val controlHandler: (
            action: LoggeRythmVoicePlaybackAction,
        ) -> CompletableFuture<LoggeRythmVoiceNowPlaying> = { _ ->
            throw AssertionError("Unexpected controlPlayback invocation")
        },
        private val queueHandler: (
            query: String,
            position: LoggeRythmVoiceQueuePosition,
            mediaFocus: LoggeRythmVoiceMediaFocus,
            artist: String?,
            album: String?,
            title: String?,
            playlist: String?,
        ) -> CompletableFuture<LoggeRythmVoiceQueueResult> = { _, _, _, _, _, _, _ ->
            throw AssertionError("Unexpected queueMusic invocation")
        },
        private val favoriteHandler: (
            liked: Boolean,
        ) -> CompletableFuture<LoggeRythmVoiceFavoriteResult> = { _ ->
            throw AssertionError("Unexpected setCurrentTrackFavorite invocation")
        },
        private val nowPlayingHandler: () -> CompletableFuture<LoggeRythmVoiceNowPlaying> = {
            throw AssertionError("Unexpected getNowPlaying invocation")
        },
    ) : LoggeRythmVoiceCommandExecutor {
        override fun playMusic(
            context: Context,
            query: String?,
            mediaFocus: LoggeRythmVoiceMediaFocus,
            artist: String?,
            album: String?,
            title: String?,
            playlist: String?,
        ): CompletableFuture<LoggeRythmVoicePlayResult> {
            return playHandler(query, mediaFocus, artist, album, title, playlist)
        }

        override fun controlPlayback(
            context: Context,
            action: LoggeRythmVoicePlaybackAction,
        ): CompletableFuture<LoggeRythmVoiceNowPlaying> {
            return controlHandler(action)
        }

        override fun queueMusic(
            context: Context,
            query: String,
            position: LoggeRythmVoiceQueuePosition,
            mediaFocus: LoggeRythmVoiceMediaFocus,
            artist: String?,
            album: String?,
            title: String?,
            playlist: String?,
        ): CompletableFuture<LoggeRythmVoiceQueueResult> {
            return queueHandler(query, position, mediaFocus, artist, album, title, playlist)
        }

        override fun setCurrentTrackFavorite(
            context: Context,
            liked: Boolean,
        ): CompletableFuture<LoggeRythmVoiceFavoriteResult> {
            return favoriteHandler(liked)
        }

        override fun getNowPlaying(context: Context): CompletableFuture<LoggeRythmVoiceNowPlaying> {
            return nowPlayingHandler()
        }
    }

    @Test
    fun playMusicNormalizesArgumentsAndMapsResult() = runTest {
        var capturedQuery: String? = null
        var capturedFocus: LoggeRythmVoiceMediaFocus? = null
        var capturedArtist: String? = null
        var capturedAlbum: String? = null
        var capturedTitle: String? = null
        var capturedPlaylist: String? = null

        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(
                playHandler = { query, focus, artist, album, title, playlist ->
                    capturedQuery = query
                    capturedFocus = focus
                    capturedArtist = artist
                    capturedAlbum = album
                    capturedTitle = title
                    capturedPlaylist = playlist
                    CompletableFuture.completedFuture(
                        LoggeRythmVoicePlayResult(
                            source = "search:track",
                            matchedTitle = "Midnight City",
                            queuedCount = 5,
                            nowPlaying = sampleNowPlaying,
                        ),
                    )
                },
            ),
        )

        val result = functions.playMusic(
            appFunctionContext = testContext,
            query = "  Midnight City  ",
            mediaFocus = " TRACK ",
            artist = " M83 ",
            album = "   ",
            title = "Midnight City",
            playlist = "",
        )

        assertEquals("Midnight City", capturedQuery)
        assertEquals(LoggeRythmVoiceMediaFocus.TRACK, capturedFocus)
        assertEquals("M83", capturedArtist)
        assertNull(capturedAlbum)
        assertEquals("Midnight City", capturedTitle)
        assertNull(capturedPlaylist)

        assertEquals("search:track", result.source)
        assertEquals("Midnight City", result.matchedTitle)
        assertEquals(5, result.queuedCount)
        assertTrue(result.nowPlaying.hasActiveTrack)
        assertEquals("ready", result.nowPlaying.playbackState)
        assertEquals("42", result.nowPlaying.track?.trackId)
        assertEquals(true, result.nowPlaying.liked)
    }

    @Test
    fun playMusicRejectsUnsupportedMediaFocusLoudly() = runTest {
        val functions = LoggeRythmAppFunctions(FakeVoiceExecutor())
        try {
            functions.playMusic(
                appFunctionContext = testContext,
                query = "Daft Punk",
                mediaFocus = "podcast",
            )
            fail("Expected AppFunctionInvalidArgumentException")
        } catch (error: AppFunctionInvalidArgumentException) {
            assertTrue(error.errorMessage?.contains("podcast") == true)
        }
    }

    @Test
    fun controlPlaybackDelegatesAllValidActionsAndRejectsInvalidOnes() = runTest {
        val seenActions = mutableListOf<LoggeRythmVoicePlaybackAction>()
        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(
                controlHandler = { action ->
                    seenActions.add(action)
                    CompletableFuture.completedFuture(sampleNowPlaying)
                },
            ),
        )

        val expected = listOf(
            "play" to LoggeRythmVoicePlaybackAction.PLAY,
            "PAUSE" to LoggeRythmVoicePlaybackAction.PAUSE,
            " next " to LoggeRythmVoicePlaybackAction.NEXT,
            "previous" to LoggeRythmVoicePlaybackAction.PREVIOUS,
            "stop" to LoggeRythmVoicePlaybackAction.STOP,
        )
        for ((wireValue, _) in expected) {
            val snapshot = functions.controlPlayback(testContext, wireValue)
            assertEquals("Midnight City", snapshot.track?.title)
        }
        assertEquals(expected.map { it.second }, seenActions)

        try {
            functions.controlPlayback(testContext, "rewind_10x")
            fail("Expected AppFunctionInvalidArgumentException for unsupported action")
        } catch (error: AppFunctionInvalidArgumentException) {
            assertTrue(error.errorMessage?.contains("rewind_10x") == true)
        }

        try {
            functions.controlPlayback(testContext, "   ")
            fail("Expected AppFunctionInvalidArgumentException for blank action")
        } catch (error: AppFunctionInvalidArgumentException) {
            assertTrue(error.errorMessage?.contains("non-empty action") == true)
        }
    }

    @Test
    fun queueMusicValidatesQueryAndPositionAndMapsResult() = runTest {
        var capturedQuery: String? = null
        var capturedPosition: LoggeRythmVoiceQueuePosition? = null
        var capturedFocus: LoggeRythmVoiceMediaFocus? = null

        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(
                queueHandler = { query, position, focus, _, _, _, _ ->
                    capturedQuery = query
                    capturedPosition = position
                    capturedFocus = focus
                    CompletableFuture.completedFuture(
                        LoggeRythmVoiceQueueResult(
                            source = "search:album",
                            position = position,
                            addedCount = 3,
                            firstAdded = sampleTrack,
                            nowPlaying = sampleNowPlaying,
                        ),
                    )
                },
            ),
        )

        val nextResult = functions.queueMusic(
            appFunctionContext = testContext,
            query = "  Discovery  ",
            position = "NEXT",
            mediaFocus = "album",
        )
        assertEquals("Discovery", capturedQuery)
        assertEquals(LoggeRythmVoiceQueuePosition.NEXT, capturedPosition)
        assertEquals(LoggeRythmVoiceMediaFocus.ALBUM, capturedFocus)
        assertEquals("next", nextResult.position)
        assertEquals(3, nextResult.addedCount)
        assertEquals("track:42", nextResult.firstAdded.mediaId)

        val defaultEndResult = functions.queueMusic(
            appFunctionContext = testContext,
            query = "Homework",
        )
        assertEquals(LoggeRythmVoiceQueuePosition.END, capturedPosition)
        assertEquals(LoggeRythmVoiceMediaFocus.ANY, capturedFocus)
        assertEquals("end", defaultEndResult.position)

        try {
            functions.queueMusic(appFunctionContext = testContext, query = "   ")
            fail("Expected AppFunctionInvalidArgumentException for blank query")
        } catch (error: AppFunctionInvalidArgumentException) {
            assertTrue(error.errorMessage?.contains("non-empty query") == true)
        }

        try {
            functions.queueMusic(
                appFunctionContext = testContext,
                query = "Homework",
                position = "middle",
            )
            fail("Expected AppFunctionInvalidArgumentException for invalid position")
        } catch (error: AppFunctionInvalidArgumentException) {
            assertTrue(error.errorMessage?.contains("middle") == true)
        }
    }

    @Test
    fun setCurrentTrackFavoriteAndGetNowPlayingDelegateCleanly() = runTest {
        var requestedLiked: Boolean? = null
        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(
                favoriteHandler = { liked ->
                    requestedLiked = liked
                    CompletableFuture.completedFuture(
                        LoggeRythmVoiceFavoriteResult(
                            track = sampleTrack,
                            liked = liked,
                            changed = true,
                        ),
                    )
                },
                nowPlayingHandler = {
                    CompletableFuture.completedFuture(
                        sampleNowPlaying.copy(
                            hasActiveTrack = false,
                            track = null,
                            isPlaying = false,
                            playWhenReady = false,
                            playbackState = LoggeRythmVoicePlaybackState.IDLE,
                            liked = null,
                            queueSize = 0,
                            currentIndex = null,
                        ),
                    )
                },
            ),
        )

        val favResult = functions.setCurrentTrackFavorite(testContext, true)
        assertEquals(true, requestedLiked)
        assertTrue(favResult.liked)
        assertTrue(favResult.changed)
        assertEquals("Midnight City", favResult.track.title)

        val idleSnapshot = functions.getNowPlaying(testContext)
        assertFalse(idleSnapshot.hasActiveTrack)
        assertNull(idleSnapshot.track)
        assertNull(idleSnapshot.liked)
        assertEquals("idle", idleSnapshot.playbackState)
        assertNull(idleSnapshot.currentIndex)
    }

    @Test
    fun errorMapperCoversEveryVoiceErrorCodeAndUnwrapsFutures() = runTest {
        val expectedMappings = mapOf(
            LoggeRythmVoiceErrorCode.AUTH_REQUIRED to AppFunctionPermissionRequiredException::class.java,
            LoggeRythmVoiceErrorCode.INVALID_ARGUMENT to AppFunctionInvalidArgumentException::class.java,
            LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH to AppFunctionElementNotFoundException::class.java,
            LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY to AppFunctionElementNotFoundException::class.java,
            LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK to AppFunctionElementNotFoundException::class.java,
            LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE to AppFunctionDisabledException::class.java,
            LoggeRythmVoiceErrorCode.NOT_READY to AppFunctionDisabledException::class.java,
            LoggeRythmVoiceErrorCode.CONTROLS_NOT_READY to AppFunctionDisabledException::class.java,
            LoggeRythmVoiceErrorCode.QUEUE_UNAVAILABLE to AppFunctionDisabledException::class.java,
            LoggeRythmVoiceErrorCode.FAVORITE_UNAVAILABLE to AppFunctionDisabledException::class.java,
            LoggeRythmVoiceErrorCode.BUSY to AppFunctionAppUnknownException::class.java,
            LoggeRythmVoiceErrorCode.NETWORK_ERROR to AppFunctionAppUnknownException::class.java,
            LoggeRythmVoiceErrorCode.FAVORITE_UPDATE_FAILED to AppFunctionAppUnknownException::class.java,
        )

        assertEquals(
            "Test must assert every LoggeRythmVoiceErrorCode",
            LoggeRythmVoiceErrorCode.entries.toSet(),
            expectedMappings.keys,
        )

        for ((code, expectedClass) in expectedMappings) {
            val wrapped = CompletionException(
                ExecutionException(
                    LoggeRythmVoiceException(code, "Simulated failure for ${code.name}"),
                ),
            )
            val mapped = LoggeRythmAppFunctionErrorMapper.toAppFunctionException("op", wrapped)
            assertEquals("Wrong exception class for $code", expectedClass, mapped::class.java)
            assertTrue(mapped.errorMessage?.contains(code.name) == true)
        }

        val failedFuture = CompletableFuture<LoggeRythmVoiceNowPlaying>()
        failedFuture.completeExceptionally(
            LoggeRythmVoiceException(
                LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
                "Please sign in to LoggeRythm",
            ),
        )
        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(nowPlayingHandler = { failedFuture }),
        )
        try {
            functions.getNowPlaying(testContext)
            fail("Expected AppFunctionPermissionRequiredException from failed future")
        } catch (error: AppFunctionPermissionRequiredException) {
            assertTrue(error.errorMessage?.contains("AUTH_REQUIRED") == true)
            assertTrue(error.errorMessage?.contains("Please sign in to LoggeRythm") == true)
        }
    }

    @Test
    fun playMusicWithNoArgumentsRequestsResumeAndKspAggregatesAllFiveFunctions() = runTest {
        var sawResumeCall = false
        val functions = LoggeRythmAppFunctions(
            FakeVoiceExecutor(
                playHandler = { query, focus, artist, album, title, playlist ->
                    sawResumeCall =
                        query == null &&
                        focus == LoggeRythmVoiceMediaFocus.ANY &&
                        artist == null &&
                        album == null &&
                        title == null &&
                        playlist == null
                    CompletableFuture.completedFuture(
                        LoggeRythmVoicePlayResult(
                            source = "resume",
                            matchedTitle = "Midnight City",
                            queuedCount = 5,
                            nowPlaying = sampleNowPlaying,
                        ),
                    )
                },
            ),
        )

        val result = functions.playMusic(appFunctionContext = testContext)
        assertTrue(sawResumeCall)
        assertEquals("resume", result.source)

        // Verify public no-arg constructor required by PlatformAppFunctionService works.
        assertNotNull(LoggeRythmAppFunctions())

        val expectedIds = setOf(
            "top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions#playMusic",
            "top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions#controlPlayback",
            "top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions#queueMusic",
            "top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions#setCurrentTrackFavorite",
            "top.logge.loggerythm.appfunctions.LoggeRythmAppFunctions#getNowPlaying",
        )

        val inventoryClass = Class.forName(
            "androidx.appfunctions.internal.\$AggregatedAppFunctionInventory_Impl",
        )
        val inventory = inventoryClass.getDeclaredConstructor().newInstance()
            as AggregatedAppFunctionInventory
        assertEquals(expectedIds, inventory.functionIdToMetadataMap.keys)

        val invokerClass = Class.forName(
            "androidx.appfunctions.service.internal.\$AggregatedAppFunctionInvoker_Impl",
        )
        val invoker = invokerClass.getDeclaredConstructor().newInstance()
            as AggregatedAppFunctionInvoker
        assertEquals(expectedIds, invoker.supportedFunctionIds)
    }

    @Test
    fun errorMapperPreservesCancellationAndWrapsUnexpectedErrorsLoudly() {
        val cancelled = CancellationException("cancelled-by-caller")
        try {
            LoggeRythmAppFunctionErrorMapper.toAppFunctionException("playMusic", cancelled)
            fail("Expected CancellationException to be rethrown")
        } catch (caught: CancellationException) {
            assertEquals("cancelled-by-caller", caught.message)
        }

        val mapped = LoggeRythmAppFunctionErrorMapper.toAppFunctionException(
            "queueMusic",
            IllegalStateException("bridge exploded"),
        )
        assertEquals(AppFunctionAppUnknownException::class.java, mapped::class.java)
        assertTrue(mapped.errorMessage?.contains("IllegalStateException") == true)
        assertTrue(mapped.errorMessage?.contains("bridge exploded") == true)
    }
}
