package top.logge.loggerythm.updater

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

private class UpdaterException(
  val errorCode: String,
  message: String,
  cause: Throwable? = null,
) : Exception(message, cause)

private data class InstalledPackage(
  val versionName: String,
  val versionCode: Long,
  val signerDigests: Set<String>,
)

private data class ValidatedUpdate(
  val file: File,
  val versionName: String,
  val versionCode: Long,
)

class LoggeRythmUpdaterModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val worker = Executors.newSingleThreadExecutor()

  override fun getName(): String = NAME

  @ReactMethod
  fun getInstallationInfo(promise: Promise) {
    worker.execute {
      settle(promise) {
        val installed = installedPackage()
        Arguments.createMap().apply {
          putString("versionName", installed.versionName)
          putDouble("versionCode", installed.versionCode.toDouble())
          putBoolean("canRequestPackageInstalls", canRequestPackageInstalls())
        }
      }
    }
  }

  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(null)
      return
    }
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${reactContext.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (intent.resolveActivity(reactContext.packageManager) == null) {
        throw UpdaterException(
          "updater-install-settings-unavailable",
          "Android has no activity for the app install permission settings",
        )
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      reject(promise, error)
    }
  }

  @ReactMethod
  fun downloadAndInstall(
    url: String,
    digest: String,
    versionName: String,
    promise: Promise,
  ) {
    worker.execute {
      var downloaded: File? = null
      try {
        if (!canRequestPackageInstalls()) {
          throw UpdaterException(
            "updater-install-permission-required",
            "Allow LoggeRythm to install updates, then try again",
          )
        }
        val expectedDigest = parseDigest(digest)
        val expectedVersionName = normalizedVersion(versionName)
        downloaded = download(url, expectedDigest)
        val update = validateApk(downloaded, expectedVersionName)
        requestInstall(update)
        promise.resolve(
          Arguments.createMap().apply {
            putString("status", "awaiting-user-confirmation")
            putString("versionName", update.versionName)
            putDouble("versionCode", update.versionCode.toDouble())
          },
        )
      } catch (error: Throwable) {
        reject(promise, error)
      } finally {
        downloaded?.delete()
      }
    }
  }

  override fun invalidate() {
    worker.shutdownNow()
    super.invalidate()
  }

  private fun settle(promise: Promise, action: () -> Any?) {
    try {
      promise.resolve(action())
    } catch (error: Throwable) {
      reject(promise, error)
    }
  }

  private fun reject(promise: Promise, error: Throwable) {
    val updaterError = error as? UpdaterException
    promise.reject(
      updaterError?.errorCode ?: "updater-native-failed",
      updaterError?.message ?: "Android update operation failed",
      error,
    )
  }

  private fun canRequestPackageInstalls(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      reactContext.packageManager.canRequestPackageInstalls()

  private fun installedPackage(): InstalledPackage {
    val info = packageInfo(reactContext.packageName)
    val versionName = info.versionName?.trim()
      ?.takeIf(String::isNotEmpty)
      ?: throw UpdaterException(
        "updater-installed-version-missing",
        "Installed LoggeRythm version name is missing",
      )
    return InstalledPackage(
      versionName = versionName,
      versionCode = longVersionCode(info),
      signerDigests = signerDigests(info),
    )
  }

  private fun download(url: String, expectedDigest: String): File {
    var current = validateReleaseUrl(url, initial = true)
    repeat(MAX_REDIRECTS + 1) { redirectCount ->
      val connection = (URL(current.toString()).openConnection() as? HttpsURLConnection)
        ?: throw UpdaterException(
          "updater-download-insecure",
          "Update download did not use HTTPS",
        )
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.setRequestProperty("Accept", "application/octet-stream")
        connection.setRequestProperty("User-Agent", "LoggeRythm-Android-Updater")
        val status = connection.responseCode
        if (status in 300..399) {
          if (redirectCount == MAX_REDIRECTS) {
            throw UpdaterException(
              "updater-download-redirect-limit",
              "Update download exceeded the redirect limit",
            )
          }
          val location = connection.getHeaderField("Location")
            ?: throw UpdaterException(
              "updater-download-redirect-invalid",
              "Update download redirect omitted its destination",
            )
          current = validateReleaseUrl(current.resolve(location).toString(), initial = false)
          return@repeat
        }
        if (status != HttpURLConnection.HTTP_OK) {
          throw UpdaterException(
            "updater-download-http",
            "Update download failed with HTTP $status",
          )
        }
        val declaredLength = connection.contentLengthLong
        if (declaredLength > MAX_APK_BYTES) {
          throw UpdaterException(
            "updater-download-too-large",
            "Update APK exceeds the ${MAX_APK_BYTES / 1_048_576} MiB limit",
          )
        }
        val directory = File(reactContext.cacheDir, "verified-updates")
        if (!directory.exists() && !directory.mkdirs()) {
          throw UpdaterException(
            "updater-cache-unavailable",
            "Could not create the protected update cache directory",
          )
        }
        val target = File(directory, "loggerythm-update.apk")
        val temporary = File(directory, "loggerythm-update.apk.part")
        if (temporary.exists() && !temporary.delete()) {
          throw UpdaterException(
            "updater-cache-cleanup-failed",
            "Could not clear an incomplete update download",
          )
        }
        val hash = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
          connection.inputStream.buffered().use { input ->
            temporary.outputStream().buffered().use { output ->
              val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count == 0) continue
                total += count
                if (total > MAX_APK_BYTES) {
                  throw UpdaterException(
                    "updater-download-too-large",
                    "Update APK exceeds the ${MAX_APK_BYTES / 1_048_576} MiB limit",
                  )
                }
                output.write(buffer, 0, count)
                hash.update(buffer, 0, count)
              }
            }
          }
          if (total <= 0L || (declaredLength >= 0L && total != declaredLength)) {
            throw UpdaterException(
              "updater-download-incomplete",
              "Update APK download was empty or incomplete",
            )
          }
          val actualDigest = hash.digest().toHex()
          if (actualDigest != expectedDigest) {
            throw UpdaterException(
              "updater-digest-mismatch",
              "Downloaded update failed its GitHub SHA-256 verification",
            )
          }
          if (target.exists() && !target.delete()) {
            throw UpdaterException(
              "updater-cache-cleanup-failed",
              "Could not replace the previous verified update",
            )
          }
          if (!temporary.renameTo(target)) {
            throw UpdaterException(
              "updater-cache-finalize-failed",
              "Could not finalize the verified update APK",
            )
          }
          return target
        } finally {
          temporary.delete()
        }
      } catch (error: UpdaterException) {
        throw error
      } catch (error: IOException) {
        throw UpdaterException(
          "updater-download-io",
          "Update APK download failed",
          error,
        )
      } finally {
        connection.disconnect()
      }
    }
    throw UpdaterException(
      "updater-download-unreachable",
      "Update download did not produce an APK",
    )
  }

  private fun validateApk(file: File, expectedVersionName: String): ValidatedUpdate {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }
    @Suppress("DEPRECATION")
    val archive = reactContext.packageManager.getPackageArchiveInfo(file.absolutePath, flags)
      ?: throw UpdaterException(
        "updater-apk-invalid",
        "Downloaded file is not a readable Android APK",
      )
    if (archive.packageName != reactContext.packageName) {
      throw UpdaterException(
        "updater-package-mismatch",
        "Update APK belongs to ${archive.packageName}, not ${reactContext.packageName}",
      )
    }
    val archiveVersionName = archive.versionName?.trim()
      ?.takeIf(String::isNotEmpty)
      ?: throw UpdaterException(
        "updater-apk-version-missing",
        "Update APK version name is missing",
      )
    if (normalizedVersion(archiveVersionName) != expectedVersionName) {
      throw UpdaterException(
        "updater-apk-version-mismatch",
        "Update APK version does not match the GitHub release",
      )
    }
    val installed = installedPackage()
    val archiveVersionCode = longVersionCode(archive)
    if (archiveVersionCode <= installed.versionCode) {
      throw UpdaterException(
        "updater-apk-not-newer",
        "Update APK version code is not newer than the installed app",
      )
    }
    if (signerDigests(archive) != installed.signerDigests) {
      throw UpdaterException(
        "updater-signature-mismatch",
        "Update APK signing certificate does not match the installed app",
      )
    }
    return ValidatedUpdate(file, archiveVersionName, archiveVersionCode)
  }

  private fun requestInstall(update: ValidatedUpdate) {
    val installer = reactContext.packageManager.packageInstaller
    val parameters = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      .apply {
        setAppPackageName(reactContext.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
      }
    val sessionId = try {
      installer.createSession(parameters)
    } catch (error: IOException) {
      throw UpdaterException(
        "updater-install-session-failed",
        "Could not create the Android update installation session",
        error,
      )
    }
    try {
      installer.openSession(sessionId).use { session ->
        update.file.inputStream().buffered().use { input ->
          session.openWrite("LoggeRythm.apk", 0, update.file.length()).use { output ->
            input.copyTo(output)
            session.fsync(output)
          }
        }
        session.commit(LoggeRythmUpdateInstallReceiver.statusIntent(reactContext).intentSender)
      }
    } catch (error: Throwable) {
      installer.abandonSession(sessionId)
      if (error is UpdaterException) throw error
      throw UpdaterException(
        "updater-install-commit-failed",
        "Could not submit the verified APK to Android's package installer",
        error,
      )
    }
  }

  private fun packageInfo(packageName: String): PackageInfo {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      @Suppress("DEPRECATION")
      PackageManager.GET_SIGNATURES
    }
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        reactContext.packageManager.getPackageInfo(
          packageName,
          PackageManager.PackageInfoFlags.of(flags.toLong()),
        )
      } else {
        @Suppress("DEPRECATION")
        reactContext.packageManager.getPackageInfo(packageName, flags)
      }
    } catch (error: PackageManager.NameNotFoundException) {
      throw UpdaterException(
        "updater-installed-package-missing",
        "Installed LoggeRythm package could not be inspected",
        error,
      )
    }
  }

  private fun signerDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.signingInfo?.apkContentsSigners
    } else {
      @Suppress("DEPRECATION")
      info.signatures
    } ?: throw UpdaterException(
      "updater-signature-missing",
      "APK signing certificate is missing",
    )
    if (signatures.isEmpty()) {
      throw UpdaterException(
        "updater-signature-missing",
        "APK signing certificate is empty",
      )
    }
    return signatures.mapTo(linkedSetOf()) { signature ->
      MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHex()
    }
  }

  private fun longVersionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }

  private fun parseDigest(value: String): String {
    val match = SHA256_DIGEST.matchEntire(value.trim().lowercase())
      ?: throw UpdaterException(
        "updater-digest-invalid",
        "GitHub release asset has no valid SHA-256 digest",
      )
    return match.groupValues[1]
  }

  private fun normalizedVersion(value: String): String {
    val match = STABLE_VERSION.matchEntire(value.trim())
      ?: throw UpdaterException(
        "updater-version-invalid",
        "Update version must be a stable semantic version",
      )
    return "${match.groupValues[1]}.${match.groupValues[2]}.${match.groupValues[3]}"
  }

  private fun validateReleaseUrl(value: String, initial: Boolean): URI {
    val uri = try {
      URI(value)
    } catch (error: Exception) {
      throw UpdaterException("updater-url-invalid", "Update URL is invalid", error)
    }
    if (
      uri.scheme != "https" ||
      uri.userInfo != null ||
      uri.host == null ||
      uri.fragment != null
    ) {
      throw UpdaterException(
        "updater-url-invalid",
        "Update URL must be a credential-free HTTPS URL",
      )
    }
    val host = uri.host.lowercase()
    val allowedHost = host == GITHUB_HOST || host.endsWith(GITHUB_CONTENT_SUFFIX)
    if (!allowedHost) {
      throw UpdaterException(
        "updater-url-host-rejected",
        "Update URL is not hosted by GitHub",
      )
    }
    if (initial && (
        host != GITHUB_HOST ||
          !uri.path.startsWith(RELEASE_PATH_PREFIX) ||
          !uri.path.lowercase().endsWith(".apk")
        )) {
      throw UpdaterException(
        "updater-url-release-rejected",
        "Update URL is not a LoggeRythm GitHub release APK",
      )
    }
    return uri
  }

  companion object {
    const val NAME = "LoggeRythmUpdater"
    private const val GITHUB_HOST = "github.com"
    private const val GITHUB_CONTENT_SUFFIX = ".githubusercontent.com"
    private const val RELEASE_PATH_PREFIX = "/LoggeL/LoggeRythm/releases/download/"
    private const val MAX_REDIRECTS = 5
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val DOWNLOAD_BUFFER_BYTES = 64 * 1024
    private const val MAX_APK_BYTES = 300L * 1024L * 1024L
    private val SHA256_DIGEST = Regex("^sha256:([0-9a-f]{64})$")
    private val STABLE_VERSION = Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)$")
  }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
