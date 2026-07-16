const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SEND_ACTION = 'android.intent.action.SEND';
const GENERATED_ACTIVITY_MARKER = '// @generated withSharedTextIntent activity intake';
const GENERATED_APPLICATION_MARKER = '// @generated withSharedTextIntent package';

function transformMainActivity(source) {
  if (source.includes(GENERATED_ACTIVITY_MARKER)) return source;
  if (!source.includes('super.onCreate(null)')) {
    throw new Error('withSharedTextIntent: unsupported MainActivity onCreate');
  }
  let next = source;
  if (!next.includes('import android.content.Intent')) {
    next = next.replace('import android.os.Bundle', 'import android.content.Intent\nimport android.os.Bundle');
  }
  next = next.replace(
    'super.onCreate(null)',
    `super.onCreate(null)\n    ${GENERATED_ACTIVITY_MARKER}\n    SharedTextInbox.publishFromIntent(intent)`,
  );
  const anchor = '  /**\n   * Returns the name of the main component registered from JavaScript.';
  if (!next.includes(anchor)) {
    throw new Error('withSharedTextIntent: unsupported MainActivity body');
  }
  return next.replace(
    anchor,
    `  override fun onNewIntent(intent: Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n    SharedTextInbox.publishFromIntent(intent)\n  }\n\n${anchor}`,
  );
}

function transformMainApplication(source) {
  if (source.includes(GENERATED_APPLICATION_MARKER)) return source;
  const anchor = 'PackageList(this).packages.apply {';
  if (!source.includes(anchor)) {
    throw new Error('withSharedTextIntent: unsupported MainApplication package list');
  }
  return source.replace(
    anchor,
    `${anchor}\n          ${GENERATED_APPLICATION_MARKER}\n          add(SharedTextPackage())`,
  );
}

function kotlinSources(packageName) {
  return {
    inbox: `package ${packageName}

import android.content.Intent
import java.util.concurrent.CopyOnWriteArraySet

internal object SharedTextInbox {
  private const val MAX_TEXT_LENGTH = 8192
  private var pending: String? = null
  private val listeners = CopyOnWriteArraySet<(String) -> Unit>()

  fun publishFromIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) return
    val mimeType = intent.type ?: return
    if (mimeType != "text/plain" && !mimeType.startsWith("text/")) return
    val value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim() ?: return
    if (value.isEmpty() || value.length > MAX_TEXT_LENGTH) return
    val snapshot: List<(String) -> Unit>
    synchronized(this) {
      pending = value
      snapshot = listeners.toList()
    }
    snapshot.forEach { listener -> listener(value) }
  }

  fun subscribe(listener: (String) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun consume(): String? = synchronized(this) {
    val value = pending
    pending = null
    value
  }

  fun consume(expected: String): Boolean = synchronized(this) {
    if (pending != expected) return@synchronized false
    pending = null
    true
  }
}
`,
    module: `package ${packageName}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicInteger

internal class SharedTextIntentModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val listenerCount = AtomicInteger(0)
  private val unsubscribe = SharedTextInbox.subscribe { value ->
    // Keep the inbox value pending until JavaScript has installed its event
    // listener. The subsequent consumeSharedText call closes the cold-start
    // and listener-registration race without duplicate delivery.
    if (listenerCount.get() <= 0) return@subscribe
    if (!emit(value)) return@subscribe
    SharedTextInbox.consume(value)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun consumeSharedText(promise: Promise) {
    promise.resolve(SharedTextInbox.consume())
  }

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName == EVENT_NAME) listenerCount.incrementAndGet()
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    val removed = count.toInt().coerceAtLeast(0)
    listenerCount.updateAndGet { current -> (current - removed).coerceAtLeast(0) }
  }

  private fun emit(value: String): Boolean =
    runCatching {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, value)
    }.isSuccess

  override fun invalidate() {
    unsubscribe()
    super.invalidate()
  }

  companion object {
    const val NAME = "SharedTextIntent"
    private const val EVENT_NAME = "SharedTextReceived"
  }
}
`,
    package: `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

internal class SharedTextPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(SharedTextIntentModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
`,
  };
}

function ensureSendIntentFilter(activity) {
  activity['intent-filter'] = activity['intent-filter'] || [];
  const existing = activity['intent-filter'].some((filter) =>
    filter.action?.some((action) => action.$?.['android:name'] === SEND_ACTION),
  );
  if (!existing) {
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': SEND_ACTION } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }],
    });
  }
  return activity;
}

function configureManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const activity = app?.activity?.find((candidate) => candidate.$?.['android:name'] === '.MainActivity');
    if (!activity) throw new Error('withSharedTextIntent: .MainActivity not found');
    ensureSendIntentFilter(activity);
    return cfg;
  });
}

function writeNativeSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const packageName = cfg.android?.package;
      if (!packageName) throw new Error('withSharedTextIntent: android.package is required');
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );
      fs.mkdirSync(directory, { recursive: true });
      const sources = kotlinSources(packageName);
      fs.writeFileSync(path.join(directory, 'SharedTextInbox.kt'), sources.inbox);
      fs.writeFileSync(path.join(directory, 'SharedTextIntentModule.kt'), sources.module);
      fs.writeFileSync(path.join(directory, 'SharedTextPackage.kt'), sources.package);
      return cfg;
    },
  ]);
}

function withSharedTextIntent(config) {
  config = configureManifest(config);
  config = withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withSharedTextIntent: only Kotlin MainActivity is supported');
    }
    cfg.modResults.contents = transformMainActivity(cfg.modResults.contents);
    return cfg;
  });
  config = withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withSharedTextIntent: only Kotlin MainApplication is supported');
    }
    cfg.modResults.contents = transformMainApplication(cfg.modResults.contents);
    return cfg;
  });
  return writeNativeSources(config);
}

module.exports = withSharedTextIntent;
module.exports.transformMainActivity = transformMainActivity;
module.exports.transformMainApplication = transformMainApplication;
module.exports.kotlinSources = kotlinSources;
module.exports.ensureSendIntentFilter = ensureSendIntentFilter;
