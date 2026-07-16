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
}
