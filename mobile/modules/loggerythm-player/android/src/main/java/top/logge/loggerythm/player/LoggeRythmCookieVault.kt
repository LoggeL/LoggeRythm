package top.logge.loggerythm.player

internal class LoggeRythmCookieVault {
  private val lock = Any()
  private var queueCookies: Map<String, String?> = emptyMap()
  private var browseCookies: Map<String, String?> = emptyMap()

  fun replaceQueue(entries: List<Pair<String, String?>>) = synchronized(lock) {
    queueCookies = normalized(entries)
  }

  fun replaceBrowse(entries: List<Pair<String, String?>>) = synchronized(lock) {
    browseCookies = normalized(entries)
  }

  fun clearQueue() = synchronized(lock) {
    queueCookies = emptyMap()
  }

  fun clearAll() = synchronized(lock) {
    queueCookies = emptyMap()
    browseCookies = emptyMap()
  }

  fun cookieFor(url: String): String? = synchronized(lock) {
    if (queueCookies.containsKey(url)) queueCookies[url] else browseCookies[url]
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
