package top.logge.loggerythm.player

import java.net.URI

internal class LoggeRythmCookieVault {
  private val lock = Any()
  private var queueCookies: Map<String, String?> = emptyMap()
  private var browseCookies: Map<String, String?> = emptyMap()
  private var searchCookies: Map<String, String?> = emptyMap()

  fun replaceQueue(entries: List<Pair<String, String?>>) = synchronized(lock) {
    queueCookies = normalized(entries)
  }

  fun replaceBrowse(entries: List<Pair<String, String?>>) = synchronized(lock) {
    browseCookies = normalized(entries)
  }

  fun replaceSearch(entries: List<Pair<String, String?>>) = synchronized(lock) {
    searchCookies = normalized(entries)
  }

  fun clearQueue() = synchronized(lock) {
    queueCookies = emptyMap()
  }

  fun clearSearch() = synchronized(lock) {
    searchCookies = emptyMap()
  }

  fun clearAll() = synchronized(lock) {
    queueCookies = emptyMap()
    browseCookies = emptyMap()
    searchCookies = emptyMap()
  }

  fun cookieFor(url: String): String? = synchronized(lock) {
    when {
      queueCookies.containsKey(url) -> queueCookies[url]
      browseCookies.containsKey(url) -> browseCookies[url]
      else -> searchCookies[url]
    }
  }

  /**
   * Returns the unique non-blank session Cookie vaulted for [origin] across the active account's
   * queue and browse entries, or `null` when only unauthenticated / local-file sources exist.
   * Throws [PlayerProtocolException] if two distinct non-blank Cookies are vaulted for the same
   * origin.
   */
  fun sessionCookieForOrigin(origin: String): String? = synchronized(lock) {
    var matched: String? = null
    fun inspect(entries: Map<String, String?>) {
      entries.forEach { (url, cookie) ->
        if (cookie.isNullOrBlank()) return@forEach
        if (canonicalHttpsOrigin(url) != origin) return@forEach
        if (matched != null && matched != cookie) {
          throw PlayerProtocolException("header-url-conflict")
        }
        matched = cookie
      }
    }
    inspect(queueCookies)
    inspect(browseCookies)
    matched
  }

  private fun canonicalHttpsOrigin(url: String): String? {
    return try {
      val uri = URI(url)
      if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return null
      val port = if (uri.port == 443) -1 else uri.port
      URI("https", null, uri.host.lowercase(), port, null, null, null).toASCIIString()
    } catch (_: Exception) {
      null
    }
  }

  private fun normalized(entries: List<Pair<String, String?>>): Map<String, String?> {
    val next = linkedMapOf<String, String?>()
    entries.forEach { (url, cookie) ->
      val existed = next.containsKey(url)
      val previous = next.put(url, cookie)
      if (existed && previous != cookie) {
        throw PlayerProtocolException("header-url-conflict")
      }
    }
    return next.toMap()
  }
}
