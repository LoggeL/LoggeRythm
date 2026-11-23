package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class LoggeRythmCookieVaultTest {
  @Test
  fun duplicateUrlUsesOneStableUriLookupAcrossQueueRevisions() {
    val vault = LoggeRythmCookieVault()
    val url = "https://example.test/stream?retry=stable"
    vault.replaceQueue(listOf(url to "first", url to "first"))
    assertEquals("first", vault.cookieFor(url))

    vault.replaceQueue(listOf(url to "replacement"))
    assertEquals("replacement", vault.cookieFor(url))
  }

  @Test
  fun conflictingCookiesForSameUrlFailClosedWithoutCommitting() {
    val vault = LoggeRythmCookieVault()
    val url = "https://example.test/stream"
    vault.replaceQueue(listOf(url to "original"))
    assertThrows(PlayerProtocolException::class.java) {
      vault.replaceQueue(listOf(url to "one", url to "two"))
    }
    assertEquals("original", vault.cookieFor(url))
  }

  @Test
  fun clearAllRemovesQueueAndBrowseCredentials() {
    val vault = LoggeRythmCookieVault()
    vault.replaceQueue(listOf("https://example.test/q" to "queue"))
    vault.replaceBrowse(listOf("https://example.test/b" to "browse"))
    vault.clearAll()
    assertNull(vault.cookieFor("https://example.test/q"))
    assertNull(vault.cookieFor("https://example.test/b"))
  }

  @Test
  fun unauthenticatedQueueUrlShadowsBrowseCookieForTheSameUri() {
    val vault = LoggeRythmCookieVault()
    val url = "https://example.test/shared"
    vault.replaceBrowse(listOf(url to "browse-cookie"))
    vault.replaceQueue(listOf(url to null))
    assertNull(vault.cookieFor(url))
  }

  @Test
  fun searchCookiesStayBelowQueueAndBrowseAndClearOnReset() {
    val vault = LoggeRythmCookieVault()
    val url = "https://music.example.test/api/tracks/1/stream"
    vault.replaceSearch(listOf(url to "search-cookie"))
    assertEquals("search-cookie", vault.cookieFor(url))

    vault.replaceBrowse(listOf(url to "browse-cookie"))
    assertEquals("browse-cookie", vault.cookieFor(url))

    vault.clearSearch()
    assertEquals("browse-cookie", vault.cookieFor(url))

    vault.replaceSearch(listOf("https://music.example.test/api/tracks/2/stream" to "search-2"))
    vault.clearAll()
    assertNull(vault.cookieFor("https://music.example.test/api/tracks/2/stream"))
  }

  @Test
  fun sessionCookieForOriginMatchesCanonicalOriginAndFailsClosedOnConflict() {
    val vault = LoggeRythmCookieVault()
    vault.replaceBrowse(
      listOf(
        "https://MUSIC.EXAMPLE.TEST:443/api/tracks/1/stream" to "sf_session=primary",
        "https://other.example.test/api/tracks/2/stream" to "sf_session=other",
        "https://music.example.test/api/tracks/3/stream" to null,
      ),
    )
    assertEquals("sf_session=primary", vault.sessionCookieForOrigin("https://music.example.test"))
    assertNull(vault.sessionCookieForOrigin("https://unknown.example.test"))

    vault.replaceQueue(listOf("https://music.example.test/api/tracks/4/stream" to "sf_session=different"))
    val conflict = assertThrows(PlayerProtocolException::class.java) {
      vault.sessionCookieForOrigin("https://music.example.test")
    }
    assertEquals("header-url-conflict", conflict.code)
  }
}
