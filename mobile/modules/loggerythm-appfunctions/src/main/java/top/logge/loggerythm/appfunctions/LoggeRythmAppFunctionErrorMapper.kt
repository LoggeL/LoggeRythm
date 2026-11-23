package top.logge.loggerythm.appfunctions

import androidx.appfunctions.AppFunctionAppUnknownException
import androidx.appfunctions.AppFunctionDisabledException
import androidx.appfunctions.AppFunctionElementNotFoundException
import androidx.appfunctions.AppFunctionException
import androidx.appfunctions.AppFunctionInvalidArgumentException
import androidx.appfunctions.AppFunctionPermissionRequiredException
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutionException
import kotlinx.coroutines.CancellationException
import top.logge.loggerythm.player.LoggeRythmVoiceErrorCode
import top.logge.loggerythm.player.LoggeRythmVoiceException

/**
 * Maps failures from [top.logge.loggerythm.player.LoggeRythmVoiceCommandExecutor] into typed
 * Jetpack [AppFunctionException] subclasses without swallowing errors or returning placeholders.
 */
internal object LoggeRythmAppFunctionErrorMapper {

    fun unwrap(error: Throwable): Throwable {
        var current: Throwable = error
        while (
            (current is CompletionException || current is ExecutionException) &&
            current.cause != null &&
            current.cause !== current
        ) {
            current = current.cause!!
        }
        return current
    }

    fun toAppFunctionException(operation: String, error: Throwable): AppFunctionException {
        val unwrapped = unwrap(error)
        if (unwrapped is CancellationException) {
            throw unwrapped
        }
        if (unwrapped is AppFunctionException) {
            return unwrapped
        }
        if (unwrapped is LoggeRythmVoiceException) {
            val detail = unwrapped.message?.trim().takeUnless { it.isNullOrEmpty() }
                ?: "Voice bridge error (${unwrapped.code.name})"
            val message = "$operation failed [${unwrapped.code.name}]: $detail"
            return when (unwrapped.code) {
                LoggeRythmVoiceErrorCode.AUTH_REQUIRED ->
                    AppFunctionPermissionRequiredException(message)

                LoggeRythmVoiceErrorCode.INVALID_ARGUMENT ->
                    AppFunctionInvalidArgumentException(message)

                LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
                LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY,
                LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK ->
                    AppFunctionElementNotFoundException(message)

                LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
                LoggeRythmVoiceErrorCode.NOT_READY,
                LoggeRythmVoiceErrorCode.CONTROLS_NOT_READY,
                LoggeRythmVoiceErrorCode.QUEUE_UNAVAILABLE,
                LoggeRythmVoiceErrorCode.FAVORITE_UNAVAILABLE ->
                    AppFunctionDisabledException(message)

                LoggeRythmVoiceErrorCode.BUSY,
                LoggeRythmVoiceErrorCode.NETWORK_ERROR,
                LoggeRythmVoiceErrorCode.FAVORITE_UPDATE_FAILED ->
                    AppFunctionAppUnknownException(message)
            }
        }
        if (unwrapped is IllegalArgumentException) {
            val detail = unwrapped.message?.trim().takeUnless { it.isNullOrEmpty() }
                ?: "Invalid argument"
            return AppFunctionInvalidArgumentException("$operation failed: $detail")
        }
        val detail = unwrapped.message?.trim().takeUnless { it.isNullOrEmpty() }
            ?: "No error detail provided"
        return AppFunctionAppUnknownException(
            "$operation failed (${unwrapped::class.java.simpleName}): $detail",
        )
    }
}
