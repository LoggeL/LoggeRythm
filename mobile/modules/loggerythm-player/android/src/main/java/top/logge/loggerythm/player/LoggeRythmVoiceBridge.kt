package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean

/** Explicit, fail-loud error codes for native voice and AppFunctions commands. */
public enum class LoggeRythmVoiceErrorCode {
  AUTH_REQUIRED,
  SERVICE_UNAVAILABLE,
  NOT_READY,
  CONTROLS_NOT_READY,
  BUSY,
  INVALID_ARGUMENT,
  SEARCH_NO_MATCH,
  NETWORK_ERROR,
  NOTHING_TO_PLAY,
  NO_ACTIVE_TRACK,
  FAVORITE_UNAVAILABLE,
  FAVORITE_UPDATE_FAILED,
  QUEUE_UNAVAILABLE,
}

/**
 * Fail-loud exception raised (or completed exceptionally on a [CompletableFuture]) by
 * [LoggeRythmVoiceCommandExecutor] / [LoggeRythmVoiceBridge].
 * Never carries URLs, Cookies, or sensitive account identifiers in [message].
 */
public class LoggeRythmVoiceException(
  public val code: LoggeRythmVoiceErrorCode,
  message: String,
  cause: Throwable? = null,
) : RuntimeException(message, cause)

public enum class LoggeRythmVoiceMediaFocus {
  ANY,
  TRACK,
  ARTIST,
  ALBUM,
  PLAYLIST,
}

public enum class LoggeRythmVoicePlaybackAction {
  PLAY,
  PAUSE,
  NEXT,
  PREVIOUS,
  STOP,
}

public enum class LoggeRythmVoiceQueuePosition {
  NEXT,
  END,
}

public enum class LoggeRythmVoicePlaybackState {
  IDLE,
  BUFFERING,
  READY,
  ENDED,
}

public data class LoggeRythmVoiceTrackSummary(
  val mediaId: String,
  val trackId: String?,
  val title: String,
  val artist: String,
  val album: String,
  val durationMs: Long?,
)

public data class LoggeRythmVoiceNowPlaying(
  val hasActiveTrack: Boolean,
  val track: LoggeRythmVoiceTrackSummary?,
  val isPlaying: Boolean,
  val playWhenReady: Boolean,
  val playbackState: LoggeRythmVoicePlaybackState,
  val positionMs: Long,
  val durationMs: Long?,
  val liked: Boolean?,
  val queueSize: Int,
  val currentIndex: Int?,
)

public data class LoggeRythmVoicePlayResult(
  val source: String,
  val matchedTitle: String,
  val queuedCount: Int,
  val nowPlaying: LoggeRythmVoiceNowPlaying,
)

public data class LoggeRythmVoiceQueueResult(
  val source: String,
  val position: LoggeRythmVoiceQueuePosition,
  val addedCount: Int,
  val firstAdded: LoggeRythmVoiceTrackSummary,
  val nowPlaying: LoggeRythmVoiceNowPlaying,
)

public data class LoggeRythmVoiceFavoriteResult(
  val track: LoggeRythmVoiceTrackSummary,
  val liked: Boolean,
  val changed: Boolean,
)

/**
 * Injectable execution contract shared between `loggerythm-player` and `loggerythm-appfunctions`.
 * All methods fail loudly with [LoggeRythmVoiceException] (completed exceptionally on the returned
 * [CompletableFuture]); none silently falls back or masks auth/network/no-match failures.
 */
public interface LoggeRythmVoiceCommandExecutor {
  public fun playMusic(
    context: Context,
    query: String? = null,
    mediaFocus: LoggeRythmVoiceMediaFocus = LoggeRythmVoiceMediaFocus.ANY,
    artist: String? = null,
    album: String? = null,
    title: String? = null,
    playlist: String? = null,
  ): CompletableFuture<LoggeRythmVoicePlayResult>

  public fun controlPlayback(
    context: Context,
    action: LoggeRythmVoicePlaybackAction,
  ): CompletableFuture<LoggeRythmVoiceNowPlaying>

  public fun queueMusic(
    context: Context,
    query: String,
    position: LoggeRythmVoiceQueuePosition = LoggeRythmVoiceQueuePosition.END,
    mediaFocus: LoggeRythmVoiceMediaFocus = LoggeRythmVoiceMediaFocus.ANY,
    artist: String? = null,
    album: String? = null,
    title: String? = null,
    playlist: String? = null,
  ): CompletableFuture<LoggeRythmVoiceQueueResult>

