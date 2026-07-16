package top.logge.loggerythm.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheKeyFactory
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class LoggeRythmCacheException(val code: String) : IllegalStateException(code)

internal data class LoggeRythmCacheClearResult(
  val bytesBefore: Long,
  val bytesAfter: Long,
  val resourcesRemoved: Int,
  val verified: Boolean,
)

internal class LoggeRythmCacheOperationState(available: Boolean) {
  private enum class State { READY, CLEARING, UNAVAILABLE, CLOSED }

  private var generation = 0L
  private var state = if (available) State.READY else State.UNAVAILABLE

  @Synchronized
  fun beginClear(): Long? {
    if (state != State.READY) return null
    state = State.CLEARING
    generation += 1
    return generation
  }

  @Synchronized
  fun finishClear(ticket: Long) {
    if (state == State.CLEARING && generation == ticket) state = State.READY
  }

  @Synchronized
  fun isReady(): Boolean = state == State.READY

  @Synchronized
  fun isClearing(): Boolean = state == State.CLEARING

  @Synchronized
  fun close() {
    generation += 1
    state = State.CLOSED
  }
}

internal object LoggeRythmCacheKeyPolicy {
  fun cacheKey(rawUrl: String): String {
    val uri = try {
      URI(rawUrl)
    } catch (_: Exception) {
      throw LoggeRythmCacheException("player-cache-key-invalid")
    }
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) {
      throw LoggeRythmCacheException("player-cache-key-invalid")
    }
    return uri.toASCIIString()
  }
}

@UnstableApi
internal object LoggeRythmUriCacheKeyFactory : CacheKeyFactory {
  override fun buildCacheKey(dataSpec: DataSpec): String =
    LoggeRythmCacheKeyPolicy.cacheKey(dataSpec.uri.toString())
}

internal interface LoggeRythmCacheServiceControl {
  fun onQueueGenerationChanged(generation: Long)
  fun cancelPreloadAndAwait(callback: (Result<Unit>) -> Unit)
  fun clearCache(callback: (Result<LoggeRythmCacheClearResult>) -> Unit)
}

internal object LoggeRythmCacheServiceBridge {
  private val lock = Any()
  private var control: LoggeRythmCacheServiceControl? = null

  fun attach(value: LoggeRythmCacheServiceControl) = synchronized(lock) {
    if (control != null && control !== value) throw LoggeRythmCacheException("player-cache-owner-active")
    control = value
  }

  fun detach(value: LoggeRythmCacheServiceControl) = synchronized(lock) {
    if (control === value) control = null
  }

  fun queueChanged(generation: Long) {
    synchronized(lock) { control }?.onQueueGenerationChanged(generation)
  }

  fun cancelPreloadAndAwait(callback: (Result<Unit>) -> Unit) {
    val active = synchronized(lock) { control }
    if (active == null) callback(Result.failure(LoggeRythmCacheException("player-cache-unavailable")))
    else active.cancelPreloadAndAwait(callback)
  }

  fun clearCache(callback: (Result<LoggeRythmCacheClearResult>) -> Unit) {
    val active = synchronized(lock) { control }
    if (active == null) callback(Result.failure(LoggeRythmCacheException("player-cache-unavailable")))
    else active.clearCache(callback)
  }
}

@UnstableApi
internal class LoggeRythmPlayerCache(context: Context) : LoggeRythmCacheServiceControl {
  private val appContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val ownsProcessSlot = ACTIVE_OWNER.compareAndSet(false, true)
  private val cache: SimpleCache? = if (ownsProcessSlot) createCacheOrNull() else null
  private val operationState = LoggeRythmCacheOperationState(cache != null)
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { task ->
    Thread(
      {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        task.run()
      },
      "LoggeRythmPlayerCache",
    )
  }
  private val secureUpstreamFactory = LoggeRythmSecureDataSourceFactory(appContext)
  private val cacheDataSourceFactory = cache?.let(::configuredCacheDataSourceFactory)
  private val preloader = cacheDataSourceFactory?.let { factory ->
    LoggeRythmNextItemPreloader(executor, factory)
  }
  private val closed = AtomicBoolean(false)

  fun playbackDataSourceFactory(): DataSource.Factory =
    cacheDataSourceFactory?.let { factory ->
      LoggeRythmFailSafeCacheDataSourceFactory(factory, secureUpstreamFactory)
    } ?: secureUpstreamFactory

  fun scheduleNext(generation: Long, rawUrl: String?) {
    if (!operationState.isReady()) return
    if (rawUrl == null) preloader?.cancel() else preloader?.schedule(generation, rawUrl)
  }

  fun isClearing(): Boolean = operationState.isClearing()

