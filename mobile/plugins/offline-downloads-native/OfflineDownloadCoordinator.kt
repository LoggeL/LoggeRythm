package __PACKAGE__

import android.content.Context
import android.system.Os
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import top.logge.loggerythm.player.LoggeRythmRollingCacheBridge
import top.logge.loggerythm.player.LoggeRythmRollingCacheClearSummary

internal data class OfflineTrackRequest(
  val trackId: String,
  val fileName: String,
  val url: String,
  val cookie: String,
)

internal data class OfflineTrackSuccess(
  val trackId: String,
  val fileName: String,
  val uri: String,
  val sizeBytes: Long,
  val reused: Boolean,
)

internal data class OfflineTrackFailure(
  val trackId: String,
  val code: String,
  val retryable: Boolean,
)

internal data class OfflinePlaylistDownloadResult(
  val scope: String,
  val generation: Long,
  val playlistId: String,
  val successes: List<OfflineTrackSuccess>,
  val failures: List<OfflineTrackFailure>,
  val availableDiskBytes: Long,
)

internal data class OfflineHydrationResult(
  val generation: Long,
  val hydration: OfflineHydration,
)

internal data class OfflineNativeProgress(
  val playlistId: String,
  val done: Int,
  val total: Int,
  val currentTrackId: String?,
  val bytesWritten: Long,
  val currentBytes: Long,
  val currentTotalBytes: Long?,
)

internal class OfflineModuleException(
  val code: String,
  val retryable: Boolean = false,
  cause: Throwable? = null,
) : Exception(code, cause)

internal data class OfflineStorageMetricsResult(
  val scope: String,
  val scopeBytes: Long,
  val scopeTrackCount: Int,
  val allDownloadsBytes: Long,
  val rollingCacheBytes: Long,
  val rollingCacheMaxBytes: Long,
  val rollingCacheEntryCount: Int,
  val availableDiskBytes: Long,
  val wifiOnly: Boolean,
)