  public fun setCurrentTrackFavorite(
    context: Context,
    liked: Boolean,
  ): CompletableFuture<LoggeRythmVoiceFavoriteResult>

  public fun getNowPlaying(
    context: Context,
  ): CompletableFuture<LoggeRythmVoiceNowPlaying>
}

internal interface LoggeRythmVoiceServiceControl {
  fun executePlayMusic(
    request: LoggeRythmVoiceQuery,
    callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
  )

  fun executeControlPlayback(
    action: LoggeRythmVoicePlaybackAction,
    callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
  )

  fun executeQueueMusic(
    request: LoggeRythmVoiceQuery,
    position: LoggeRythmVoiceQueuePosition,
    callback: (Result<LoggeRythmVoiceQueueResult>) -> Unit,
  )

  fun executeSetCurrentTrackFavorite(
    liked: Boolean,
    callback: (Result<LoggeRythmVoiceFavoriteResult>) -> Unit,
  )

  fun executeGetNowPlaying(
    callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
  )
}

/**
 * In-process bridge from [LoggeRythmVoiceBridge] (e.g. Android 16 AppFunctionService) to
 * [LoggeRythmMediaLibraryService]. Carries no credentials or URLs.
 */
internal object LoggeRythmVoiceServiceBridge {
  private val lock = Any()
  private var control: LoggeRythmVoiceServiceControl? = null
  private val attachWaiters = mutableListOf<(LoggeRythmVoiceServiceControl) -> Unit>()

  fun attach(value: LoggeRythmVoiceServiceControl) {
    val waiters = synchronized(lock) {
      if (control != null && control !== value) {
        throw LoggeRythmVoiceException(
          LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
          "voice-service-control-active",
        )
      }
      control = value
      attachWaiters.toList().also { attachWaiters.clear() }
    }
    waiters.forEach { waiter -> runCatching { waiter(value) } }
  }

  fun detach(value: LoggeRythmVoiceServiceControl) {
    synchronized(lock) {
      if (control === value) control = null
    }
  }

  fun current(): LoggeRythmVoiceServiceControl? = synchronized(lock) { control }

  fun awaitOrCurrent(onAttached: (LoggeRythmVoiceServiceControl) -> Unit): () -> Unit {
    val active = synchronized(lock) {
      val existing = control
      if (existing != null) {
        existing
      } else {
        attachWaiters += onAttached
        null
      }
    }
    if (active != null) {
      onAttached(active)
      return {}
    }
    return {
      synchronized(lock) { attachWaiters.remove(onAttached) }
    }
  }
}

public object LoggeRythmVoiceBridge : LoggeRythmVoiceCommandExecutor {
  private const val MEDIA_LIBRARY_SERVICE_ACTION = "androidx.media3.session.MediaLibraryService"
  private const val MEDIA_LIBRARY_SERVICE_CLASS =
    "top.logge.loggerythm.player.LoggeRythmMediaLibraryService"
  private const val SERVICE_BIND_TIMEOUT_MS = 15_000L
  private const val MAX_QUERY_FIELD_LENGTH = 256

  override fun playMusic(
    context: Context,
    query: String?,
    mediaFocus: LoggeRythmVoiceMediaFocus,
    artist: String?,
    album: String?,
    title: String?,
    playlist: String?,
  ): CompletableFuture<LoggeRythmVoicePlayResult> {
    val validated = try {
      buildValidatedQuery(
        rawQuery = query,
        mediaFocus = mediaFocus,
        artist = artist,
        album = album,
        title = title,
        playlist = playlist,
        requireNonBlank = false,
      )
    } catch (error: LoggeRythmVoiceException) {
      return failedFuture(error)
    }
    return executeWithService(context) { service, callback ->
      service.executePlayMusic(validated, callback)
    }
  }

  override fun controlPlayback(
    context: Context,
    action: LoggeRythmVoicePlaybackAction,
  ): CompletableFuture<LoggeRythmVoiceNowPlaying> =
    executeWithService(context) { service, callback ->
      service.executeControlPlayback(action, callback)
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
    val validated = try {
      buildValidatedQuery(
        rawQuery = query,
        mediaFocus = mediaFocus,
        artist = artist,
        album = album,
        title = title,
        playlist = playlist,
        requireNonBlank = true,
      )
    } catch (error: LoggeRythmVoiceException) {
      return failedFuture(error)
    }
    return executeWithService(context) { service, callback ->
      service.executeQueueMusic(validated, position, callback)
    }
  }