  override fun onQueueGenerationChanged(generation: Long) {
    preloader?.onQueueGenerationChanged(generation)
  }

  override fun cancelPreloadAndAwait(callback: (Result<Unit>) -> Unit) {
    preloader?.cancel()
    enqueue(
      operation = { Unit },
      callback = callback,
    )
  }

  override fun clearCache(callback: (Result<LoggeRythmCacheClearResult>) -> Unit) {
    val activeCache = cache
    val ticket = operationState.beginClear()
    if (activeCache == null || ticket == null) {
      callback(Result.failure(LoggeRythmCacheException("player-cache-clear-unavailable")))
      return
    }
    preloader?.cancel()
    enqueue(
      operation = {
        val before = activeCache.cacheSpace
        val keys = activeCache.keys.toList()
        keys.forEach(activeCache::removeResource)
        val after = activeCache.cacheSpace
        val verified = after == 0L && activeCache.keys.isEmpty()
        if (!verified) throw LoggeRythmCacheException("player-cache-clear-unverified")
        LoggeRythmCacheClearResult(
          bytesBefore = before,
          bytesAfter = after,
          resourcesRemoved = keys.size,
          verified = true,
        )
      },
      callback = { result ->
        operationState.finishClear(ticket)
        callback(result)
      },
    )
  }

  fun close() {
    if (!closed.compareAndSet(false, true)) return
    operationState.close()
    preloader?.close()
    executor.shutdownNow()
    runCatching { cache?.release() }
    if (ownsProcessSlot) ACTIVE_OWNER.set(false)
  }

  private fun configuredCacheDataSourceFactory(value: SimpleCache): CacheDataSource.Factory =
    CacheDataSource.Factory()
      .setCache(value)
      .setUpstreamDataSourceFactory(secureUpstreamFactory)
      .setCacheKeyFactory(LoggeRythmUriCacheKeyFactory)
      .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

  private fun createCacheOrNull(): SimpleCache? {
    var candidate: SimpleCache? = null
    return try {
      val directory = requireSecureCacheDirectory(appContext)
      candidate = SimpleCache(
        directory,
        LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES),
        StandaloneDatabaseProvider(appContext),
      )
      candidate.checkInitialization()
      candidate
    } catch (_: Exception) {
      runCatching { candidate?.release() }
      null
    }
  }

  private fun <T> enqueue(operation: () -> T, callback: (Result<T>) -> Unit) {
    if (closed.get()) {
      callback(Result.failure(LoggeRythmCacheException("player-cache-closed")))
      return
    }
    try {
      executor.execute {
        val result = runCatching(operation)
        mainHandler.post { callback(result) }
      }
    } catch (_: Exception) {
      callback(Result.failure(LoggeRythmCacheException("player-cache-executor-unavailable")))
    }
  }

  companion object {
    const val MAX_CACHE_BYTES = 500L * 1024L * 1024L
    const val CACHE_DIRECTORY_NAME = "loggerythm-player-cache-v1"
    private val ACTIVE_OWNER = AtomicBoolean(false)

    private fun requireSecureCacheDirectory(context: Context): File {
      val boundaryInput = context.noBackupFilesDir
      val boundaryStat = lstatOrNull(boundaryInput)
        ?: throw LoggeRythmCacheException("player-cache-boundary-missing")
      if (OsConstants.S_ISLNK(boundaryStat.st_mode) || !OsConstants.S_ISDIR(boundaryStat.st_mode)) {
        throw LoggeRythmCacheException("player-cache-boundary-invalid")
      }
      val boundary = boundaryInput.canonicalFile
      val candidate = File(boundary, CACHE_DIRECTORY_NAME)
      if (lstatOrNull(candidate) == null) {
        try {
          Os.mkdir(candidate.absolutePath, 448)
        } catch (error: ErrnoException) {
          if (error.errno != OsConstants.EEXIST) throw error
        }
      }
      val candidateStat = lstatOrNull(candidate)
        ?: throw LoggeRythmCacheException("player-cache-directory-missing")
      if (OsConstants.S_ISLNK(candidateStat.st_mode) || !OsConstants.S_ISDIR(candidateStat.st_mode)) {
        throw LoggeRythmCacheException("player-cache-directory-invalid")
      }
      val canonical = candidate.canonicalFile
      if (canonical.parentFile != boundary) throw LoggeRythmCacheException("player-cache-boundary-invalid")
      Os.chmod(canonical.absolutePath, 448)
      return canonical
    }

    private fun lstatOrNull(file: File) = try {
      Os.lstat(file.absolutePath)
    } catch (error: ErrnoException) {
      if (error.errno == OsConstants.ENOENT) null else throw error
    }
  }
}
