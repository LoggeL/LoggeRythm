package top.logge.loggerythm.player.hostilecontroller;

import android.app.Service;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser.MediaItem;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;
import android.os.RemoteException;
import androidx.annotation.Nullable;
import androidx.media3.common.Player;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaBrowser;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Deliberately unprivileged test-only process that probes the production Media3 Binder boundary.
 * The instrumentation APK talks to this service only to start the probe and retrieve booleans;
 * every media call originates in this APK's separate Linux UID.
 */
public final class HostileControllerProbeService extends Service {
  public static final String DESCRIPTOR =
      "top.logge.loggerythm.player.hostilecontroller.IHostileControllerProbe";
  public static final int TRANSACTION_RUN_PROBE = IBinder.FIRST_CALL_TRANSACTION;

  private static final int PROBE_SCHEMA_VERSION = 6;
  private static final String PLATFORM_BROWSER_SERVICE_ACTION =
      "android.media.browse.MediaBrowserService";
  private static final String PLATFORM_PROBE_NONCE_KEY =
      "top.logge.loggerythm.player.test.PLATFORM_PROBE_NONCE";
  private static final long TIMEOUT_SECONDS = 10L;

  private final Binder binder = new Binder() {
    @Override
    protected boolean onTransact(int code, Parcel data, Parcel reply, int flags)
        throws RemoteException {
      if (code == INTERFACE_TRANSACTION) {
        reply.writeString(DESCRIPTOR);
        return true;
      }
      if (code != TRANSACTION_RUN_PROBE) return super.onTransact(code, data, reply, flags);
      data.enforceInterface(DESCRIPTOR);
      String targetPackage = requireString(data.readString(), "target-package-missing");
      String targetService = requireString(data.readString(), "target-service-missing");
      String privateMediaId = requireString(data.readString(), "private-media-id-missing");
      String attackMediaId = requireString(data.readString(), "attack-media-id-missing");
      String platformProbeNonce = requireString(data.readString(), "platform-probe-nonce-missing");

      // Never let the same-UID instrumentation caller's inbound Binder identity leak into a
      // nested package-manager/service operation. The actual probe must be attributed only to
      // this helper APK's separate Linux UID.
      long callingIdentity = Binder.clearCallingIdentity();
      try {
        Bundle result = runProbe(
            targetPackage,
            targetService,
            privateMediaId,
            attackMediaId,
            platformProbeNonce);
        reply.writeNoException();
        reply.writeBundle(result);
      } finally {
        Binder.restoreCallingIdentity(callingIdentity);
      }
      return true;
    }
  };

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return binder;
  }

  private Bundle runProbe(
      String targetPackage,
      String targetService,
      String privateMediaId,
      String attackMediaId,
      String platformProbeNonce) {
    Bundle result = initialResult(targetPackage, platformProbeNonce);
    ComponentName target = new ComponentName(targetPackage, targetService);
    try {
      PackageManager packageManager = getPackageManager();
      ApplicationInfo applicationInfo = packageManager.getApplicationInfo(targetPackage, 0);
      ServiceInfo serviceInfo = packageManager.getServiceInfo(target, 0);
      result.putInt("targetUid", applicationInfo.uid);
      result.putBoolean("targetServiceResolved", serviceInfo.exported && serviceInfo.enabled);
      result.putBoolean(
          "targetServicePermissionEmpty",
          serviceInfo.permission == null || serviceInfo.permission.isEmpty());
      result.putBoolean("separateUid", applicationInfo.uid != Process.myUid());
      result.putBoolean("separatePackage", !targetPackage.equals(getPackageName()));
      result.putBoolean(
          "mediaControlPermissionGranted",
          packageManager.checkPermission(
              "android.permission.MEDIA_CONTENT_CONTROL", getPackageName())
              == PackageManager.PERMISSION_GRANTED);
      result.putBoolean("platformTrusted", isPlatformTrusted());
    } catch (Exception error) {
      result.putString("preflightFailureClass", error.getClass().getName());
      return result;
    }

    HandlerThread controllerThread = new HandlerThread("HostileControllerProbe");
    controllerThread.start();
    try {
      runMedia3Probe(
          result,
          target,
          privateMediaId,
          attackMediaId,
          controllerThread);
      runPlatformBrowserProbe(
          result,
          target,
          privateMediaId,
          attackMediaId,
          platformProbeNonce,
          controllerThread);
      result.putBoolean("probeCompleted", true);
    } finally {
      controllerThread.quitSafely();
      try {
        controllerThread.join(TimeUnit.SECONDS.toMillis(TIMEOUT_SECONDS));
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
      result.putBoolean("probeThreadTerminated", !controllerThread.isAlive());
    }
    return result;
  }

  private Bundle initialResult(String targetPackage, String platformProbeRequestId) {
    Bundle result = new Bundle();
    result.putInt("probeSchemaVersion", PROBE_SCHEMA_VERSION);
    result.putBoolean("probeCompleted", false);
    result.putBoolean("probeThreadTerminated", false);
    result.putString("probePackage", getPackageName());
    result.putInt("probeUid", Process.myUid());
    result.putInt("probePid", Process.myPid());
    result.putBoolean("probeOwnBinderIdentity", Binder.getCallingUid() == Process.myUid());
    result.putString("platformProbeRequestId", platformProbeRequestId);
    result.putString("targetPackage", targetPackage);
    result.putInt("targetUid", -1);
    result.putBoolean("targetServiceResolved", false);
    result.putBoolean("targetServicePermissionEmpty", false);
    result.putBoolean("separateUid", false);
    result.putBoolean("separatePackage", false);
    result.putBoolean("mediaControlPermissionGranted", false);
    result.putBoolean("platformTrusted", false);
    result.putString("preflightFailureClass", "");

    result.putBoolean("connectionAttempted", false);
    result.putBoolean("sessionAcquired", false);
    result.putBoolean("rootAccessible", false);
    result.putBoolean("privateItemAccessible", false);
    result.putBoolean("privateMarkerObserved", false);
    result.putInt("sessionCommandCount", 0);
    result.putInt("playerCommandCount", 0);
    result.putBoolean("mutationCallsIssued", false);
    result.putBoolean("timedOut", false);
    result.putString("connectionOutcome", "NOT_RUN");
    result.putString("connectionFailureClass", "");
    result.putBoolean("media3SessionRejectionSignal", false);

    result.putBoolean("legacyConnectionAttempted", false);
    result.putBoolean("legacyConnectDispatchCompleted", false);
    result.putString("legacyProbePhase", "NOT_STARTED");
    result.putBoolean("legacyServiceBindAttempted", false);
    result.putBoolean("legacyServiceBindAccepted", false);
    result.putBoolean("legacyServiceBinderReached", false);
    result.putBoolean("legacyServiceBinderAlive", false);
    result.putBoolean("legacyServiceComponentMatched", false);
    result.putBoolean("legacyServiceNullBindingCallback", false);
    result.putInt("legacyServiceBindCallbackCount", 0);
    result.putBoolean("legacyServiceBindTimedOut", false);
    result.putBoolean("legacyRawBindReleasedBeforeBrowser", false);
    result.putBoolean("legacyConnectedCallback", false);
    result.putBoolean("legacyConnectionFailedCallback", false);
    result.putBoolean("legacyConnectionSuspendedCallback", false);
    result.putInt("legacyCallbackCount", 0);
    result.putLong(
        "legacyObservationWindowMs",
        TimeUnit.SECONDS.toMillis(TIMEOUT_SECONDS));
    result.putLong("legacyObservedDurationMs", 0L);
    result.putBoolean("legacyObservationWindowCompleted", false);
    result.putBoolean("legacyTimedOut", false);
    result.putString("legacyConnectionOutcome", "NOT_RUN");
    result.putString("legacyFailureClass", "");
    result.putBoolean("legacyRootAccessible", false);
    result.putBoolean("legacySessionTokenAccessible", false);
    result.putBoolean("legacyPrivateItemAccessible", false);
    result.putBoolean("legacyPrivateItemProbeCompleted", false);
    result.putBoolean("legacyPrivateMarkerObserved", false);
    result.putBoolean("legacyQueueAccessible", false);
    result.putBoolean("legacyMetadataAccessible", false);
    result.putLong("legacyPlaybackActions", 0L);
    result.putInt("legacyCustomActionCount", 0);
    result.putBoolean("legacyMutationCallsIssued", false);
    return result;
  }

  private void runMedia3Probe(
      Bundle result,
      ComponentName target,
      String privateMediaId,
      String attackMediaId,
      HandlerThread controllerThread) {
    result.putBoolean("connectionAttempted", true);
    MediaBrowser browser = null;
    ListenableFuture<MediaBrowser> browserFuture = null;
    try {
      SessionToken token = new SessionToken(this, target);
      browserFuture = new MediaBrowser.Builder(this, token)
          .setApplicationLooper(controllerThread.getLooper())
          .buildAsync();
      browser = browserFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
      result.putBoolean("sessionAcquired", browser.isConnected());
      result.putString("connectionOutcome", "ACCEPTED");
      result.putInt("sessionCommandCount", browser.getAvailableSessionCommands().commands.size());
      result.putInt("playerCommandCount", browser.getAvailableCommands().size());

      final MediaBrowser connectedBrowser = browser;
      ListenableFuture<LibraryResult<androidx.media3.common.MediaItem>> rootFuture = onLooper(
          new Handler(controllerThread.getLooper()),
          () -> connectedBrowser.getLibraryRoot(null));
      LibraryResult<androidx.media3.common.MediaItem> root =
          rootFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
      androidx.media3.common.MediaItem rootItem = root.value;
      result.putBoolean("rootAccessible", rootItem != null);
      if (rootItem != null) {
        result.putBoolean("privateMarkerObserved", privateMediaId.equals(rootItem.mediaId));
      }

      ListenableFuture<LibraryResult<androidx.media3.common.MediaItem>> itemFuture = onLooper(
          new Handler(controllerThread.getLooper()),
          () -> connectedBrowser.getItem(privateMediaId));
      LibraryResult<androidx.media3.common.MediaItem> item =
          itemFuture.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
      result.putBoolean("privateItemAccessible", item.value != null);
      if (item.value != null) result.putBoolean("privateMarkerObserved", true);

      // Set before the first call so a partial sequence can never be reported as "not issued".
      result.putBoolean("mutationCallsIssued", true);
      onLooper(new Handler(controllerThread.getLooper()), () -> {
        connectedBrowser.setMediaItem(
            new androidx.media3.common.MediaItem.Builder()
                .setMediaId(attackMediaId)
                .setUri("https://attacker.invalid/not-a-real-track")
                .build());
        connectedBrowser.seekTo(999_999L);
        connectedBrowser.setRepeatMode(Player.REPEAT_MODE_ALL);
        connectedBrowser.play();
        connectedBrowser.clearMediaItems();
        return null;
      });
    } catch (TimeoutException error) {
      result.putBoolean("timedOut", true);
      result.putString("connectionOutcome", "TIMEOUT");
    } catch (ExecutionException error) {
      Throwable cause = rootCause(error);
      boolean rejectedBySession = isMedia3SessionRejection(cause);
      result.putString("connectionFailureClass", cause.getClass().getName());
      result.putBoolean("media3SessionRejectionSignal", rejectedBySession);
      result.putString("connectionOutcome", rejectedBySession ? "REJECTED_BY_SESSION" : "FAILED");
    } catch (Exception error) {
      Throwable cause = rootCause(error);
      result.putString("connectionFailureClass", cause.getClass().getName());
      result.putString("connectionOutcome", "FAILED");
    } finally {
      if (browser != null) {
        final MediaBrowser browserToRelease = browser;
        try {
          onLooper(new Handler(controllerThread.getLooper()), () -> {
            browserToRelease.release();
            return null;
          });
        } catch (Exception ignored) {
          // Test result already captures the security outcome; cleanup stays best-effort.
        }
      } else if (browserFuture != null) {
        androidx.media3.session.MediaController.releaseFuture(browserFuture);
      }
    }
  }

  private void runPlatformBrowserProbe(
      Bundle result,
      ComponentName target,
      String privateMediaId,
      String attackMediaId,
      String platformProbeNonce,
      HandlerThread controllerThread) {
    Handler handler = new Handler(controllerThread.getLooper());
    CountDownLatch serviceBindComplete = new CountDownLatch(1);
    AtomicReference<IBinder> serviceBinderReference = new AtomicReference<>();
    AtomicReference<ComponentName> serviceComponentReference = new AtomicReference<>();
    AtomicBoolean serviceBindObservationOpen = new AtomicBoolean(true);
    Object serviceBindCallbackGuard = new Object();
    CountDownLatch connectionComplete = new CountDownLatch(1);
    AtomicReference<android.media.browse.MediaBrowser> browserReference = new AtomicReference<>();
    AtomicBoolean observationOpen = new AtomicBoolean(true);
    Object callbackGuard = new Object();
    ServiceConnection serviceConnection = new ServiceConnection() {
      @Override
      public void onServiceConnected(ComponentName name, IBinder service) {
        synchronized (serviceBindCallbackGuard) {
          if (!serviceBindObservationOpen.get()) return;
          serviceComponentReference.set(name);
          serviceBinderReference.set(service);
          result.putInt(
              "legacyServiceBindCallbackCount",
              result.getInt("legacyServiceBindCallbackCount") + 1);
          serviceBindObservationOpen.set(false);
          serviceBindComplete.countDown();
        }
      }

      @Override
      public void onNullBinding(ComponentName name) {
        synchronized (serviceBindCallbackGuard) {
          if (!serviceBindObservationOpen.get()) return;
          serviceComponentReference.set(name);
          result.putBoolean("legacyServiceNullBindingCallback", true);
          result.putInt(
              "legacyServiceBindCallbackCount",
              result.getInt("legacyServiceBindCallbackCount") + 1);
          serviceBindObservationOpen.set(false);
          serviceBindComplete.countDown();
        }
      }

      @Override
      public void onServiceDisconnected(ComponentName name) {
        serviceBinderReference.set(null);
      }
    };
    boolean serviceBound = false;

    try {
      result.putString("legacyProbePhase", "RAW_BIND_STARTED");
      result.putBoolean("legacyServiceBindAttempted", true);
      serviceBound = bindService(
          new Intent(PLATFORM_BROWSER_SERVICE_ACTION)
              .setComponent(target)
              .putExtra(PLATFORM_PROBE_NONCE_KEY, platformProbeNonce),
          serviceConnection,
          BIND_AUTO_CREATE);
      result.putBoolean("legacyServiceBindAccepted", serviceBound);
      if (!serviceBound) {
        synchronized (serviceBindCallbackGuard) {
          serviceBindObservationOpen.set(false);
        }
        result.putString("legacyProbePhase", "RAW_BIND_REJECTED");
        result.putString("legacyConnectionOutcome", "PLATFORM_SERVICE_BIND_REJECTED");
        return;
      }
      boolean bindCallbackObserved = serviceBindComplete.await(TIMEOUT_SECONDS, TimeUnit.SECONDS);
      if (!bindCallbackObserved) {
        synchronized (serviceBindCallbackGuard) {
          // Resolve the timeout/callback boundary under the same guard used by both callbacks.
          if (serviceBindComplete.getCount() != 0L) {
            serviceBindObservationOpen.set(false);
            result.putBoolean("legacyServiceBindTimedOut", true);
            result.putString("legacyProbePhase", "RAW_BIND_TIMEOUT");
            result.putString("legacyConnectionOutcome", "PLATFORM_SERVICE_BIND_TIMEOUT");
            return;
          }
        }
      }
      synchronized (serviceBindCallbackGuard) {
        serviceBindObservationOpen.set(false);
      }
      result.putString("legacyProbePhase", "RAW_BIND_OBSERVED");
      IBinder serviceBinder = serviceBinderReference.get();
      result.putBoolean("legacyServiceBinderReached", serviceBinder != null);
      result.putBoolean(
          "legacyServiceBinderAlive",
          serviceBinder != null && serviceBinder.isBinderAlive());
      result.putBoolean(
          "legacyServiceComponentMatched",
          target.equals(serviceComponentReference.get()));
      unbindService(serviceConnection);
      serviceBound = false;
      result.putBoolean("legacyRawBindReleasedBeforeBrowser", true);
      result.putBoolean("legacyConnectionAttempted", true);
      Bundle rootHints = new Bundle();
      rootHints.putString(PLATFORM_PROBE_NONCE_KEY, platformProbeNonce);
      long observationStartedNanos = System.nanoTime();
      result.putString("legacyProbePhase", "CONNECT_DISPATCHING");
      onLooper(handler, () -> {
        android.media.browse.MediaBrowser browser = new android.media.browse.MediaBrowser(
            this,
            target,
            new android.media.browse.MediaBrowser.ConnectionCallback() {
              @Override
              public void onConnected() {
                synchronized (callbackGuard) {
                  if (!observationOpen.get()) return;
                  result.putBoolean("legacyConnectedCallback", true);
                  result.putInt("legacyCallbackCount", result.getInt("legacyCallbackCount") + 1);
                  result.putString("legacyConnectionOutcome", "ACCEPTED");
                  observationOpen.set(false);
                  connectionComplete.countDown();
                }
              }

              @Override
              public void onConnectionFailed() {
                synchronized (callbackGuard) {
                  if (!observationOpen.get()) return;
                  result.putBoolean("legacyConnectionFailedCallback", true);
                  result.putInt("legacyCallbackCount", result.getInt("legacyCallbackCount") + 1);
                  result.putString("legacyConnectionOutcome", "REJECTED_BY_BROWSER_CALLBACK");
                  observationOpen.set(false);
                  connectionComplete.countDown();
                }
              }

              @Override
              public void onConnectionSuspended() {
                synchronized (callbackGuard) {
                  if (!observationOpen.get()) return;
                  result.putBoolean("legacyConnectionSuspendedCallback", true);
                  result.putInt("legacyCallbackCount", result.getInt("legacyCallbackCount") + 1);
                  result.putString("legacyConnectionOutcome", "SUSPENDED");
                  observationOpen.set(false);
                  connectionComplete.countDown();
                }
              }
            },
            rootHints);
        browserReference.set(browser);
        browser.connect();
        return null;
      });
      result.putBoolean("legacyConnectDispatchCompleted", true);
      result.putString("legacyProbePhase", "CONNECT_DISPATCHED");

      boolean callbackObserved = connectionComplete.await(TIMEOUT_SECONDS, TimeUnit.SECONDS);
      result.putLong(
          "legacyObservedDurationMs",
          TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - observationStartedNanos));
      if (!callbackObserved) {
        synchronized (callbackGuard) {
          // Resolve the timeout/callback boundary atomically. A callback that acquired the guard
          // first is evidence and wins; callbacks posted after a completed observation window are
          // intentionally ignored so the returned Bundle cannot mutate after the probe returns.
          if (connectionComplete.getCount() != 0L) {
            observationOpen.set(false);
            result.putBoolean("legacyObservationWindowCompleted", true);
            result.putBoolean("legacyTimedOut", true);
            result.putString("legacyProbePhase", "SILENT_WINDOW_COMPLETED");
            result.putString(
                "legacyConnectionOutcome",
                "NO_CALLBACK_WITHIN_OBSERVATION_WINDOW");
            return;
          }
        }
      }
      synchronized (callbackGuard) {
        observationOpen.set(false);
      }
      result.putString("legacyProbePhase", "CALLBACK_OBSERVED");

      android.media.browse.MediaBrowser browser = browserReference.get();
      if (browser == null || !browser.isConnected()) return;
      inspectAcceptedPlatformBrowser(
          result,
          browser,
          privateMediaId,
          attackMediaId,
          handler);
    } catch (Exception error) {
      Throwable cause = rootCause(error);
      result.putString("legacyFailureClass", cause.getClass().getName());
      result.putString("legacyProbePhase", "FAILED");
      result.putString("legacyConnectionOutcome", "FAILED");
    } finally {
      synchronized (serviceBindCallbackGuard) {
        serviceBindObservationOpen.set(false);
      }
      synchronized (callbackGuard) {
        observationOpen.set(false);
      }
      android.media.browse.MediaBrowser browser = browserReference.get();
      if (browser != null) {
        try {
          onLooper(handler, () -> {
            browser.disconnect();
            return null;
          });
        } catch (Exception ignored) {
          // The observable denial result is already complete.
        }
      }
      IBinder serviceBinder = serviceBinderReference.get();
      result.putBoolean(
          "legacyServiceBinderAlive",
          serviceBinder != null && serviceBinder.isBinderAlive());
      if (serviceBound) {
        try {
          unbindService(serviceConnection);
        } catch (IllegalArgumentException ignored) {
          // The target process died after a successful bind; liveness above captures that state.
        }
      }
    }
  }

  private void inspectAcceptedPlatformBrowser(
      Bundle result,
      android.media.browse.MediaBrowser browser,
      String privateMediaId,
      String attackMediaId,
      Handler handler) throws Exception {
    String root = onLooper(handler, browser::getRoot);
    result.putBoolean("legacyRootAccessible", root != null);
    if (privateMediaId.equals(root)) result.putBoolean("legacyPrivateMarkerObserved", true);

    android.media.session.MediaSession.Token token = onLooper(handler, browser::getSessionToken);
    result.putBoolean("legacySessionTokenAccessible", token != null);

    CountDownLatch itemComplete = new CountDownLatch(1);
    AtomicBoolean itemObservationOpen = new AtomicBoolean(true);
    Object itemCallbackGuard = new Object();
    onLooper(handler, () -> {
      browser.getItem(privateMediaId, new android.media.browse.MediaBrowser.ItemCallback() {
        @Override
        public void onItemLoaded(@Nullable MediaItem item) {
          synchronized (itemCallbackGuard) {
            if (!itemObservationOpen.get()) return;
            result.putBoolean("legacyPrivateItemProbeCompleted", true);
            result.putBoolean("legacyPrivateItemAccessible", item != null);
            if (item != null) result.putBoolean("legacyPrivateMarkerObserved", true);
            itemObservationOpen.set(false);
            itemComplete.countDown();
          }
        }

        @Override
        public void onError(String mediaId) {
          synchronized (itemCallbackGuard) {
            if (!itemObservationOpen.get()) return;
            result.putBoolean("legacyPrivateItemProbeCompleted", true);
            itemObservationOpen.set(false);
            itemComplete.countDown();
          }
        }
      });
      return null;
    });
    if (!itemComplete.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      synchronized (itemCallbackGuard) {
        if (itemComplete.getCount() != 0L) {
          itemObservationOpen.set(false);
          result.putBoolean("legacyTimedOut", true);
          result.putString("legacyConnectionOutcome", "ITEM_TIMEOUT");
          return;
        }
      }
    }
    synchronized (itemCallbackGuard) {
      itemObservationOpen.set(false);
    }

    if (token == null) return;
    onLooper(handler, () -> {
      MediaController controller = new MediaController(this, token);
      PlaybackState playbackState = controller.getPlaybackState();
      if (playbackState != null) {
        result.putLong("legacyPlaybackActions", playbackState.getActions());
        result.putInt("legacyCustomActionCount", playbackState.getCustomActions().size());
      }

      List<android.media.session.MediaSession.QueueItem> queue = controller.getQueue();
      result.putBoolean("legacyQueueAccessible", queue != null && !queue.isEmpty());
      if (queue != null) {
        for (android.media.session.MediaSession.QueueItem queueItem : queue) {
          MediaDescription description = queueItem.getDescription();
          if (description != null && privateMediaId.equals(description.getMediaId())) {
            result.putBoolean("legacyPrivateMarkerObserved", true);
          }
        }
      }

      MediaMetadata metadata = controller.getMetadata();
      result.putBoolean("legacyMetadataAccessible", metadata != null);
      if (
          metadata != null &&
          privateMediaId.equals(metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_ID))) {
        result.putBoolean("legacyPrivateMarkerObserved", true);
      }

      result.putBoolean("legacyMutationCallsIssued", true);
      MediaController.TransportControls controls = controller.getTransportControls();
      controls.playFromMediaId(attackMediaId, null);
      controls.seekTo(999_999L);
      controls.play();
      controls.skipToNext();
      controls.stop();
      return null;
    });
  }

  private boolean isPlatformTrusted() {
    if (Build.VERSION.SDK_INT < 28) return false;
    MediaSessionManager manager = getSystemService(MediaSessionManager.class);
    MediaSessionManager.RemoteUserInfo self = new MediaSessionManager.RemoteUserInfo(
        getPackageName(), Process.myPid(), Process.myUid());
    return manager != null && manager.isTrustedForMediaControl(self);
  }

  private static boolean isMedia3SessionRejection(Throwable cause) {
    // MediaController.Builder.buildAsync() exposes a rejected session as SecurityException. The
    // instrumentation preflight separately proves that the exported target has no bind permission,
    // so this cannot be a manifest-level permission denial. Do not depend on Media3 internals or
    // stack-frame names, which are not API and may change between pinned upgrades.
    return cause instanceof SecurityException;
  }

  private static <T> T onLooper(Handler handler, Callable<T> callable) throws Exception {
    AtomicReference<T> value = new AtomicReference<>();
    AtomicReference<Throwable> failure = new AtomicReference<>();
    CountDownLatch complete = new CountDownLatch(1);
    handler.post(() -> {
      try {
        value.set(callable.call());
      } catch (Throwable error) {
        failure.set(error);
      } finally {
        complete.countDown();
      }
    });
    if (!complete.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) throw new TimeoutException();
    Throwable error = failure.get();
    if (error instanceof Exception) throw (Exception) error;
    if (error != null) throw new AssertionError(error);
    return value.get();
  }

  private static Throwable rootCause(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null && current.getCause() != current) {
      current = current.getCause();
    }
    return current;
  }

  private static String requireString(String value, String error) {
    if (value == null || value.isEmpty()) throw new IllegalArgumentException(error);
    return value;
  }
}
