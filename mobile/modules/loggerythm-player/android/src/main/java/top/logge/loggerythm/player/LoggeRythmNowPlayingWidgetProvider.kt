package top.logge.loggerythm.player

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Process
import android.util.Log
import android.widget.RemoteViews
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.util.Locale
import java.util.concurrent.Executors
import okhttp3.Request

internal enum class LoggeRythmWidgetAction(val actionString: String, val requestCode: Int) {
  TOGGLE_PLAY_PAUSE("top.logge.loggerythm.widget.ACTION_TOGGLE_PLAY_PAUSE", 0x4C5210),
  NEXT("top.logge.loggerythm.widget.ACTION_NEXT", 0x4C5211),
  PREVIOUS("top.logge.loggerythm.widget.ACTION_PREVIOUS", 0x4C5212),
  TOGGLE_FAVORITE("top.logge.loggerythm.widget.ACTION_TOGGLE_FAVORITE", 0x4C5213);

  companion object {
    fun fromIntentAction(action: String?): LoggeRythmWidgetAction? =
      entries.firstOrNull { it.actionString == action }
  }
}

internal data class LoggeRythmWidgetSnapshot(
  val hasActiveTrack: Boolean,
  val title: String?,
  val artist: String?,
  val artworkUrl: String?,
  val isPlaying: Boolean,
  val liked: Boolean?,
)

/** Pure, JVM-testable decision helpers for the Now Playing home-screen widget. */
internal object LoggeRythmWidgetPolicy {
  fun resolveTitle(snapshot: LoggeRythmWidgetSnapshot, emptyTitle: String): String =
    snapshot.title?.trim()?.takeIf(String::isNotEmpty) ?: emptyTitle

  fun resolveSubtitle(snapshot: LoggeRythmWidgetSnapshot, emptySubtitle: String): String =
    snapshot.artist?.trim()?.takeIf(String::isNotEmpty) ?: emptySubtitle

  fun togglePlaybackAction(isPlaying: Boolean): LoggeRythmVoicePlaybackAction =
    if (isPlaying) LoggeRythmVoicePlaybackAction.PAUSE else LoggeRythmVoicePlaybackAction.PLAY

  fun nextLikedState(currentLiked: Boolean?): Boolean = !(currentLiked ?: false)
}

internal object LoggeRythmWidgetUpdater {
  private const val MAX_ARTWORK_CACHE = 8
  private const val MAX_ARTWORK_BYTES = 5L * 1024L * 1024L
  private const val TARGET_ARTWORK_PX = 192
  private val httpClient = failClosedMediaHttpClient()
  private val artworkExecutor = Executors.newSingleThreadExecutor { task ->
    Thread(
      {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        task.run()
      },
      "LoggeRythmWidgetArt",
    )
  }
  private val lock = Any()
  private var lastSnapshot = LoggeRythmWidgetSnapshot(
    hasActiveTrack = false,
    title = null,
    artist = null,
    artworkUrl = null,
    isPlaying = false,
    liked = null,
  )
  private val bitmapCache = object : LinkedHashMap<String, Bitmap>(MAX_ARTWORK_CACHE, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean =
      size > MAX_ARTWORK_CACHE
  }

  fun currentSnapshot(): LoggeRythmWidgetSnapshot = synchronized(lock) { lastSnapshot }

  fun clearForAccountBoundary(context: Context) {
    val empty = LoggeRythmWidgetSnapshot(
      hasActiveTrack = false,
      title = null,
      artist = null,
      artworkUrl = null,
      isPlaying = false,
      liked = null,
    )
    synchronized(lock) {
      lastSnapshot = empty
      bitmapCache.clear()
    }
    publishSnapshot(context, empty)
  }

