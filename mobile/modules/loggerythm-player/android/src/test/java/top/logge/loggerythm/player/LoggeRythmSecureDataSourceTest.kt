package top.logge.loggerythm.player

import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.TimeUnit

class LoggeRythmSecureDataSourceTest {
  @Test
  fun authenticatedHttpsRedirectIsRejectedWithoutContactingTarget() {
    val certificate = HeldCertificate.Builder()
      .addSubjectAlternativeName("localhost")
      .build()
    val serverCertificates = HandshakeCertificates.Builder()
      .heldCertificate(certificate)
      .build()
    val clientCertificates = HandshakeCertificates.Builder()
      .addTrustedCertificate(certificate.certificate)
      .build()
    val origin = MockWebServer()
    val target = MockWebServer()
    origin.useHttps(serverCertificates.sslSocketFactory(), false)
    target.useHttps(serverCertificates.sslSocketFactory(), false)
    origin.start()
    target.start()

    try {
      val targetUrl = target.url("/must-not-receive-cookie")
      origin.enqueue(
        MockResponse()
          .setResponseCode(302)
          .setHeader("Location", targetUrl),
      )
      target.enqueue(MockResponse().setBody("credential leak"))

      val cookie = "loggerythm_session=private"
      val client = failClosedMediaHttpClient {
        sslSocketFactory(
          clientCertificates.sslSocketFactory(),
          clientCertificates.trustManager,
        )
        // The fail-closed builder must win even if a future customization tries to enable these.
        followRedirects(true)
        followSslRedirects(true)
      }
      val originUrl = origin.url("/stream")
      val request = Request.Builder()
        .url(originUrl)
        .header("Cookie", cookie)
        .build()

      client.newCall(request).execute().use { response ->
        assertEquals(302, response.code)
      }

      val originRequest = origin.takeRequest(1, TimeUnit.SECONDS)
      assertNotNull(originRequest)
      assertEquals(cookie, originRequest?.getHeader("Cookie"))
      assertNull(target.takeRequest(250, TimeUnit.MILLISECONDS))
    } finally {
      origin.shutdown()
      target.shutdown()
    }
  }
}
