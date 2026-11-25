package top.logge.loggerythm.appfunctions

import android.content.Context
import androidx.appfunctions.AppFunctionContext
import androidx.appfunctions.AppFunctionInvalidArgumentException
import androidx.appfunctions.AppFunctionStringValueConstraint
import androidx.appfunctions.service.AppFunction
import java.util.Locale
import java.util.concurrent.CompletableFuture
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import top.logge.loggerythm.player.LoggeRythmVoiceBridge
import top.logge.loggerythm.player.LoggeRythmVoiceCommandExecutor
import top.logge.loggerythm.player.LoggeRythmVoiceMediaFocus
import top.logge.loggerythm.player.LoggeRythmVoicePlaybackAction
import top.logge.loggerythm.player.LoggeRythmVoiceQueuePosition

/**
 * Android 16 (API 36+) Jetpack AppFunctions exposed by LoggeRythm for Gemini and Android system
 * assistant integration.
 *
 * KSP aggregates all `@AppFunction` declarations in this class into the runtime
 * `AggregatedAppFunctionInventory` / `AggregatedAppFunctionInvoker` used by
 * `androidx.appfunctions.service.PlatformAppFunctionService` and generates
 * `assets/app_functions_v2.xml` (+ legacy `assets/app_functions.xml`).
 *
 * Every operation delegates directly to [LoggeRythmVoiceBridge] so assistant commands share the
 * exact same Media3 playback session, queue, and authenticated server backend as phone, Android TV,
 * and Android Auto.
 */
