package top.logge.loggerythm.appfunctions

import androidx.appfunctions.AppFunctionSerializable
import top.logge.loggerythm.player.LoggeRythmVoiceFavoriteResult
import top.logge.loggerythm.player.LoggeRythmVoiceNowPlaying
import top.logge.loggerythm.player.LoggeRythmVoicePlayResult
import top.logge.loggerythm.player.LoggeRythmVoicePlaybackState
import top.logge.loggerythm.player.LoggeRythmVoiceQueuePosition
import top.logge.loggerythm.player.LoggeRythmVoiceQueueResult
import top.logge.loggerythm.player.LoggeRythmVoiceSleepTimerResult
import top.logge.loggerythm.player.LoggeRythmVoiceTrackSummary

/**
 * Metadata summary for a LoggeRythm audio track.
 *
 * @property mediaId Stable Media3 playback identifier for the track.
 * @property trackId Canonical LoggeRythm server track identifier, or null if unavailable.
 * @property title Human-readable track title.
 * @property artist Primary artist name for the track.
 * @property album Album title, or an empty string if the track has no album metadata.
 * @property durationMs Total track duration in milliseconds, or null if unknown.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class TrackInfo(
    val mediaId: String,
    val trackId: String?,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long?,
)

/**
 * Snapshot of the current LoggeRythm playback session, active track, and queue state.
 *
 * @property hasActiveTrack Whether a track is currently loaded in the playback queue.
 * @property track Metadata for the currently loaded track, or null when the queue is empty.
 * @property isPlaying Whether audio is actively playing right now.
 * @property playWhenReady Whether playback is armed to play once buffering completes.
 * @property playbackState Normalized player state: idle, buffering, ready, or ended.
 * @property positionMs Current playback position in milliseconds.
 * @property durationMs Duration of the current track in milliseconds, or null if unknown.
 * @property liked Favorite state of the current track, or null if unknown or no track is active.
 * @property queueSize Total number of tracks currently in the playback queue.
 * @property currentIndex Zero-based index of the current track in the queue, or null if empty.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class NowPlayingResult(
    val hasActiveTrack: Boolean,
    val track: TrackInfo?,
    val isPlaying: Boolean,
    val playWhenReady: Boolean,
    val playbackState: String,
    val positionMs: Long,
    val durationMs: Long?,
    val liked: Boolean?,
    val queueSize: Int,
    val currentIndex: Int?,
)

/**
 * Result returned after starting or resuming music playback in LoggeRythm.
 *
 * @property source Source resolved to start playback (for example track, album, artist, playlist, or resume).
 * @property matchedTitle Display title of the matched track, album, artist, or playlist.
 * @property queuedCount Number of tracks loaded into the playback queue.
 * @property nowPlaying Playback snapshot immediately after starting playback.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class PlayMusicResult(
    val source: String,
    val matchedTitle: String,
    val queuedCount: Int,
    val nowPlaying: NowPlayingResult,
)

/**
 * Result returned after inserting or appending tracks into the LoggeRythm playback queue.
 *
 * @property source Source resolved for the queued music request.
 * @property position Queue insertion position applied: next or end.
 * @property addedCount Number of tracks added to the active playback queue.
 * @property firstAdded Metadata for the first added track.
 * @property nowPlaying Playback snapshot after the queue update completes.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class QueueMusicResult(
    val source: String,
    val position: String,
    val addedCount: Int,
    val firstAdded: TrackInfo,
    val nowPlaying: NowPlayingResult,
)

/**
 * Result returned after liking or unliking the currently active LoggeRythm track.
 *
 * @property track Metadata for the track whose favorite state was updated.
 * @property liked Resulting favorite state: true if liked, false if unliked.
 * @property changed Whether the server-side favorite state changed during this request.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class FavoriteTrackResult(
    val track: TrackInfo,
    val liked: Boolean,
    val changed: Boolean,
)

/**
 * Result returned after setting or cancelling the LoggeRythm sleep timer.
 *
 * @property active True when a sleep timer is armed, false when cancelled.
 * @property minutesRequested Requested sleep timer duration in minutes (0 when cancelled).
 * @property remainingMs Remaining duration until playback pauses in milliseconds.
 * @property fadeOutMs Fade-out window applied at the end of the sleep timer in milliseconds.
 */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class SleepTimerResult(
    val active: Boolean,
    val minutesRequested: Int,
    val remainingMs: Long,
    val fadeOutMs: Long,
)

internal fun LoggeRythmVoiceTrackSummary.toAppFunctionModel(): TrackInfo = TrackInfo(
    mediaId = mediaId,
    trackId = trackId,
    title = title,
    artist = artist,
    album = album,
    durationMs = durationMs,
)

internal fun LoggeRythmVoicePlaybackState.toWireValue(): String = when (this) {
    LoggeRythmVoicePlaybackState.IDLE -> "idle"
    LoggeRythmVoicePlaybackState.BUFFERING -> "buffering"
    LoggeRythmVoicePlaybackState.READY -> "ready"
    LoggeRythmVoicePlaybackState.ENDED -> "ended"
}

internal fun LoggeRythmVoiceQueuePosition.toWireValue(): String = when (this) {
    LoggeRythmVoiceQueuePosition.NEXT -> "next"
    LoggeRythmVoiceQueuePosition.END -> "end"
}

internal fun LoggeRythmVoiceNowPlaying.toAppFunctionModel(): NowPlayingResult = NowPlayingResult(
    hasActiveTrack = hasActiveTrack,
    track = track?.toAppFunctionModel(),
    isPlaying = isPlaying,
    playWhenReady = playWhenReady,
    playbackState = playbackState.toWireValue(),
    positionMs = positionMs,
    durationMs = durationMs,
    liked = liked,
    queueSize = queueSize,
    currentIndex = currentIndex,
)

internal fun LoggeRythmVoicePlayResult.toAppFunctionModel(): PlayMusicResult = PlayMusicResult(
    source = source,
    matchedTitle = matchedTitle,
    queuedCount = queuedCount,
    nowPlaying = nowPlaying.toAppFunctionModel(),
)

internal fun LoggeRythmVoiceQueueResult.toAppFunctionModel(): QueueMusicResult = QueueMusicResult(
    source = source,
    position = position.toWireValue(),
    addedCount = addedCount,
    firstAdded = firstAdded.toAppFunctionModel(),
    nowPlaying = nowPlaying.toAppFunctionModel(),
)

internal fun LoggeRythmVoiceFavoriteResult.toAppFunctionModel(): FavoriteTrackResult =
    FavoriteTrackResult(
        track = track.toAppFunctionModel(),
        liked = liked,
        changed = changed,
    )

internal fun LoggeRythmVoiceSleepTimerResult.toAppFunctionModel(): SleepTimerResult =
    SleepTimerResult(
        active = active,
        minutesRequested = minutesRequested,
        remainingMs = remainingMs,
        fadeOutMs = fadeOutMs,
    )
