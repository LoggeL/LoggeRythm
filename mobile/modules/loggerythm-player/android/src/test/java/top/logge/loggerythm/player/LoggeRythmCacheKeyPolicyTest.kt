package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LoggeRythmCacheKeyPolicyTest {
  @Test
  fun usesTheExactHttpsUriIncludingRetryNonce() {
    val first = "https://loggerythm.logge.top/api/tracks/1/stream?nonce=one%2Ftwo&part=1"
    val second = "https://loggerythm.logge.top/api/tracks/1/stream?nonce=retry&part=1"

    assertEquals(first, LoggeRythmCacheKeyPolicy.cacheKey(first))
    assertNotEquals(
      LoggeRythmCacheKeyPolicy.cacheKey(first),
      LoggeRythmCacheKeyPolicy.cacheKey(second),
    )
  }

  @Test
  fun rejectsNonHttpsUserInfoAndFragments() {
    for (url in listOf(
      "http://example.test/audio",
      "https://user:password@example.test/audio",
      "https://example.test/audio#fragment",
      "not a uri",
    )) {
      val error = assertThrows(LoggeRythmCacheException::class.java) {
        LoggeRythmCacheKeyPolicy.cacheKey(url)
      }
      assertEquals("player-cache-key-invalid", error.code)
    }
  }
}