class LoggeRythmAppFunctions internal constructor(
    private val voiceExecutor: LoggeRythmVoiceCommandExecutor,
) {
    /**
     * Public no-argument constructor used by `androidx.appfunctions.service.PlatformAppFunctionService`
     * when instantiating LoggeRythm's AppFunctions handler.
     */
    constructor() : this(LoggeRythmVoiceBridge)

    /**
     * Searches LoggeRythm and immediately starts playing the best matching track, artist, album,
     * or playlist, or resumes the active/saved playback session when called without search filters.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param query Free-form search query such as a song title, artist, album, or playlist name.
     *   Leave null when requesting playback resume without a new search.
     * @param mediaFocus Optional target category for the search: any, track, artist, album, or playlist.
     * @param artist Optional artist name hint to refine matching.
     * @param album Optional album title hint to refine matching.
     * @param title Optional track title hint to refine matching.
     * @param playlist Optional playlist name hint to refine matching.
     * @return Details about the matched media source, queued track count, and resulting now-playing state.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun playMusic(
        appFunctionContext: AppFunctionContext,
        query: String? = null,
        @AppFunctionStringValueConstraint(
            enumValues = ["any", "track", "artist", "album", "playlist"],
        )
        mediaFocus: String? = null,
        artist: String? = null,
        album: String? = null,
        title: String? = null,
        playlist: String? = null,
    ): PlayMusicResult {
        val parsedFocus = parseMediaFocus("playMusic", mediaFocus)
        return executeBridgeCall(appFunctionContext, "playMusic") { context ->
            voiceExecutor.playMusic(
                context = context,
                query = normalizeOptionalText(query),
                mediaFocus = parsedFocus,
                artist = normalizeOptionalText(artist),
                album = normalizeOptionalText(album),
                title = normalizeOptionalText(title),
                playlist = normalizeOptionalText(playlist),
            )
        }.toAppFunctionModel()
    }

    /**
     * Controls the active LoggeRythm playback transport (play, pause, next, previous, or stop).
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param action Playback transport command to execute: play, pause, next, previous, or stop.
     * @return Updated snapshot of the LoggeRythm now-playing state after applying the command.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun controlPlayback(
        appFunctionContext: AppFunctionContext,
        @AppFunctionStringValueConstraint(
            enumValues = ["play", "pause", "next", "previous", "stop"],
        )
        action: String,
    ): NowPlayingResult {
        val parsedAction = parsePlaybackAction(action)
        return executeBridgeCall(appFunctionContext, "controlPlayback") { context ->
            voiceExecutor.controlPlayback(
                context = context,
                action = parsedAction,
            )
        }.toAppFunctionModel()
    }

    /**
     * Searches LoggeRythm for a track, artist, album, or playlist and adds the matching tracks to
     * the active playback queue without interrupting the currently playing audio.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param query Non-empty search query describing the music to add to the queue.
     * @param position Where in the queue to place the added tracks: next (play immediately after
     *   the current track) or end (append to the end of the queue). Defaults to end when omitted.
     * @param mediaFocus Optional target category for the search: any, track, artist, album, or playlist.
     * @param artist Optional artist name hint to refine matching.
     * @param album Optional album title hint to refine matching.
     * @param title Optional track title hint to refine matching.
     * @param playlist Optional playlist name hint to refine matching.
     * @return Details about the queued tracks, insertion position, and updated now-playing state.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun queueMusic(
        appFunctionContext: AppFunctionContext,
        query: String,
        @AppFunctionStringValueConstraint(enumValues = ["next", "end"])
        position: String? = null,
        @AppFunctionStringValueConstraint(
            enumValues = ["any", "track", "artist", "album", "playlist"],
        )
        mediaFocus: String? = null,
        artist: String? = null,
        album: String? = null,
        title: String? = null,
        playlist: String? = null,
    ): QueueMusicResult {
        val normalizedQuery = normalizeOptionalText(query)
            ?: throw AppFunctionInvalidArgumentException(
                "queueMusic requires a non-empty query describing what to add to the queue.",
            )
        val parsedPosition = parseQueuePosition(position)
        val parsedFocus = parseMediaFocus("queueMusic", mediaFocus)
        return executeBridgeCall(appFunctionContext, "queueMusic") { context ->
            voiceExecutor.queueMusic(
                context = context,
                query = normalizedQuery,
                position = parsedPosition,
                mediaFocus = parsedFocus,
                artist = normalizeOptionalText(artist),
                album = normalizeOptionalText(album),
                title = normalizeOptionalText(title),
                playlist = normalizeOptionalText(playlist),
            )
        }.toAppFunctionModel()
    }

    /**
     * Likes or unlikes the track currently loaded in LoggeRythm and persists the change to the
     * user's LoggeRythm account.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param liked True to add the current track to favorites, or false to remove it from favorites.
     * @return The affected track metadata, resulting favorite state, and whether the state changed.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun setCurrentTrackFavorite(
        appFunctionContext: AppFunctionContext,
        liked: Boolean,
    ): FavoriteTrackResult {
        return executeBridgeCall(appFunctionContext, "setCurrentTrackFavorite") { context ->
            voiceExecutor.setCurrentTrackFavorite(
                context = context,
                liked = liked,
            )
        }.toAppFunctionModel()
    }

    /**
     * Reads the currently playing or loaded track, playback state, favorite state, and queue
     * summary from LoggeRythm.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @return Current playback state and active track metadata snapshot.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun getNowPlaying(
        appFunctionContext: AppFunctionContext,
    ): NowPlayingResult {
        return executeBridgeCall(appFunctionContext, "getNowPlaying") { context ->
            voiceExecutor.getNowPlaying(context)
        }.toAppFunctionModel()
    }

    /**
     * Starts an endless LoggeRythm radio station either tailored to a requested mood or genre
     * (such as chill, workout, indie, jazz) or personalized to the signed-in listener when
     * omitted.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param moodOrGenre Optional mood or genre name to seed the radio station. Leave null for
     *   personalized radio.
     * @return Details about the started radio station, queued track count, and now-playing state.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun startRadio(
        appFunctionContext: AppFunctionContext,
        moodOrGenre: String? = null,
    ): PlayMusicResult {
        val normalizedMood = normalizeOptionalText(moodOrGenre)
        return executeBridgeCall(appFunctionContext, "startRadio") { context ->
            voiceExecutor.startRadio(
                context = context,
                moodOrGenre = normalizedMood,
            )
        }.toAppFunctionModel()
    }

    /**
     * Sets or cancels LoggeRythm's native sleep timer with a gentle fade-out before pausing
     * playback.
     *
     * @param appFunctionContext Android AppFunctions execution context.
     * @param minutes Duration in minutes before pausing playback (1 to 1440), or 0 to cancel an
     *   active sleep timer.
     * @return Resulting sleep timer state including remaining time and fade-out duration.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun setSleepTimer(
        appFunctionContext: AppFunctionContext,
        minutes: Int,
    ): SleepTimerResult {
        if (minutes < 0 || minutes > MAX_SLEEP_TIMER_MINUTES) {
            throw AppFunctionInvalidArgumentException(
                "setSleepTimer requires minutes between 0 and $MAX_SLEEP_TIMER_MINUTES (received $minutes).",
            )
        }
        return executeBridgeCall(appFunctionContext, "setSleepTimer") { context ->
            voiceExecutor.setSleepTimer(
                context = context,
                minutes = minutes,
            )
        }.toAppFunctionModel()
    }

    private suspend fun <T> executeBridgeCall(
        appFunctionContext: AppFunctionContext,
        operation: String,
        invoke: (Context) -> CompletableFuture<T>,
    ): T {
        val context = appFunctionContext.context.applicationContext ?: appFunctionContext.context
        return try {
            invoke(context).awaitCancellable()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Throwable) {
            throw LoggeRythmAppFunctionErrorMapper.toAppFunctionException(operation, error)
        }
    }

    private companion object {
        const val MAX_SLEEP_TIMER_MINUTES = 1_440

        fun normalizeOptionalText(value: String?): String? {
            return value?.trim()?.takeIf { it.isNotEmpty() }
        }

        fun parseMediaFocus(operation: String, raw: String?): LoggeRythmVoiceMediaFocus {
            val normalized = normalizeOptionalText(raw)?.lowercase(Locale.ROOT)
                ?: return LoggeRythmVoiceMediaFocus.ANY
            return when (normalized) {
                "any" -> LoggeRythmVoiceMediaFocus.ANY
                "track" -> LoggeRythmVoiceMediaFocus.TRACK
                "artist" -> LoggeRythmVoiceMediaFocus.ARTIST
                "album" -> LoggeRythmVoiceMediaFocus.ALBUM
                "playlist" -> LoggeRythmVoiceMediaFocus.PLAYLIST
                else -> throw AppFunctionInvalidArgumentException(
                    "$operation received unsupported mediaFocus '$raw'. Expected one of: any, track, artist, album, playlist.",
                )
            }
        }

        fun parsePlaybackAction(raw: String): LoggeRythmVoicePlaybackAction {
            val normalized = normalizeOptionalText(raw)?.lowercase(Locale.ROOT)
                ?: throw AppFunctionInvalidArgumentException(
                    "controlPlayback requires a non-empty action (play, pause, next, previous, stop).",
                )
            return when (normalized) {
                "play" -> LoggeRythmVoicePlaybackAction.PLAY
                "pause" -> LoggeRythmVoicePlaybackAction.PAUSE
                "next" -> LoggeRythmVoicePlaybackAction.NEXT
                "previous" -> LoggeRythmVoicePlaybackAction.PREVIOUS
                "stop" -> LoggeRythmVoicePlaybackAction.STOP
                else -> throw AppFunctionInvalidArgumentException(
                    "controlPlayback received unsupported action '$raw'. Expected one of: play, pause, next, previous, stop.",
                )
            }
        }

        fun parseQueuePosition(raw: String?): LoggeRythmVoiceQueuePosition {
            val normalized = normalizeOptionalText(raw)?.lowercase(Locale.ROOT)
                ?: return LoggeRythmVoiceQueuePosition.END
            return when (normalized) {
                "next" -> LoggeRythmVoiceQueuePosition.NEXT
                "end" -> LoggeRythmVoiceQueuePosition.END
                else -> throw AppFunctionInvalidArgumentException(
                    "queueMusic received unsupported position '$raw'. Expected one of: next, end.",
                )
            }
        }
    }
}

private suspend fun <T> CompletableFuture<T>.awaitCancellable(): T {
    if (isDone) {
        return try {
            get()
        } catch (error: Throwable) {
            throw LoggeRythmAppFunctionErrorMapper.unwrap(error)
        }
    }
    return suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation {
            cancel(false)
        }
        whenComplete { result, failure ->
            if (!continuation.isActive) return@whenComplete
            if (failure != null) {
                continuation.resumeWithException(LoggeRythmAppFunctionErrorMapper.unwrap(failure))
            } else {
                continuation.resume(result)
            }
        }
    }
}
