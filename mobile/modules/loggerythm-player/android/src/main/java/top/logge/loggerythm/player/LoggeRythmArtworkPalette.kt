package top.logge.loggerythm.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.Locale
import okhttp3.OkHttpClient
import okhttp3.Request

internal class LoggeRythmArtworkPaletteException(val code: String) : IllegalStateException(code)

internal data class LoggeRythmArtworkPalette(
  val vibrant: String?,
  val darkVibrant: String?,
  val muted: String?,
  val darkMuted: String?,
  val dominant: String,
)

internal sealed interface ArtworkUriTarget {
  val canonicalUri: String

  data class Https(override val canonicalUri: String, val origin: String) : ArtworkUriTarget
  data class LocalFile(override val canonicalUri: String, val file: File) : ArtworkUriTarget
}

/**
 * Extracts dynamic artwork palettes via `androidx.palette.graphics.Palette` for Now Playing,
 * Mini Player, and Android TV ambient lighting.
 *
 * Strictly fail-loud: invalid URIs, paths outside app-private storage, redirects, HTTP errors,
 * non-image payloads, oversized files, or undecodable bitmaps always throw
 * [LoggeRythmArtworkPaletteException] — never returning fake placeholder colors.
 */
internal class LoggeRythmArtworkPaletteExtractor(
  privateRoots: List<File>,
  private val httpClient: OkHttpClient = failClosedMediaHttpClient(),
  private val cookieForUrl: (String) -> String? = ::resolveArtworkCookie,
  private val decodePaletteFromBytes: (ByteArray) -> LoggeRythmArtworkPalette =
    ::decodePaletteWithAndroidBitmap,
) {
  private val canonicalPrivateRoots = privateRoots.map { it.canonicalFile }.distinct()
  private val cacheLock = Any()
  private val cache = object : LinkedHashMap<String, LoggeRythmArtworkPalette>(
    MAX_CACHE_ENTRIES,
    0.75f,
    true,
  ) {
    override fun removeEldestEntry(
      eldest: MutableMap.MutableEntry<String, LoggeRythmArtworkPalette>?,
    ): Boolean = size > MAX_CACHE_ENTRIES
  }

  init {
    require(canonicalPrivateRoots.isNotEmpty()) { "artwork-private-roots-empty" }
  }

  fun extract(rawUri: String): LoggeRythmArtworkPalette {
    val target = validateUri(rawUri)
    synchronized(cacheLock) {
      cache[target.canonicalUri]?.let { return it }
    }
    val bytes = when (target) {
      is ArtworkUriTarget.LocalFile -> readLocalArtwork(target.file)
      is ArtworkUriTarget.Https -> fetchRemoteArtwork(target)
    }
    val palette = decodePaletteFromBytes(bytes)
    synchronized(cacheLock) {
      cache[target.canonicalUri] = palette
    }
    return palette
  }

  fun clearCache() {
    synchronized(cacheLock) {
      cache.clear()
    }
  }

  internal fun validateUri(rawUri: String): ArtworkUriTarget {
    val trimmed = rawUri.trim()
    if (trimmed.isEmpty() || trimmed.length > MAX_URI_LENGTH) {
      throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
    }
    val uri = try {
      URI(trimmed)
    } catch (_: Exception) {
      throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
    }
    return when (uri.scheme?.lowercase(Locale.ROOT)) {
      "https" -> {
        if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) {
          throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
        }
        val port = if (uri.port == 443) -1 else uri.port
        val origin = try {
          URI("https", null, uri.host.lowercase(Locale.ROOT), port, null, null, null).toASCIIString()
        } catch (_: Exception) {
          throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
        }
        ArtworkUriTarget.Https(canonicalUri = uri.toASCIIString(), origin = origin)
      }
      "file" -> {
        if (
          uri.host?.isNotEmpty() == true ||
          uri.userInfo != null ||
          uri.query != null ||
          uri.fragment != null
        ) {
          throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
        }
        val candidate = try {
          File(uri).canonicalFile
        } catch (_: Exception) {
          throw LoggeRythmArtworkPaletteException("artwork-uri-invalid")
        }
        if (canonicalPrivateRoots.none { candidate.isStrictlyInside(it) }) {
          throw LoggeRythmArtworkPaletteException("artwork-file-outside-private-storage")
        }
        if (!candidate.isFile || !candidate.canRead()) {
          throw LoggeRythmArtworkPaletteException("artwork-file-unreadable")
        }
        ArtworkUriTarget.LocalFile(
          canonicalUri = candidate.toURI().toASCIIString(),
          file = candidate,
        )
      }
      else -> throw LoggeRythmArtworkPaletteException("artwork-uri-scheme-invalid")
    }
  }

  private fun readLocalArtwork(file: File): ByteArray {
    val size = file.length()
    if (size <= 0L || size > MAX_IMAGE_BYTES) {
      throw LoggeRythmArtworkPaletteException("artwork-size-invalid")
    }
    return try {
      file.readBytes()
    } catch (_: IOException) {
      throw LoggeRythmArtworkPaletteException("artwork-file-unreadable")
    }
  }

  private fun fetchRemoteArtwork(target: ArtworkUriTarget.Https): ByteArray {
    val requestBuilder = Request.Builder()
      .url(target.canonicalUri)
      .header("Accept", "image/*")
      .get()
    val cookie = cookieForUrl(target.canonicalUri)
    if (!cookie.isNullOrBlank()) {
      requestBuilder.header("Cookie", cookie)
    }
    val response = try {
      httpClient.newCall(requestBuilder.build()).execute()
    } catch (_: IOException) {
      throw LoggeRythmArtworkPaletteException("artwork-network-error")
    }
    response.use { res ->
      when {
        res.code in 300..399 ->
          throw LoggeRythmArtworkPaletteException("artwork-redirect-rejected")
        res.code == 401 || res.code == 403 ->
          throw LoggeRythmArtworkPaletteException("artwork-auth-required")
        res.code != 200 ->
          throw LoggeRythmArtworkPaletteException("artwork-http-error")
      }
      val contentType = res.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
      if (contentType != null && !contentType.startsWith("image/") && contentType != "application/octet-stream") {
        throw LoggeRythmArtworkPaletteException("artwork-content-type-invalid")
      }
      val body = res.body ?: throw LoggeRythmArtworkPaletteException("artwork-empty")
      val declaredLength = body.contentLength()
      if (declaredLength > MAX_IMAGE_BYTES) {
        throw LoggeRythmArtworkPaletteException("artwork-size-invalid")
      }
      val bytes = try {
        body.byteStream().use { input ->
          val out = ByteArrayOutputStream()
          val chunk = ByteArray(8192)
          var total = 0L
          while (true) {
            val read = input.read(chunk)
            if (read < 0) break
            total += read
            if (total > MAX_IMAGE_BYTES) {
              throw LoggeRythmArtworkPaletteException("artwork-size-invalid")
            }
            out.write(chunk, 0, read)
          }
          out.toByteArray()
        }
      } catch (error: LoggeRythmArtworkPaletteException) {
        throw error
      } catch (_: IOException) {
        throw LoggeRythmArtworkPaletteException("artwork-network-error")
      }
      if (bytes.isEmpty()) throw LoggeRythmArtworkPaletteException("artwork-empty")
      return bytes
    }
  }

  private fun File.isStrictlyInside(root: File): Boolean {
    val rootPath = root.path.trimEnd(File.separatorChar) + File.separator
    return path.startsWith(rootPath)
  }

  companion object {
    private const val MAX_CACHE_ENTRIES = 64
    private const val MAX_URI_LENGTH = 4_096
    private const val MAX_IMAGE_BYTES = 10L * 1024L * 1024L
    private const val TARGET_BITMAP_MAX_DIM = 256

    internal fun formatHexRgb(colorInt: Int): String =
      String.format(Locale.ROOT, "#%06x", colorInt and 0xFFFFFF)

    internal fun computeSampleSize(width: Int, height: Int, maxDim: Int = TARGET_BITMAP_MAX_DIM): Int {
      if (width <= 0 || height <= 0 || maxDim <= 0) {
        throw LoggeRythmArtworkPaletteException("artwork-decode-failed")
      }
      var sample = 1
      val largest = maxOf(width, height)
      while (largest / (sample * 2) >= maxDim) {
        sample *= 2
      }
      return sample
    }

    internal fun paletteFromRgbSwatches(
      vibrant: Int?,
      darkVibrant: Int?,
      muted: Int?,
      darkMuted: Int?,
      dominant: Int?,
    ): LoggeRythmArtworkPalette {
      val resolvedDominant = dominant ?: vibrant ?: darkVibrant ?: muted ?: darkMuted
        ?: throw LoggeRythmArtworkPaletteException("artwork-palette-empty")
      return LoggeRythmArtworkPalette(
        vibrant = vibrant?.let(::formatHexRgb),
        darkVibrant = darkVibrant?.let(::formatHexRgb),
        muted = muted?.let(::formatHexRgb),
        darkMuted = darkMuted?.let(::formatHexRgb),
        dominant = formatHexRgb(resolvedDominant),
      )
    }

    private fun resolveArtworkCookie(url: String): String? {
      LoggeRythmPlayerRuntime.cookieFor(url)?.let { return it }
      val sessionAuth = LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin() ?: return null
      val (boundOrigin, cookie) = sessionAuth
      val uri = try {
        URI(url)
      } catch (_: Exception) {
        return null
      }
      val port = if (uri.port == 443) -1 else uri.port
      val origin = try {
        URI("https", null, uri.host?.lowercase(Locale.ROOT), port, null, null, null).toASCIIString()
      } catch (_: Exception) {
        return null
      }
      return if (origin == boundOrigin) cookie else null
    }

    private fun decodePaletteWithAndroidBitmap(bytes: ByteArray): LoggeRythmArtworkPalette {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw LoggeRythmArtworkPaletteException("artwork-decode-failed")
      }
      val options = BitmapFactory.Options().apply {
        inSampleSize = computeSampleSize(bounds.outWidth, bounds.outHeight)
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?: throw LoggeRythmArtworkPaletteException("artwork-decode-failed")
      return try {
        val palette = Palette.from(bitmap).maximumColorCount(16).generate()
        paletteFromRgbSwatches(
          vibrant = palette.vibrantSwatch?.rgb,
          darkVibrant = palette.darkVibrantSwatch?.rgb,
          muted = palette.mutedSwatch?.rgb,
          darkMuted = palette.darkMutedSwatch?.rgb,
          dominant = palette.dominantSwatch?.rgb,
        )
      } finally {
        bitmap.recycle()
      }
    }
  }
}
