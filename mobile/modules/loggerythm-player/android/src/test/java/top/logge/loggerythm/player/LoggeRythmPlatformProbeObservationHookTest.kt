package top.logge.loggerythm.player

import androidx.media3.session.MediaSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPlatformProbeObservationHookTest {
  @Test
  fun uncorrelatedRawBindCannotSatisfyArmedRequest() {
    val requestId = "expected-request"
    LoggeRythmPlatformProbeObservationHook.arm(requestId)
    try {
      assertFalse(
        LoggeRythmPlatformProbeObservationHook.beginRawBind(
          action = LoggeRythmPlatformProbeObservationHook.PLATFORM_BROWSER_SERVICE_ACTION,
          suppliedRequestId = "foreign-request",
        ),
      )

      val observation = requireNotNull(LoggeRythmPlatformProbeObservationHook.drain(requestId))
      assertEquals(LoggeRythmPlatformProbePhase.ARMED, observation.phase)
      assertEquals(0, observation.matchedRawBindCount)
      assertEquals(1, observation.uncorrelatedRawBindCount)
      assertEquals(0, observation.lookupCount)
      assertNull(observation.matchedController)
    } finally {
      LoggeRythmPlatformProbeObservationHook.drain(requestId)
    }
  }

  @Test
  fun exactRequestIdAndDeniedLookupRequireNullBinderForProof() {
    val requestId = "expected-request"
    LoggeRythmPlatformProbeObservationHook.arm(requestId)
    try {
      val tracked = LoggeRythmPlatformProbeObservationHook.beginRawBind(
        action = LoggeRythmPlatformProbeObservationHook.PLATFORM_BROWSER_SERVICE_ACTION,
        suppliedRequestId = requestId,
      )
      assertTrue(tracked)
      LoggeRythmPlatformProbeObservationHook.recordLookup(deniedLegacyController())
      LoggeRythmPlatformProbeObservationHook.completeRawBind(
        tracked = tracked,
        binderReturned = false,
      )

      val observation = requireNotNull(LoggeRythmPlatformProbeObservationHook.drain(requestId))
      assertEquals(LoggeRythmPlatformProbePhase.NULL_BIND_CONFIRMED, observation.phase)
      assertEquals(1, observation.matchedRawBindCount)
      assertEquals(0, observation.uncorrelatedRawBindCount)
      assertEquals(1, observation.lookupCount)
      assertEquals(deniedLegacyController(), observation.matchedController)
    } finally {
      LoggeRythmPlatformProbeObservationHook.drain(requestId)
    }
  }

  @Test
  fun liveBinderCannotBeClassifiedAsDeniedRawBind() {
    val requestId = "live-binder-request"
    LoggeRythmPlatformProbeObservationHook.arm(requestId)
    try {
      val tracked = LoggeRythmPlatformProbeObservationHook.beginRawBind(
        action = LoggeRythmPlatformProbeObservationHook.PLATFORM_BROWSER_SERVICE_ACTION,
        suppliedRequestId = requestId,
      )
      LoggeRythmPlatformProbeObservationHook.recordLookup(deniedLegacyController())
      LoggeRythmPlatformProbeObservationHook.completeRawBind(
        tracked = tracked,
        binderReturned = true,
      )

      val observation = requireNotNull(LoggeRythmPlatformProbeObservationHook.drain(requestId))
      assertEquals(LoggeRythmPlatformProbePhase.LIVE_BINDER_RETURNED, observation.phase)
    } finally {
      LoggeRythmPlatformProbeObservationHook.drain(requestId)
    }
  }

  private fun deniedLegacyController() = LoggeRythmPlatformProbeControllerObservation(
    uid = -1,
    packageName = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME,
    controllerVersion = MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION,
    trusted = false,
    allowed = false,
  )
}
