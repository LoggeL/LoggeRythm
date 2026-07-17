package top.logge.loggerythm.player

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient

/**
 * Creates the only HTTP transport used by Media3. Redirects stay disabled even after an optional
 * test-only builder customization, so a vaulted Cookie can never be replayed to a Location target.
 */
internal fun failClosedMediaHttpDataSourceFactory(
  configure: OkHttpClient.Builder.() -> Unit = {},
): DataSource.Factory = OkHttpDataSource.Factory(failClosedMediaHttpClient(configure))

internal fun failClosedMediaHttpClient(
  configure: OkHttpClient.Builder.() -> Unit = {},
): OkHttpClient = OkHttpClient.Builder()
    .apply(configure)
    .followRedirects(false)
    .followSslRedirects(false)
    .build()

@UnstableApi
internal class LoggeRythmSecureDataSourceFactory internal constructor(
  private val upstreamFactory: DataSource.Factory,
  private val cookieFor: (String) -> String?,
) : DataSource.Factory {
  constructor(context: Context) : this(
    DefaultDataSource.Factory(
      context.applicationContext,
      failClosedMediaHttpDataSourceFactory(),
    ),
    LoggeRythmPlayerRuntime::cookieFor,
  )

  override fun createDataSource(): DataSource = SecureDataSource(
    upstreamFactory.createDataSource(),
    cookieFor,
  )

  private class SecureDataSource(
    private val upstream: DataSource,
    private val cookieFor: (String) -> String?,
  ) : DataSource {
    private var openedUri: Uri? = null

    override fun addTransferListener(transferListener: TransferListener) {
      upstream.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
      val cookie = cookieFor(dataSpec.uri.toString())
      val allowedHeaders = if (cookie == null) emptyMap() else mapOf("Cookie" to cookie)
      openedUri = dataSpec.uri
      return try {
        upstream.open(dataSpec.withRequestHeaders(allowedHeaders))
      } catch (error: Exception) {
        openedUri = null
        throw error
      }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
      upstream.read(buffer, offset, length)

    // Keep redirects or upstream implementation details out of cache metadata.
    override fun getUri(): Uri? = openedUri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
      try {
        upstream.close()
      } finally {
        openedUri = null
      }
    }
  }
}

@UnstableApi
internal class LoggeRythmFailSafeCacheDataSourceFactory(
  private val cacheFactory: CacheDataSource.Factory,
  private val fallbackFactory: DataSource.Factory,
) : DataSource.Factory {
  override fun createDataSource(): DataSource = FailSafeCacheDataSource(
    cacheFactory.createDataSource(),
    fallbackFactory.createDataSource(),
  )

  private class FailSafeCacheDataSource(
    private val cached: DataSource,
    private val fallback: DataSource,
  ) : DataSource {
    private var active: DataSource? = null
    private var originalSpec: DataSpec? = null
    private var bytesRead = 0L

    override fun addTransferListener(transferListener: TransferListener) {
      cached.addTransferListener(transferListener)
      fallback.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
      originalSpec = dataSpec
      bytesRead = 0L
      if (dataSpec.uri.scheme != "https") {
        active = fallback
        return fallback.open(dataSpec)
      }
      active = cached
      return try {
        cached.open(dataSpec)
      } catch (_: Exception) {
        runCatching { cached.close() }
        active = fallback
        fallback.open(dataSpec)
      }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      val source = active ?: throw IllegalStateException("player-data-source-not-open")
      return try {
        source.read(buffer, offset, length).also { read ->
          if (read != C.RESULT_END_OF_INPUT) bytesRead += read.toLong()
        }
      } catch (error: Exception) {
        if (source !== cached) throw error
        runCatching { cached.close() }
        val spec = originalSpec ?: throw error
        val remaining = if (spec.length == C.LENGTH_UNSET.toLong()) {
          C.LENGTH_UNSET.toLong()
        } else {
          (spec.length - bytesRead).coerceAtLeast(0L)
        }
        val resumed = spec.buildUpon()
          .setPosition(spec.position + bytesRead)
          .setLength(remaining)
          .build()
        active = fallback
        fallback.open(resumed)
        fallback.read(buffer, offset, length).also { read ->
          if (read != C.RESULT_END_OF_INPUT) bytesRead += read.toLong()
        }
      }
    }

    override fun getUri(): Uri? = active?.uri

    override fun getResponseHeaders(): Map<String, List<String>> =
      active?.responseHeaders ?: emptyMap()

    override fun close() {
      try {
        active?.close()
      } finally {
        active = null
        originalSpec = null
        bytesRead = 0L
      }
    }
  }
}