  override fun setCurrentTrackFavorite(
    context: Context,
    liked: Boolean,
  ): CompletableFuture<LoggeRythmVoiceFavoriteResult> =
    executeWithService(context) { service, callback ->
      service.executeSetCurrentTrackFavorite(liked, callback)
    }

  override fun getNowPlaying(
    context: Context,
  ): CompletableFuture<LoggeRythmVoiceNowPlaying> =
    executeWithService(context) { service, callback ->
      service.executeGetNowPlaying(callback)
    }

  internal fun buildValidatedQuery(
    rawQuery: String?,
    mediaFocus: LoggeRythmVoiceMediaFocus,
    artist: String?,
    album: String?,
    title: String?,
    playlist: String?,
    requireNonBlank: Boolean,
  ): LoggeRythmVoiceQuery {
    val cleanQuery = sanitizeField(rawQuery, "query")
    val cleanArtist = sanitizeField(artist, "artist")
    val cleanAlbum = sanitizeField(album, "album")
    val cleanTitle = sanitizeField(title, "title")
    val cleanPlaylist = sanitizeField(playlist, "playlist")
    val inferredFocus = if (mediaFocus != LoggeRythmVoiceMediaFocus.ANY) {
      mediaFocus
    } else {
      LoggeRythmVoiceQuery.inferFocus(
        artist = cleanArtist,
        album = cleanAlbum,
        title = cleanTitle,
        playlist = cleanPlaylist,
      )
    }
    val built = LoggeRythmVoiceQuery(
      rawQuery = cleanQuery.orEmpty(),
      mediaFocus = inferredFocus,
      artist = cleanArtist,
      album = cleanAlbum,
      title = cleanTitle,
      playlist = cleanPlaylist,
    )
    if (requireNonBlank && built.isBlank()) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
        "Voice command requires a non-blank query or structured target",
      )
    }
    return built
  }

  private fun sanitizeField(value: String?, name: String): String? {
    if (value == null) return null
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.length > MAX_QUERY_FIELD_LENGTH) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
        "Voice parameter '$name' exceeds maximum length ($MAX_QUERY_FIELD_LENGTH)",
      )
    }
    if (trimmed.any { ch -> ch.code < 0x20 || ch.code == 0x7f }) {
      throw LoggeRythmVoiceException(
        LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
        "Voice parameter '$name' contains invalid control characters",
      )
    }
    return trimmed
  }

  private fun <T> executeWithService(
    context: Context,
    action: (LoggeRythmVoiceServiceControl, (Result<T>) -> Unit) -> Unit,
  ): CompletableFuture<T> {
    val future = CompletableFuture<T>()
    val mainHandler = Handler(Looper.getMainLooper())
    val existing = LoggeRythmVoiceServiceBridge.current()
    if (existing != null) {
      mainHandler.post {
        invokeControl(existing, future, action, onDone = {})
      }
      return future
    }

    val appContext = context.applicationContext
    val settled = AtomicBoolean(false)
    val dispatched = AtomicBoolean(false)
    val bound = AtomicBoolean(false)
    var cancelWaiter: (() -> Unit)? = null
    var connection: ServiceConnection? = null

    fun unbindIfNeeded() {
      val activeConn = connection
      if (activeConn != null && bound.compareAndSet(true, false)) {
        runCatching { appContext.unbindService(activeConn) }
      }
    }

    val timeoutRunnable = Runnable {
      if (settled.compareAndSet(false, true)) {
        cancelWaiter?.invoke()
        unbindIfNeeded()
        future.completeExceptionally(
          LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
            "LoggeRythm media service did not become ready before timeout",
          ),
        )
      }
    }

    fun failBind(code: String) {
      if (settled.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeoutRunnable)
        cancelWaiter?.invoke()
        unbindIfNeeded()
        future.completeExceptionally(
          LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE, code),
        )
      }
    }

    fun dispatch(control: LoggeRythmVoiceServiceControl) {
      if (!dispatched.compareAndSet(false, true)) return
      mainHandler.removeCallbacks(timeoutRunnable)
      cancelWaiter?.invoke()
      if (settled.get()) {
        unbindIfNeeded()
        return
      }
      mainHandler.post {
        invokeControl(control, future, action) {
          settled.set(true)
          unbindIfNeeded()
        }
      }
    }

    val serviceConnection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
        LoggeRythmVoiceServiceBridge.current()?.let(::dispatch)
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        if (!dispatched.get()) failBind("voice-service-disconnected")
      }

      override fun onNullBinding(name: ComponentName?) {
        failBind("voice-service-null-binding")
      }

      override fun onBindingDied(name: ComponentName?) {
        if (!dispatched.get()) failBind("voice-service-binding-died")
      }
    }
    connection = serviceConnection
    cancelWaiter = LoggeRythmVoiceServiceBridge.awaitOrCurrent(::dispatch)
    mainHandler.postDelayed(timeoutRunnable, SERVICE_BIND_TIMEOUT_MS)

    val intent = Intent(MEDIA_LIBRARY_SERVICE_ACTION).setComponent(
      ComponentName(appContext.packageName, MEDIA_LIBRARY_SERVICE_CLASS),
    )
    val didBind = try {
      appContext.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    } catch (_: Exception) {
      false
    }
    if (didBind) {
      bound.set(true)
      if (settled.get()) unbindIfNeeded()
    } else {
      failBind("voice-service-bind-failed")
    }
    return future
  }

  private fun <T> invokeControl(
    control: LoggeRythmVoiceServiceControl,
    future: CompletableFuture<T>,
    action: (LoggeRythmVoiceServiceControl, (Result<T>) -> Unit) -> Unit,
    onDone: () -> Unit,
  ) {
    try {
      action(control) { result ->
        try {
          result.fold(
            onSuccess = { value -> future.complete(value) },
            onFailure = { error -> future.completeExceptionally(asVoiceException(error)) },
          )
        } finally {
          onDone()
        }
      }
    } catch (error: Throwable) {
      try {
        future.completeExceptionally(asVoiceException(error))
      } finally {
        onDone()
      }
    }
  }

  internal fun asVoiceException(error: Throwable): LoggeRythmVoiceException = when (error) {
    is LoggeRythmVoiceException -> error
    is LoggeRythmCarRequestException -> LoggeRythmVoiceException(
      code = mapCarError(error.error),
      message = error.error.code,
      cause = error,
    )
    is PlayerProtocolException -> LoggeRythmVoiceException(
      code = LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
      message = error.code,
      cause = error,
    )
    else -> LoggeRythmVoiceException(
      code = LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
      message = error.javaClass.simpleName,
      cause = error,
    )
  }

  internal fun mapCarError(error: LoggeRythmCarError): LoggeRythmVoiceErrorCode = when (error) {
    LoggeRythmCarError.SIGNED_OUT -> LoggeRythmVoiceErrorCode.AUTH_REQUIRED
    LoggeRythmCarError.RESTORE_FAILED,
    LoggeRythmCarError.LIBRARY_EMPTY,
    LoggeRythmCarError.LIBRARY_REFRESH_REQUIRED,
    LoggeRythmCarError.SESSION_NOT_READY,
    -> LoggeRythmVoiceErrorCode.NOT_READY
    LoggeRythmCarError.CONTROLS_NOT_READY -> LoggeRythmVoiceErrorCode.CONTROLS_NOT_READY
    LoggeRythmCarError.CACHE_CLEARING,
    LoggeRythmCarError.QUEUE_COMMIT_ACTIVE,
    -> LoggeRythmVoiceErrorCode.BUSY
    LoggeRythmCarError.SEARCH_NO_MATCH -> LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH
    LoggeRythmCarError.SEARCH_NETWORK_ERROR -> LoggeRythmVoiceErrorCode.NETWORK_ERROR
    LoggeRythmCarError.NOTHING_TO_PLAY -> LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY
    LoggeRythmCarError.FAVORITE_UNAVAILABLE -> LoggeRythmVoiceErrorCode.FAVORITE_UNAVAILABLE
    LoggeRythmCarError.FAVORITE_UPDATE_FAILED -> LoggeRythmVoiceErrorCode.FAVORITE_UPDATE_FAILED
    LoggeRythmCarError.LIST_UNAVAILABLE,
    LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE,
    LoggeRythmCarError.UNSUPPORTED_REQUEST,
    -> LoggeRythmVoiceErrorCode.INVALID_ARGUMENT
  }

  private fun <T> failedFuture(error: LoggeRythmVoiceException): CompletableFuture<T> =
    CompletableFuture<T>().apply { completeExceptionally(error) }
}
