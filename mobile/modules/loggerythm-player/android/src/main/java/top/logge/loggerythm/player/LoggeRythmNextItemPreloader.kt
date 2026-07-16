package top.logge.loggerythm.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future

internal data class LoggeRythmPreloadTicket(
  val queueGeneration: Long,
  val operationGeneration: Long,
  val url: String,
)

internal class LoggeRythmPreloadGenerationState {
  private var queueGeneration = -1L
  private var operationGeneration = 0L
  private var closed = false

  @Synchronized
  fun onQueueGenerationChanged(value: Long) {
    if (closed) return
    queueGeneration = value
    operationGeneration += 1
  }

  @Synchronized
  fun newTicket(value: Long, url: String): LoggeRythmPreloadTicket? {
    if (closed || value != queueGeneration) return null
    operationGeneration += 1
    return LoggeRythmPreloadTicket(value, operationGeneration, url)
  }

  @Synchronized
  fun cancel() {
    operationGeneration += 1
  }

  @Synchronized
  fun close() {
    closed = true
    operationGeneration += 1
  }

  @Synchronized
  fun isCurrent(ticket: LoggeRythmPreloadTicket): Boolean =
    !closed &&
      ticket.queueGeneration == queueGeneration &&
      ticket.operationGeneration == operationGeneration

  @Synchronized
  fun boundedProgress(ticket: LoggeRythmPreloadTicket, bytesCached: Long): Long? =
    if (isCurrent(ticket)) bytesCached.coerceIn(0L, MAX_PRELOAD_BYTES) else null

  companion object {
    const val MAX_PRELOAD_BYTES = 8L * 1024L * 1024L
  }
}

@UnstableApi
internal class LoggeRythmNextItemPreloader(
  private val executor: ExecutorService,
  private val cacheDataSourceFactory: CacheDataSource.Factory,
) {
  private val lock = Any()
  private val generationState = LoggeRythmPreloadGenerationState()
  private var writer: CacheWriter? = null
  private var future: Future<*>? = null

  fun onQueueGenerationChanged(generation: Long) = synchronized(lock) {
    generationState.onQueueGenerationChanged(generation)
    cancelWorkLocked()
  }

  fun schedule(generation: Long, rawUrl: String?) {
    val url = rawUrl?.let {
      runCatching { LoggeRythmCacheKeyPolicy.cacheKey(it) }.getOrNull()
    } ?: return
    synchronized(lock) {
      generationState.cancel()
      cancelWorkLocked()
      val ticket = generationState.newTicket(generation, url) ?: return
      val dataSpec = DataSpec.Builder()
        .setUri(url)
        .setPosition(0L)
        .setLength(LoggeRythmPreloadGenerationState.MAX_PRELOAD_BYTES)
        .setFlags(DataSpec.FLAG_MIGHT_NOT_USE_FULL_NETWORK_SPEED)
        .build()
      val nextWriter = CacheWriter(
        cacheDataSourceFactory.createDataSourceForDownloading(),
        dataSpec,
        null,
      ) { _, bytesCached, _ ->
        generationState.boundedProgress(ticket, bytesCached)
      }
      writer = nextWriter
      future = try {
        executor.submit {
          if (!generationState.isCurrent(ticket)) return@submit
          runCatching { nextWriter.cache() }
          synchronized(lock) {
            if (writer === nextWriter) {
              writer = null
              future = null
            }
          }
        }
      } catch (_: Exception) {
        writer = null
        null
      }
    }
  }

  fun cancel() = synchronized(lock) {
    generationState.cancel()
    cancelWorkLocked()
  }

  fun close() = synchronized(lock) {
    generationState.close()
    cancelWorkLocked()
  }

  private fun cancelWorkLocked() {
    writer?.cancel()
    future?.cancel(false)
    writer = null
    future = null
  }
}
