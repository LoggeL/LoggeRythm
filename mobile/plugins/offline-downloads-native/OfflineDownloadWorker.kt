package __PACKAGE__

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.annotation.Keep
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-only memory registry bridging [OfflineDownloadCoordinator] to [OfflineDownloadWorker].
 * Session cookies and stream URLs never enter WorkManager's unencrypted SQLite `Data` payload;
 * only the opaque numeric [token] is passed so queued work can be taken or cancelled deterministically.
 */
internal object OfflineDownloadWorkRegistry {
  internal data class PendingWork(
    val token: Long,
    val totalTracks: Int,
    val wifiOnly: Boolean,
    val run: (onProgress: (done: Int, total: Int) -> Unit) -> Unit,
    val onStopped: () -> Unit,
  )

  private val nextToken = AtomicLong(0L)
  private val activeWork = ConcurrentHashMap<Long, PendingWork>()

  fun register(
    totalTracks: Int,
    wifiOnly: Boolean,
    run: (onProgress: (done: Int, total: Int) -> Unit) -> Unit,
    onStopped: () -> Unit,
  ): Long {
    val token = nextToken.incrementAndGet()
    activeWork[token] = PendingWork(token, totalTracks, wifiOnly, run, onStopped)
    return token
  }

  fun take(token: Long): PendingWork? =
    if (token <= 0L) null else activeWork.remove(token)

  /**
   * Cancels and removes a still-queued work entry before `doWork()` claims it, invoking
   * `onStopped()` so the coordinator immediately clears `activeJob` and settles its Promise.
   */
  fun cancelAndRemove(token: Long): Boolean {
    if (token <= 0L) return false
    val pending = activeWork.remove(token) ?: return false
    runCatching { pending.onStopped() }
    return true
  }

  fun clearAll() {
    val snapshot = activeWork.values.toList()
    activeWork.clear()
    snapshot.forEach { work -> runCatching { work.onStopped() } }
  }
}

/**
 * WorkManager foreground worker that keeps explicit playlist downloads alive across screen-off
 * and backgrounding, enforcing `NetworkType.UNMETERED` when Wi-Fi-only mode is enabled.
 */
@Keep
class OfflineDownloadWorker(
  appContext: Context,
  params: WorkerParameters,
) : Worker(appContext, params) {
  @Volatile
  private var activeWork: OfflineDownloadWorkRegistry.PendingWork? = null

  override fun doWork(): Result {
    val token = inputData.getLong(KEY_WORK_TOKEN, 0L)
    val work = OfflineDownloadWorkRegistry.take(token) ?: return Result.failure()
    activeWork = work
    try {
      setForegroundAsync(
        OfflineDownloadNotification.foregroundInfo(
          context = applicationContext,
          done = 0,
          total = work.totalTracks,
          wifiOnly = work.wifiOnly,
        ),
      ).get()
    } catch (_: Exception) {
      // If foreground promotion fails on restricted background start, fail loudly via job callback.
      work.onStopped()
      return Result.failure()
    }
    return try {
      work.run { done, total ->
        OfflineDownloadNotification.updateProgress(
          context = applicationContext,
          done = done,
          total = total,
          wifiOnly = work.wifiOnly,
        )
      }
      Result.success()
    } finally {
      activeWork = null
      OfflineDownloadNotification.cancel(applicationContext)
    }
  }

  override fun onStopped() {
    super.onStopped()
    activeWork?.onStopped()
    OfflineDownloadNotification.cancel(applicationContext)
  }

  companion object {
    const val UNIQUE_WORK_NAME = "loggerythm_explicit_offline_download"
    const val KEY_WORK_TOKEN = "offline_work_token"

    fun buildConstraints(wifiOnly: Boolean): Constraints = Constraints.Builder()
      .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .build()

    fun isUnmeteredNetworkActive(context: Context): Boolean {
      val connectivity = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
        as? ConnectivityManager ?: return false
      val network = connectivity.activeNetwork ?: return false
      val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
      val validatedInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      if (!validatedInternet) return false
      return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ||
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    fun enqueue(context: Context, wifiOnly: Boolean, token: Long) {
      val data = Data.Builder().putLong(KEY_WORK_TOKEN, token).build()
      val request = OneTimeWorkRequestBuilder<OfflineDownloadWorker>()
        .setConstraints(buildConstraints(wifiOnly))
        .setInputData(data)
        .build()
      WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
        UNIQUE_WORK_NAME,
        ExistingWorkPolicy.REPLACE,
        request,
      )
    }

    fun cancel(context: Context) {
      runCatching {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE_WORK_NAME)
      }
      OfflineDownloadNotification.cancel(context.applicationContext)
    }
  }
}
