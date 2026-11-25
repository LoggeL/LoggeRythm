package top.logge.loggerythm.player

import java.io.File
import java.net.InetAddress
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class LoggeRythmArtworkPaletteTest {
  private lateinit var tempRoot: File
  private lateinit var privateDir: File
  private lateinit var outsideDir: File
  private lateinit var server: MockWebServer
  private lateinit var clientCerts: HandshakeCertificates

  @Before
  fun setUp() {
    tempRoot = Files.createTempDirectory("palette-test").toFile()
    privateDir = File(tempRoot, "private").apply { mkdirs() }
    outsideDir = File(tempRoot, "outside").apply { mkdirs() }

    val localhost = InetAddress.getByName("127.0.0.1").canonicalHostName
    val serverCert = HeldCertificate.Builder()
      .addSubjectAlternativeName("localhost")
      .addSubjectAlternativeName("127.0.0.1")
      .addSubjectAlternativeName(localhost)
      .build()
    val serverCerts = HandshakeCertificates.Builder()
      .heldCertificate(serverCert)
      .build()
    clientCerts = HandshakeCertificates.Builder()
      .addTrustedCertificate(serverCert.certificate)
      .build()

    server = MockWebServer()
    server.useHttps(serverCerts.sslSocketFactory(), false)
    server.start()
  }

  @After
  fun tearDown() {
    server.shutdown()
    tempRoot.deleteRecursively()
  }

  @Test
  fun formatsHexColorsComputesSampleSizeAndFailsLoudOnEmptySwatches() {
    assertEquals("#d6ff4b", LoggeRythmArtworkPaletteExtractor.formatHexRgb(0xFFD6FF4B.toInt()))
    assertEquals("#0f0e11", LoggeRythmArtworkPaletteExtractor.formatHexRgb(0xFF0F0E11.toInt()))
    assertEquals(1, LoggeRythmArtworkPaletteExtractor.computeSampleSize(256, 256))
    assertEquals(2, LoggeRythmArtworkPaletteExtractor.computeSampleSize(512, 512))
    assertEquals(4, LoggeRythmArtworkPaletteExtractor.computeSampleSize(1200, 1200))

    val palette = LoggeRythmArtworkPaletteExtractor.paletteFromRgbSwatches(
      vibrant = 0xFFD6FF4B.toInt(),
      darkVibrant = 0xFF223311.toInt(),
      muted = null,
      darkMuted = 0xFF161519.toInt(),
      dominant = 0xFF0F0E11.toInt(),
    )
    assertEquals("#d6ff4b", palette.vibrant)
    assertEquals("#223311", palette.darkVibrant)
    assertNull(palette.muted)
    assertEquals("#161519", palette.darkMuted)
    assertEquals("#0f0e11", palette.dominant)

    val emptyError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      LoggeRythmArtworkPaletteExtractor.paletteFromRgbSwatches(null, null, null, null, null)
    }
    assertEquals("artwork-palette-empty", emptyError.code)
  }

  @Test
  fun extractsFromPrivateLocalFileAndRejectsPathsOutsidePrivateRoots() {
    val validFile = File(privateDir, "cover.jpg").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
    val outsideFile = File(outsideDir, "secret.jpg").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
    val decodeCalls = AtomicInteger(0)
    val expected = LoggeRythmArtworkPalette(
      vibrant = "#d6ff4b",
      darkVibrant = "#1e2a0c",
      muted = "#6e7366",
      darkMuted = "#161519",
      dominant = "#0f0e11",
    )

    val extractor = LoggeRythmArtworkPaletteExtractor(
      privateRoots = listOf(privateDir),
      decodePaletteFromBytes = { bytes ->
        assertEquals(4, bytes.size)
        decodeCalls.incrementAndGet()
        expected
      },
    )

    val first = extractor.extract(validFile.toURI().toASCIIString())
    val second = extractor.extract(validFile.toURI().toASCIIString())
    assertEquals(expected, first)
    assertEquals(expected, second)
    assertEquals(1, decodeCalls.get())

    val outsideError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract(outsideFile.toURI().toASCIIString())
    }
    assertEquals("artwork-file-outside-private-storage", outsideError.code)

    val missingError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract(File(privateDir, "missing.jpg").toURI().toASCIIString())
    }
    assertEquals("artwork-file-unreadable", missingError.code)

    val cleartextError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract("http://insecure.example/cover.jpg")
    }
    assertEquals("artwork-uri-scheme-invalid", cleartextError.code)
  }

  @Test
  fun fetchesHttpsArtworkWithFailClosedRedirectAndErrorHandling() {
    val httpClient = failClosedMediaHttpClient {
      sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager)
    }
    val expected = LoggeRythmArtworkPalette(
      vibrant = "#ff5500",
      darkVibrant = "#441100",
      muted = "#aa8877",
      darkMuted = "#221a16",
      dominant = "#331810",
    )
    val extractor = LoggeRythmArtworkPaletteExtractor(
      privateRoots = listOf(privateDir),
      httpClient = httpClient,
      cookieForUrl = { "sf_session=test-cookie" },
      decodePaletteFromBytes = { expected },
    )

    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .addHeader("Content-Type", "image/jpeg")
        .setBody("fake-jpeg-bytes"),
    )
    val url = server.url("/covers/42.jpg").toString()
    assertEquals(expected, extractor.extract(url))
    val req = server.takeRequest()
    assertEquals("sf_session=test-cookie", req.getHeader("Cookie"))

    // Redirect rejected loudly (no silent redirect following)
    server.enqueue(
      MockResponse()
        .setResponseCode(302)
        .addHeader("Location", "https://evil.example/steal"),
    )
    val redirectError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract(server.url("/covers/redirect.jpg").toString())
    }
    assertEquals("artwork-redirect-rejected", redirectError.code)

    // Non-image content rejected loudly
    server.enqueue(
      MockResponse()
        .setResponseCode(200)
        .addHeader("Content-Type", "text/html")
        .setBody("<html>not an image</html>"),
    )
    val mimeError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract(server.url("/covers/html.jpg").toString())
    }
    assertEquals("artwork-content-type-invalid", mimeError.code)

    // 404 rejected loudly
    server.enqueue(MockResponse().setResponseCode(404))
    val httpError = assertThrows(LoggeRythmArtworkPaletteException::class.java) {
      extractor.extract(server.url("/covers/missing.jpg").toString())
    }
    assertEquals("artwork-http-error", httpError.code)
  }
}