/** One process-wide serialized owner for explicit playlist download mutations. */
internal class OfflineDownloadCoordinator(
  private val appContext: Context,
  private val storage: OfflineDownloadStorage,
  private val emitProgress: (OfflineNativeProgress) -> Unit,
) {
  private val prefs = appContext.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )
  private data class OperationAdmission(
    val scope: String,
    val scopeGeneration: Long,
    val cleanupGeneration: Long,
  )

  private class ActiveJob(val scope: String, val generation: Long, val playlistId: String) {
    val cancelled = AtomicBoolean(false)
    val call = AtomicReference<Call?>(null)
    val workToken = AtomicLong(0L)

    fun cancel() {
      cancelled.set(true)
      call.getAndSet(null)?.cancel()
      val pendingToken = workToken.getAndSet(0L)
      if (pendingToken > 0L) {
        OfflineDownloadWorkRegistry.cancelAndRemove(pendingToken)
      }
    }
  }

  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "LoggeRythm-explicit-downloads").apply { isDaemon = true }
  }
  private val activeJob = AtomicReference<ActiveJob?>(null)
  private val generations = ConcurrentHashMap<String, AtomicLong>()
  private val clearingScopes = ConcurrentHashMap.newKeySet<String>()
  private val stateLock = Any()
  private val globalCleanupGeneration = AtomicLong(0L)
  private val allScopesClearing = AtomicBoolean(false)
  private var allScopesCleanupScheduled = false
  private val allScopesCleanupCallbacks = mutableListOf<(Result<Long>) -> Unit>()

  fun isWifiOnly(): Boolean = prefs.getBoolean(PREF_WIFI_ONLY, false)

  fun setWifiOnly(enabled: Boolean): Boolean {
    if (!prefs.edit().putBoolean(PREF_WIFI_ONLY, enabled).commit()) {
      throw OfflineModuleException("storage-unavailable", true)
    }
    return enabled
  }

  fun cancelActiveDownload(): Boolean {
    val active = activeJob.get() ?: return false
    active.cancel()
    OfflineDownloadWorker.cancel(appContext)
    return true
  }

  fun getStorageMetrics(scopeValue: String, callback: (Result<OfflineStorageMetricsResult>) -> Unit) {
    val scope = parseScope(scopeValue, callback) ?: return
    enqueueScopeOperation(scope, null, false, callback) {
      val usage = storage.storageUsage(scope.value)
      val cacheMetrics = LoggeRythmRollingCacheBridge.getMetrics(appContext)
      OfflineStorageMetricsResult(
        scope = scope.value,
        scopeBytes = usage.scopeBytes,
        scopeTrackCount = usage.scopeTrackCount,
        allDownloadsBytes = usage.allDownloadsBytes,
        rollingCacheBytes = cacheMetrics.cacheBytes,
        rollingCacheMaxBytes = cacheMetrics.maxCacheBytes,
        rollingCacheEntryCount = cacheMetrics.entryCount,
        availableDiskBytes = usage.availableDiskBytes,
        wifiOnly = isWifiOnly(),
      )
    }
  }

  fun clearRollingCache(callback: (Result<LoggeRythmRollingCacheClearSummary>) -> Unit) {
    LoggeRythmRollingCacheBridge.clearRollingCache(appContext) { result ->
      callback(result.mapError())
    }
  }

  fun hydrate(scopeValue: String, callback: (Result<OfflineHydrationResult>) -> Unit) {
    val scope = parseScope(scopeValue, callback) ?: return
    enqueueScopeOperation(scope, null, false, callback) { admission ->
      OfflineHydrationResult(admission.scopeGeneration, storage.hydrate(scope.value))
    }
  }

  fun persistManifest(
    scopeValue: String,
    generation: Long,
    manifestJson: String,
    callback: (Result<Unit>) -> Unit,
  ) {
    val scope = parseScope(scopeValue, callback) ?: return
    enqueueScopeOperation(scope, generation, false, callback) {
      storage.persistManifest(scope.value, manifestJson)
    }
  }

  fun removeFiles(
    scopeValue: String,
    generation: Long,
    fileNames: List<String>,
    callback: (Result<Long>) -> Unit,
  ) {
    val scope = parseScope(scopeValue, callback) ?: return
    enqueueScopeOperation(scope, generation, true, callback) {
      storage.removeFiles(scope.value, fileNames)
    }
  }

  fun clearScope(scopeValue: String, callback: (Result<Long>) -> Unit) {
    val scope = try {
      storage.parseScope(scopeValue)
    } catch (error: Exception) {
      callback(Result.failure(OfflineModuleException(safeErrorCode(error.message))))
      return
    }
    var rejection: Throwable? = null
    synchronized(stateLock) {
      try {
        requireAllScopesNotClearingLocked()
        val current = activeJob.get()
        if (current != null && current.scope != scope.value) {
          throw OfflineModuleException("offline-download-busy", true)
        }
        if (!clearingScopes.add(scope.value)) {
          throw OfflineModuleException("offline-scope-clearing", true)
        }
        val cleanupGeneration = globalCleanupGeneration.get()
        val nextGeneration = generationCounter(scope.value).incrementAndGet()
        current?.cancel()
        if (current != null) OfflineDownloadWorker.cancel(appContext)
        try {
          // Queueing happens while stateLock is held. A global clear therefore
          // cannot be queued ahead of an already-admitted scope operation.
          executor.execute {
            val result = runCatching {
              requireGlobalGeneration(cleanupGeneration)
              storage.clearScope(scope.value)
              requireGlobalGeneration(cleanupGeneration)
              nextGeneration
            }.mapError()
            synchronized(stateLock) { clearingScopes.remove(scope.value) }
            callback(result)
          }
        } catch (error: Exception) {
          clearingScopes.remove(scope.value)
          throw OfflineModuleException("storage-unavailable", true, error)
        }
      } catch (error: Throwable) {
        rejection = mapThrowable(error)
      }
    }
    rejection?.let { callback(Result.failure(it)) }
  }

  /**
   * Process-wide account-boundary cleanup. New operations are rejected from
   * the moment this is requested until the entire root is verifiably absent.
   * Concurrent calls join the same idempotent transaction; after a failed
   * deletion the coordinator remains fail-closed and a later call retries it.
   */
  fun clearAllScopes(callback: (Result<Long>) -> Unit) {
    var failedCallbacks = emptyList<(Result<Long>) -> Unit>()
    var schedulingFailure: Throwable? = null
    synchronized(stateLock) {
      allScopesCleanupCallbacks += callback
      if (allScopesCleanupScheduled) return

      allScopesClearing.set(true)
      activeJob.get()?.cancel()
      OfflineDownloadWorkRegistry.clearAll()
      OfflineDownloadWorker.cancel(appContext)
      val cleanupGeneration = globalCleanupGeneration.incrementAndGet()
      generations.values.forEach { counter -> counter.incrementAndGet() }
      allScopesCleanupScheduled = true
      try {
        executor.execute {
          val result = runCatching {
            storage.clearAllScopes()
            cleanupGeneration
          }.mapError()
          val callbacks = synchronized(stateLock) {
            allScopesCleanupScheduled = false
            if (result.isSuccess) {
              clearingScopes.clear()
              allScopesClearing.set(false)
            }
            allScopesCleanupCallbacks.toList().also { allScopesCleanupCallbacks.clear() }
          }
          callbacks.forEach { waiter -> runCatching { waiter(result) } }
        }
      } catch (error: Exception) {
        allScopesCleanupScheduled = false
        schedulingFailure = OfflineModuleException("storage-unavailable", true, error)
        failedCallbacks = allScopesCleanupCallbacks.toList()
        allScopesCleanupCallbacks.clear()
      }
    }
    val failure = schedulingFailure ?: return
    failedCallbacks.forEach { waiter ->
      runCatching { waiter(Result.failure(failure)) }
    }
  }

  fun downloadPlaylist(
    scopeValue: String,
    generation: Long,
    playlistId: String,
    requests: List<OfflineTrackRequest>,
    callback: (Result<OfflinePlaylistDownloadResult>) -> Unit,
  ) {
    val scope: OfflineScope
    val validatedRequests: List<OfflineTrackRequest>
    try {
      scope = storage.parseScope(scopeValue)
      require(PLAYLIST_ID.matches(playlistId)) { "playlist-id-invalid" }
      require(requests.isNotEmpty()) { "playlist-empty" }
      validatedRequests = requests.map { validateRequest(scope, it) }
    } catch (error: Exception) {
      callback(Result.failure(OfflineModuleException(error.message ?: "download-request-invalid")))
      return
    }

    val wifiOnly = isWifiOnly()
    if (wifiOnly && !OfflineDownloadWorker.isUnmeteredNetworkActive(appContext)) {
      callback(Result.failure(OfflineModuleException("wifi-required", true)))
      return
    }

    val job = ActiveJob(scope.value, generation, playlistId)
    var rejection: Throwable? = null
    synchronized(stateLock) {
      try {
        val admission = admitLocked(scope.value, generation)
        if (!activeJob.compareAndSet(null, job)) {
          throw OfflineModuleException("offline-download-busy", true)
        }
        val settled = AtomicBoolean(false)
        fun completeOnce(result: Result<OfflinePlaylistDownloadResult>) {
          if (!settled.compareAndSet(false, true)) return
          activeJob.compareAndSet(job, null)
          callback(result)
        }
        var registeredToken = 0L
        try {
          // Admission and enqueue are atomic with respect to clearAllScopes().
          // WorkManager owns the Foreground Service notification and NetworkType.UNMETERED
          // constraint so the download survives screen-off while cookies remain strictly in RAM.
          registeredToken = OfflineDownloadWorkRegistry.register(
            totalTracks = validatedRequests.size,
            wifiOnly = wifiOnly,
            run = { onNotificationProgress ->
              val future = try {
                executor.submit {
                  val result = runCatching {
                    requireAdmission(admission)
                    val value = runPlaylistJob(
                      job = job,
                      scope = scope,
                      requests = validatedRequests,
                      wifiOnly = wifiOnly,
                      onNotificationProgress = onNotificationProgress,
                    )
                    requireAdmission(admission)
                    value
                  }.mapError()
                  completeOnce(result)
                }
              } catch (error: Exception) {
                completeOnce(Result.failure(OfflineModuleException("storage-unavailable", true, error)))
                return@register
              }
              try {
                future.get()
              } catch (_: InterruptedException) {
                job.cancel()
                future.cancel(true)
                Thread.currentThread().interrupt()
                completeOnce(Result.failure(OfflineModuleException("interrupted", true)))
              } catch (error: Exception) {
                job.cancel()
                completeOnce(Result.failure(mapThrowable(error)))
              }
            },
            onStopped = {
              job.cancel()
              completeOnce(Result.failure(OfflineModuleException("interrupted", true)))
            },
          )
          job.workToken.set(registeredToken)
          OfflineDownloadWorker.enqueue(appContext, wifiOnly, registeredToken)
        } catch (error: Exception) {
          if (registeredToken != 0L) OfflineDownloadWorkRegistry.take(registeredToken)
          job.workToken.set(0L)
          activeJob.compareAndSet(job, null)
          throw OfflineModuleException("offline-worker-unavailable", true, error)
        }
      } catch (error: Throwable) {
        rejection = mapThrowable(error)
      }
    }
    rejection?.let { callback(Result.failure(it)) }
  }

  fun close() {
    synchronized(stateLock) {
      allScopesClearing.set(true)
      activeJob.getAndSet(null)?.cancel()
      OfflineDownloadWorkRegistry.clearAll()
      OfflineDownloadWorker.cancel(appContext)
      executor.shutdownNow()
    }
  }

  private fun runPlaylistJob(
    job: ActiveJob,
    scope: OfflineScope,
    requests: List<OfflineTrackRequest>,
    wifiOnly: Boolean,
    onNotificationProgress: (done: Int, total: Int) -> Unit,
  ): OfflinePlaylistDownloadResult {
    val successes = mutableListOf<OfflineTrackSuccess>()
    val failures = mutableListOf<OfflineTrackFailure>()
    val completedThisJob = mutableMapOf<String, OfflineTrackSuccess>()
    var newBytesWritten = 0L
    var done = 0
    emitProgress(OfflineNativeProgress(job.playlistId, 0, requests.size, null, 0L, 0L, null))
    onNotificationProgress(0, requests.size)

    for (index in requests.indices) {
      val request = requests[index]
      if (job.cancelled.get()) {
        requests.subList(index, requests.size).forEach { pending ->
          failures += OfflineTrackFailure(pending.trackId, "interrupted", true)
        }
        break
      }
      if (wifiOnly && !OfflineDownloadWorker.isUnmeteredNetworkActive(appContext)) {
        requests.subList(index, requests.size).forEach { pending ->
          failures += OfflineTrackFailure(pending.trackId, "wifi-required", true)
        }
        break
      }
      emitProgress(
        OfflineNativeProgress(job.playlistId, done, requests.size, request.trackId, newBytesWritten, 0L, null),
      )
      try {
        val prior = completedThisJob[request.trackId]
        val success = prior?.copy(reused = true) ?: downloadTrack(job, scope, request) { current, total ->
          emitProgress(
            OfflineNativeProgress(
              job.playlistId,
              done,
              requests.size,
              request.trackId,
              newBytesWritten + current,
              current,
              total,
            ),
          )
        }
        successes += success
        completedThisJob[request.trackId] = success
        if (!success.reused) newBytesWritten += success.sizeBytes
      } catch (failure: OfflineModuleException) {
        failures += OfflineTrackFailure(request.trackId, failure.code, failure.retryable)
      }
      done += 1
      onNotificationProgress(done, requests.size)
      emitProgress(
        OfflineNativeProgress(job.playlistId, done, requests.size, request.trackId, newBytesWritten, 0L, null),
      )
    }
    emitProgress(
      OfflineNativeProgress(job.playlistId, done, requests.size, null, newBytesWritten, 0L, null),
    )
    return OfflinePlaylistDownloadResult(
      scope.value,
      job.generation,
      job.playlistId,
      successes,
      failures,
      storage.availableBytes(storage.audioDirectory(scope)),
    )
  }

  private fun downloadTrack(
    job: ActiveJob,
    scope: OfflineScope,
    request: OfflineTrackRequest,
    progress: (Long, Long?) -> Unit,
  ): OfflineTrackSuccess {
    val verifiedExisting = storage.verifiedExistingFile(scope, request.trackId)
    if (verifiedExisting != null) {
      return OfflineTrackSuccess(
        request.trackId,
        request.fileName,
        verifiedExisting.uri,
        verifiedExisting.sizeBytes,
        true,
      )
    }
    val finalFile = storage.finalFile(scope, request.trackId)
    if (finalFile.exists() && !finalFile.delete()) {
      throw OfflineModuleException("storage-corrupt")
    }
    val partialFile = storage.partialFile(scope, request.trackId)
    if (partialFile.exists() && !partialFile.delete()) {
      throw OfflineModuleException("storage-cleanup-failed", true)
    }

    val nativeRequest = Request.Builder()
      .url(request.url)
      .get()
      .header("Cookie", request.cookie)
      .header("Accept-Encoding", "identity")
      .build()
    val call = OkHttpClientProvider.getOkHttpClient()
      .newBuilder()
      .followRedirects(false)
      .followSslRedirects(false)
      .build()
      .newCall(nativeRequest)
    job.call.set(call)
    try {
      val response = try {
        call.execute()
      } catch (error: IOException) {
        if (job.cancelled.get()) throw OfflineModuleException("interrupted", true, error)
        throw OfflineModuleException("network", true, error)
      }
      response.use { value ->
        when (value.code) {
          401, 403 -> throw OfflineModuleException("auth", false)
          404 -> throw OfflineModuleException("http-not-found", false)
        }
        if (value.code != 200) {
          throw OfflineModuleException("http", value.code == 408 || value.code == 429 || value.code >= 500)
        }
        val mediaType = value.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase()
        if (mediaType != "audio/mpeg") throw OfflineModuleException("integrity", true)
        val body = value.body ?: throw OfflineModuleException("integrity", true)
        val expectedSize = body.contentLength()
        if (expectedSize <= 0L) throw OfflineModuleException("integrity", true)
        val directory = storage.audioDirectory(scope)
        if (expectedSize > storage.availableBytes(directory)) {
          throw OfflineModuleException("no-space", true)
        }

        var written = 0L
        var lastReported = 0L
        try {
          FileOutputStream(partialFile, false).use { output ->
            body.byteStream().use { input ->
              val buffer = ByteArray(BUFFER_BYTES)
              while (true) {
                if (job.cancelled.get()) throw OfflineModuleException("interrupted", true)
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                written += read
                if (written - lastReported >= PROGRESS_STEP_BYTES) {
                  progress(written, expectedSize)
                  lastReported = written
                }
              }
            }
            output.flush()
            output.fd.sync()
          }
        } catch (error: OfflineModuleException) {
          throw error
        } catch (error: IOException) {
          val remaining = (expectedSize - written).coerceAtLeast(1L)
          val code = if (storage.availableBytes(directory) < remaining) "no-space" else "io"
          throw OfflineModuleException(code, true, error)
        }
        progress(written, expectedSize)
        if (written != expectedSize || !storage.looksLikeMp3(partialFile)) {
          throw OfflineModuleException("integrity", true)
        }
        try {
          Os.rename(partialFile.absolutePath, finalFile.absolutePath)
        } catch (error: Exception) {
          throw OfflineModuleException("atomic-commit-failed", true, error)
        }
        if (!finalFile.isFile || finalFile.length() != expectedSize) {
          finalFile.delete()
          throw OfflineModuleException("integrity", true)
        }
        return OfflineTrackSuccess(
          request.trackId,
          request.fileName,
          android.net.Uri.fromFile(finalFile).toString(),
          expectedSize,
          false,
        )
      }
    } finally {
      job.call.compareAndSet(call, null)
      if (partialFile.exists()) partialFile.delete()
    }
  }

  private fun validateRequest(scope: OfflineScope, value: OfflineTrackRequest): OfflineTrackRequest {
    val trackId = storage.requireTrackId(value.trackId)
    require(value.fileName == "$trackId.mp3") { "file-name-invalid" }
    require(COOKIE.matches(value.cookie)) { "auth-header-invalid" }
    val target = value.url.toHttpUrlOrNull() ?: throw IllegalArgumentException("stream-url-invalid")
    require(target.username.isEmpty() && target.password.isEmpty()) { "stream-url-invalid" }
    val origin = URI(scope.origin)
    require(
      target.scheme == origin.scheme
        && target.host == origin.host
        && target.port == effectivePort(origin.scheme, origin.port)
        && target.encodedPath == "/api/tracks/$trackId/stream"
        && isAllowedStreamQuery(target)
        && target.fragment == null,
    ) { "stream-url-scope-mismatch" }
    return value.copy(trackId = trackId, fileName = "$trackId.mp3", url = target.toString())
  }

  private fun isAllowedStreamQuery(target: HttpUrl): Boolean =
    target.encodedQuery == null
      || target.encodedQuery == "quality=high"
      || target.encodedQuery == "quality=saver"

  private fun effectivePort(scheme: String, port: Int): Int = when {
    port >= 0 -> port
    scheme == "https" -> 443
    else -> 80
  }

  private fun <T> parseScope(
    scopeValue: String,
    callback: (Result<T>) -> Unit,
  ): OfflineScope? = try {
    storage.parseScope(scopeValue)
  } catch (error: Throwable) {
    callback(Result.failure(mapThrowable(error)))
    null
  }

  /**
   * Admission and executor enqueue deliberately share stateLock. Otherwise an
   * operation admitted just before clearAllScopes could be queued after the
   * deletion and recreate the root with a stale JS promise.
   */
  private fun <T> enqueueScopeOperation(
    scope: OfflineScope,
    expectedGeneration: Long?,
    requireIdleDownload: Boolean,
    callback: (Result<T>) -> Unit,
    operation: (OperationAdmission) -> T,
  ) {
    var rejection: Throwable? = null
    synchronized(stateLock) {
      try {
        val admission = admitLocked(scope.value, expectedGeneration)
        if (requireIdleDownload && activeJob.get() != null) {
          throw OfflineModuleException("offline-download-busy", true)
        }
        executor.execute {
          val result = runCatching {
            requireAdmission(admission)
            val value = operation(admission)
            requireAdmission(admission)
            value
          }.mapError()
          callback(result)
        }
      } catch (error: Throwable) {
        rejection = mapThrowable(error)
      }
    }
    rejection?.let { callback(Result.failure(it)) }
  }

  private fun admitLocked(scope: String, expectedGeneration: Long?): OperationAdmission {
    requireAllScopesNotClearingLocked()
    if (clearingScopes.contains(scope)) {
      throw OfflineModuleException("offline-scope-clearing", true)
    }
    val scopeGeneration = generationCounter(scope).get()
    if (expectedGeneration != null && (expectedGeneration < 0L || expectedGeneration != scopeGeneration)) {
      throw OfflineModuleException("offline-generation-stale", false)
    }
    return OperationAdmission(scope, scopeGeneration, globalCleanupGeneration.get())
  }

  private fun requireAdmission(admission: OperationAdmission) {
    synchronized(stateLock) {
      requireAllScopesNotClearingLocked()
      if (globalCleanupGeneration.get() != admission.cleanupGeneration) {
        throw OfflineModuleException("offline-generation-stale", false)
      }
      if (clearingScopes.contains(admission.scope)) {
        throw OfflineModuleException("offline-scope-clearing", true)
      }
      if (generationCounter(admission.scope).get() != admission.scopeGeneration) {
        throw OfflineModuleException("offline-generation-stale", false)
      }
    }
  }

  private fun requireGlobalGeneration(expected: Long) {
    synchronized(stateLock) {
      requireAllScopesNotClearingLocked()
      if (globalCleanupGeneration.get() != expected) {
        throw OfflineModuleException("offline-generation-stale", false)
      }
    }
  }

  private fun requireAllScopesNotClearingLocked() {
    if (allScopesClearing.get()) {
      throw OfflineModuleException("offline-all-scopes-clearing", true)
    }
  }

  private fun <T> Result<T>.mapError(): Result<T> = fold(
    onSuccess = { Result.success(it) },
    onFailure = { error ->
      Result.failure(mapThrowable(error))
    },
  )

  private fun mapThrowable(error: Throwable): OfflineModuleException = when (error) {
    is OfflineModuleException -> error
    is IllegalArgumentException -> OfflineModuleException(safeErrorCode(error.message), false, error)
    else -> OfflineModuleException(safeErrorCode(error.message), true, error)
  }

  private fun safeErrorCode(value: String?): String =
    value?.takeIf(SAFE_ERROR_CODE::matches) ?: "storage-unavailable"

  private fun generationCounter(scope: String): AtomicLong =
    generations.computeIfAbsent(scope) { AtomicLong(globalCleanupGeneration.get()) }

  companion object {
    private const val PREFS_NAME = "loggerythm_offline_downloads_prefs"
    private const val PREF_WIFI_ONLY = "wifi_only"
    private const val BUFFER_BYTES = 64 * 1024
    private const val PROGRESS_STEP_BYTES = 256 * 1024L
    private val PLAYLIST_ID = Regex("[1-9][0-9]{0,31}")
    private val COOKIE = Regex("sf_session=[^\\s;,]+")
    private val SAFE_ERROR_CODE = Regex("[a-z][a-z0-9-]{1,63}")
  }
}