  fun publishSnapshot(context: Context, snapshot: LoggeRythmWidgetSnapshot) {
    val appContext = context.applicationContext
    synchronized(lock) { lastSnapshot = snapshot }
    val manager = AppWidgetManager.getInstance(appContext) ?: return
    val component = ComponentName(appContext, LoggeRythmNowPlayingWidgetProvider::class.java)
    val widgetIds = manager.getAppWidgetIds(component)
    if (widgetIds.isEmpty()) return

    val cachedBitmap = snapshot.artworkUrl?.let { url -> synchronized(lock) { bitmapCache[url] } }
    val views = buildRemoteViews(appContext, snapshot, cachedBitmap)
    manager.updateAppWidget(widgetIds, views)

    val artworkUrl = snapshot.artworkUrl
    if (artworkUrl != null && cachedBitmap == null) {
      artworkExecutor.execute {
        val loaded = try {
          loadArtworkBitmap(appContext, artworkUrl)
        } catch (error: Throwable) {
          Log.e(WIDGET_TAG, "Widget artwork load failed (${error.javaClass.simpleName})")
          null
        } ?: return@execute
        synchronized(lock) {
          bitmapCache[artworkUrl] = loaded
          if (lastSnapshot.artworkUrl != artworkUrl) return@execute
        }
        val latest = synchronized(lock) { lastSnapshot }
        val updatedViews = buildRemoteViews(appContext, latest, loaded)
        val latestIds = manager.getAppWidgetIds(component)
        if (latestIds.isNotEmpty()) {
          manager.updateAppWidget(latestIds, updatedViews)
        }
      }
    }
  }

  internal fun buildRemoteViews(
    context: Context,
    snapshot: LoggeRythmWidgetSnapshot,
    artworkBitmap: Bitmap?,
  ): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.loggerythm_widget_now_playing)
    val emptyTitle = context.getString(R.string.loggerythm_widget_empty_title)
    val emptySubtitle = context.getString(R.string.loggerythm_widget_empty_subtitle)
    views.setTextViewText(R.id.widget_title, LoggeRythmWidgetPolicy.resolveTitle(snapshot, emptyTitle))
    views.setTextViewText(R.id.widget_artist, LoggeRythmWidgetPolicy.resolveSubtitle(snapshot, emptySubtitle))
    if (artworkBitmap != null) {
      views.setImageViewBitmap(R.id.widget_artwork, artworkBitmap)
    } else {
      views.setImageViewResource(R.id.widget_artwork, R.drawable.ic_loggerythm_widget_music_note)
    }
    views.setImageViewResource(
      R.id.widget_btn_play_pause,
      if (snapshot.isPlaying) R.drawable.ic_loggerythm_widget_pause else R.drawable.ic_loggerythm_widget_play,
    )
    views.setImageViewResource(
      R.id.widget_btn_favorite,
      if (snapshot.liked == true) R.drawable.ic_loggerythm_widget_heart_filled else R.drawable.ic_loggerythm_widget_heart_outline,
    )
    runCatching { LoggeRythmSessionActivity.pendingIntent(context) }.onSuccess { openApp ->
      views.setOnClickPendingIntent(R.id.widget_artwork_container, openApp)
      views.setOnClickPendingIntent(R.id.widget_meta, openApp)
    }
    views.setOnClickPendingIntent(
      R.id.widget_btn_play_pause,
      actionPendingIntent(context, LoggeRythmWidgetAction.TOGGLE_PLAY_PAUSE),
    )
    views.setOnClickPendingIntent(
      R.id.widget_btn_previous,
      actionPendingIntent(context, LoggeRythmWidgetAction.PREVIOUS),
    )
    views.setOnClickPendingIntent(
      R.id.widget_btn_next,
      actionPendingIntent(context, LoggeRythmWidgetAction.NEXT),
    )
    views.setOnClickPendingIntent(
      R.id.widget_btn_favorite,
      actionPendingIntent(context, LoggeRythmWidgetAction.TOGGLE_FAVORITE),
    )
    return views
  }

  private fun actionPendingIntent(
    context: Context,
    action: LoggeRythmWidgetAction,
  ): PendingIntent {
    // Route button actions exclusively to our non-exported receiver so third-party apps
    // cannot spoof playback/favorite commands against the exported AppWidgetProvider.
    val intent = Intent(context, LoggeRythmWidgetActionReceiver::class.java)
      .setPackage(context.packageName)
      .setAction(action.actionString)
    return PendingIntent.getBroadcast(
      context,
      action.requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun loadArtworkBitmap(context: Context, rawUrl: String): Bitmap? {
    val uri = URI(rawUrl)
    val bytes = when (uri.scheme?.lowercase(Locale.ROOT)) {
      "file" -> {
        val candidate = File(uri).canonicalFile
        val roots = listOf(context.filesDir, context.noBackupFilesDir, context.cacheDir)
          .map(File::getCanonicalFile)
        val inside = roots.any { root ->
          candidate.path.startsWith(root.path.trimEnd(File.separatorChar) + File.separator)
        }
        if (!inside || !candidate.isFile || candidate.length() !in 1L..MAX_ARTWORK_BYTES) return null
        candidate.readBytes()
      }
      "https" -> {
        val reqBuilder = Request.Builder().url(uri.toASCIIString()).get()
        resolveOriginCookie(uri)?.let { cookie -> reqBuilder.header("Cookie", cookie) }
        httpClient.newCall(reqBuilder.build()).execute().use { response ->
          if (response.code != 200) return null
          val body = response.body ?: return null
          if (body.contentLength() > MAX_ARTWORK_BYTES) return null
          body.byteStream().use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var total = 0L
            while (true) {
              val read = input.read(buf)
              if (read < 0) break
              total += read
              if (total > MAX_ARTWORK_BYTES) return null
              out.write(buf, 0, read)
            }
            out.toByteArray()
          }
        }
      }
      else -> return null
    }
    if (bytes.isEmpty()) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply {
      inSampleSize = LoggeRythmArtworkPaletteExtractor.computeSampleSize(
        bounds.outWidth,
        bounds.outHeight,
        TARGET_ARTWORK_PX,
      )
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun resolveOriginCookie(uri: URI): String? {
    LoggeRythmPlayerRuntime.cookieFor(uri.toASCIIString())?.let { return it }
    val (boundOrigin, cookie) = LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin() ?: return null
    val port = if (uri.port == 443) -1 else uri.port
    val origin = runCatching {
      URI("https", null, uri.host?.lowercase(Locale.ROOT), port, null, null, null).toASCIIString()
    }.getOrNull() ?: return null
    return if (origin == boundOrigin) cookie else null
  }
}

private const val WIDGET_TAG = "LoggeRythmWidget"

/**
 * Native Android Home Screen Now Playing widget (`android:exported="true"` strictly for
 * `APPWIDGET_UPDATE`). Button controls route to non-exported [LoggeRythmWidgetActionReceiver].
 */
public class LoggeRythmNowPlayingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    super.onUpdate(context, appWidgetManager, appWidgetIds)
    val snapshot = LoggeRythmWidgetUpdater.currentSnapshot()
    LoggeRythmWidgetUpdater.publishSnapshot(context, snapshot)
    val pendingResult = goAsync()
    LoggeRythmVoiceBridge.getNowPlaying(context).whenComplete { nowPlaying, error ->
      try {
        if (error != null) {
          Log.e(WIDGET_TAG, "Widget refresh failed (${error.javaClass.simpleName})")
        } else if (nowPlaying != null) {
          LoggeRythmWidgetUpdater.publishSnapshot(
            context,
            LoggeRythmWidgetSnapshot(
              hasActiveTrack = nowPlaying.hasActiveTrack,
              title = nowPlaying.track?.title,
              artist = nowPlaying.track?.artist,
              artworkUrl = nowPlaying.track?.artworkUrl,
              isPlaying = nowPlaying.isPlaying,
              liked = nowPlaying.liked,
            ),
          )
        }
      } finally {
        pendingResult.finish()
      }
    }
  }
}

