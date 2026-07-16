package __PACKAGE__

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicInteger

internal class OfflineDownloadsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val listenerCount = AtomicInteger(0)
  private val coordinator = OfflineDownloadCoordinator(
    OfflineDownloadStorage(reactContext.applicationContext),
    ::emitProgress,
  )

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> = mapOf("progressEvent" to PROGRESS_EVENT)

  @ReactMethod
  fun hydrate(scope: String, promise: Promise) {
    coordinator.hydrate(scope) { result ->
      settle(promise, result, ::hydrationMap)
    }
  }

  @ReactMethod
  fun persistManifest(scope: String, generation: Double, manifestJson: String, promise: Promise) {
    val revision = try {
      requiredGeneration(generation)
    } catch (error: Exception) {
      reject(promise, error)
      return
    }
    coordinator.persistManifest(scope, revision, manifestJson) { result ->
      settle(promise, result) { null }
    }
  }

  @ReactMethod
  fun startPlaylistDownload(
    scope: String,
    generation: Double,
    playlistId: String,
    tracks: ReadableArray,
    promise: Promise,
  ) {
    val parsed = try {
      requiredGeneration(generation) to parseRequests(tracks)
    } catch (error: Exception) {
      reject(promise, error)
      return
    }
    coordinator.downloadPlaylist(scope, parsed.first, playlistId, parsed.second) { result ->
      settle(promise, result, ::downloadResultMap)
    }
  }

  @ReactMethod
  fun removeFiles(scope: String, generation: Double, fileNames: ReadableArray, promise: Promise) {
    val parsed = try {
      requiredGeneration(generation) to
        List(fileNames.size()) { index -> requiredString(fileNames, index, "file-name-invalid") }
    } catch (error: Exception) {
      reject(promise, error)
      return
    }
    coordinator.removeFiles(scope, parsed.first, parsed.second) { result ->
      settle(promise, result) { availableBytes ->
        Arguments.createMap().apply { putDouble("availableDiskBytes", availableBytes.toDouble()) }
      }
    }
  }

  @ReactMethod
  fun clearScope(scope: String, promise: Promise) {
    coordinator.clearScope(scope) { result ->
      settle(promise, result) { generation ->
        Arguments.createMap().apply { putDouble("generation", generation.toDouble()) }
      }
    }
  }

  @ReactMethod
  fun clearAllScopes(promise: Promise) {
    coordinator.clearAllScopes { result ->
      settle(promise, result) { cleanupGeneration ->
        Arguments.createMap().apply {
          putDouble("cleanupGeneration", cleanupGeneration.toDouble())
          putBoolean("cleared", true)
        }
      }
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName == PROGRESS_EVENT) listenerCount.incrementAndGet()
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    val removed = count.toInt().coerceAtLeast(0)
    listenerCount.updateAndGet { current -> (current - removed).coerceAtLeast(0) }
  }

  override fun invalidate() {
    coordinator.close()
    super.invalidate()
  }

  private fun parseRequests(tracks: ReadableArray): List<OfflineTrackRequest> =
    List(tracks.size()) { index ->
      if (tracks.getType(index) != ReadableType.Map) throw IllegalArgumentException("download-request-invalid")
      val value = tracks.getMap(index) ?: throw IllegalArgumentException("download-request-invalid")
      requireExactKeys(value, setOf("trackId", "fileName", "url", "headers"))
      val headers = requiredMap(value, "headers", "auth-header-invalid")
      requireExactKeys(headers, setOf("Cookie"))
      OfflineTrackRequest(
        trackId = requiredString(value, "trackId", "track-id-invalid"),
        fileName = requiredString(value, "fileName", "file-name-invalid"),
        url = requiredString(value, "url", "stream-url-invalid"),
        cookie = requiredString(headers, "Cookie", "auth-header-invalid"),
      )
    }

  private fun hydrationMap(result: OfflineHydrationResult): WritableMap = Arguments.createMap().apply {
    val value = result.hydration
    putString("scope", value.scope.value)
    putDouble("generation", result.generation.toDouble())
    putString("directoryUri", value.directoryUri)
    if (value.manifestJson == null) putNull("manifestJson") else putString("manifestJson", value.manifestJson)
    putDouble("availableDiskBytes", value.availableDiskBytes.toDouble())
    putArray("files", Arguments.createArray().apply {
      value.files.forEach { file ->
        pushMap(Arguments.createMap().apply {
          putString("trackId", file.trackId)
          putString("fileName", file.fileName)
          putString("uri", file.uri)
          putDouble("sizeBytes", file.sizeBytes.toDouble())
        })
      }
    })
    putArray("interruptedTrackIds", stringArray(value.interruptedTrackIds))
    putArray("invalidTrackIds", stringArray(value.invalidTrackIds))
  }

  private fun downloadResultMap(value: OfflinePlaylistDownloadResult): WritableMap =
    Arguments.createMap().apply {
      putString("scope", value.scope)
      putDouble("generation", value.generation.toDouble())
      putString("playlistId", value.playlistId)
      putDouble("availableDiskBytes", value.availableDiskBytes.toDouble())
      putArray("successes", Arguments.createArray().apply {
        value.successes.forEach { success ->
          pushMap(Arguments.createMap().apply {
            putString("trackId", success.trackId)
            putString("fileName", success.fileName)
            putString("uri", success.uri)
            putDouble("sizeBytes", success.sizeBytes.toDouble())
            putBoolean("reused", success.reused)
          })
        }
      })
      putArray("failures", Arguments.createArray().apply {
        value.failures.forEach { failure ->
          pushMap(Arguments.createMap().apply {
            putString("trackId", failure.trackId)
            putString("code", failure.code)
            putBoolean("retryable", failure.retryable)
          })
        }
      })
    }

  private fun emitProgress(value: OfflineNativeProgress) {
    if (listenerCount.get() <= 0 || !reactApplicationContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("playlistId", value.playlistId)
      putInt("done", value.done)
      putInt("total", value.total)
      if (value.currentTrackId == null) putNull("currentTrackId")
      else putString("currentTrackId", value.currentTrackId)
      putDouble("bytesWritten", value.bytesWritten.toDouble())
      putDouble("currentBytes", value.currentBytes.toDouble())
      if (value.currentTotalBytes == null) putNull("currentTotalBytes")
      else putDouble("currentTotalBytes", value.currentTotalBytes.toDouble())
    }
    reactApplicationContext.runOnUiQueueThread {
      if (listenerCount.get() <= 0 || !reactApplicationContext.hasActiveReactInstance()) return@runOnUiQueueThread
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(PROGRESS_EVENT, payload)
    }
  }

  private fun <T> settle(promise: Promise, result: Result<T>, encode: (T) -> Any?) {
    reactApplicationContext.runOnUiQueueThread {
      result.fold(
        onSuccess = { value -> promise.resolve(encode(value)) },
        onFailure = { error -> reject(promise, error) },
      )
    }
  }

  private fun reject(promise: Promise, error: Throwable) {
    val code = when (error) {
      is OfflineModuleException -> safeCode(error.code)
      is IllegalArgumentException -> safeCode(error.message)
      else -> "offline-operation-failed"
    }
    promise.reject(code, "Offline operation failed: $code")
  }

  private fun safeCode(value: String?): String =
    value?.takeIf { SAFE_CODE.matches(it) } ?: "offline-operation-failed"

  private fun requireExactKeys(value: ReadableMap, allowed: Set<String>) {
    val seen = mutableSetOf<String>()
    val iterator = value.keySetIterator()
    while (iterator.hasNextKey()) seen += iterator.nextKey()
    if (seen != allowed) throw IllegalArgumentException("download-request-invalid")
  }

  private fun requiredMap(value: ReadableMap, key: String, code: String): ReadableMap {
    if (!value.hasKey(key) || value.isNull(key) || value.getType(key) != ReadableType.Map) {
      throw IllegalArgumentException(code)
    }
    return value.getMap(key) ?: throw IllegalArgumentException(code)
  }

  private fun requiredString(value: ReadableMap, key: String, code: String): String {
    if (!value.hasKey(key) || value.isNull(key) || value.getType(key) != ReadableType.String) {
      throw IllegalArgumentException(code)
    }
    return value.getString(key)?.takeIf { it.isNotEmpty() } ?: throw IllegalArgumentException(code)
  }

  private fun requiredString(value: ReadableArray, index: Int, code: String): String {
    if (value.getType(index) != ReadableType.String) throw IllegalArgumentException(code)
    return value.getString(index)?.takeIf { it.isNotEmpty() } ?: throw IllegalArgumentException(code)
  }

  private fun requiredGeneration(value: Double): Long {
    if (!value.isFinite() || value < 0.0 || value > Long.MAX_VALUE.toDouble()) {
      throw IllegalArgumentException("offline-generation-invalid")
    }
    val generation = value.toLong()
    if (generation.toDouble() != value) throw IllegalArgumentException("offline-generation-invalid")
    return generation
  }

  private fun stringArray(values: List<String>): WritableArray = Arguments.createArray().apply {
    values.forEach(::pushString)
  }

  companion object {
    const val NAME = "OfflineDownloads"
    const val PROGRESS_EVENT = "OfflineDownloadProgress"
    private val SAFE_CODE = Regex("[a-z][a-z0-9-]{1,63}")
  }
}