/**
 * Non-exported (`android:exported="false"`) broadcast receiver for Home Screen widget button
 * `PendingIntent`s. Only app-issued `PendingIntent`s can deliver actions here, blocking
 * cross-package action spoofing.
 */
public class LoggeRythmWidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = LoggeRythmWidgetAction.fromIntentAction(intent.action) ?: return
    val pendingResult = goAsync()
    val future = when (action) {
      LoggeRythmWidgetAction.TOGGLE_PLAY_PAUSE -> {
        val current = LoggeRythmWidgetUpdater.currentSnapshot()
        LoggeRythmVoiceBridge.controlPlayback(
          context,
          LoggeRythmWidgetPolicy.togglePlaybackAction(current.isPlaying),
        )
      }
      LoggeRythmWidgetAction.NEXT ->
        LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.NEXT)
      LoggeRythmWidgetAction.PREVIOUS ->
        LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.PREVIOUS)
      LoggeRythmWidgetAction.TOGGLE_FAVORITE -> {
        val nextLiked = LoggeRythmWidgetPolicy.nextLikedState(
          LoggeRythmWidgetUpdater.currentSnapshot().liked,
        )
        LoggeRythmVoiceBridge.setCurrentTrackFavorite(context, nextLiked)
      }
    }
    future.whenComplete { _, error ->
      try {
        if (error != null) {
          Log.e(WIDGET_TAG, "Widget action ${action.name} failed (${error.javaClass.simpleName})")
        }
      } finally {
        pendingResult.finish()
      }
    }
  }
}
