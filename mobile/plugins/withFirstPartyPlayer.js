const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
  withSettingsGradle,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const AUTOMOTIVE_META_NAME = 'com.google.android.gms.car.application';
const ATTRIBUTION_ICON_META_NAME = 'androidx.car.app.TintableAttributionIcon';
const WEB_LINK_HOST = 'loggerythm.logge.top';
const PHONE_MEDIA_SEARCH_ACTION = 'android.media.action.MEDIA_PLAY_FROM_SEARCH';
const GENERATED_MEDIA_SEARCH_ACTIVITY_MARKER =
  '// @generated withFirstPartyPlayer media-play-from-search intake';
const GENERATED_MEDIA_SEARCH_APPLICATION_MARKER =
  '// @generated withFirstPartyPlayer media-play-from-search package';
const PLAYER_SERVICE_NAME = 'top.logge.loggerythm.player.LoggeRythmMediaLibraryService';
const PLAYBACK_EVENT_HEADLESS_SERVICE_NAME =
  'top.logge.loggerythm.player.LoggeRythmPlaybackEventHeadlessService';
const MEDIA3_LIBRARY_SERVICE_ACTION = 'androidx.media3.session.MediaLibraryService';
const MEDIA_BROWSER_SERVICE_ACTION = 'android.media.browse.MediaBrowserService';
const HOSTILE_CONTROLLER_TEST_PROJECT = ':loggerythm_player-hostile-controller';
const HOSTILE_CONTROLLER_TEST_DIRECTORY =
  '../modules/loggerythm-player/android-test-controller';
const WEB_LINK_PATHS = [
  { 'android:path': '/' },
  ...['register', 'album', 'artist', 'playlist', 'genre', 'account', 'search', 'radio', 'library', 'party']
    .map((value) => ({ 'android:pathPrefix': `/${value}` })),
];

const AUTOMOTIVE_DESC = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
`;

function upsertMetadata(application, name, resource) {
  application['meta-data'] = application['meta-data'] || [];
  let entry = application['meta-data'].find((item) => item.$?.['android:name'] === name);
  if (!entry) {
    entry = { $: { 'android:name': name } };
    application['meta-data'].push(entry);
  }
  entry.$['android:resource'] = resource;
}

function upsertPlayerService(application) {
  application.service = application.service || [];
  let service = application.service.find(
    (candidate) => candidate.$?.['android:name'] === PLAYER_SERVICE_NAME,
  );
  if (!service) {
    service = { $: { 'android:name': PLAYER_SERVICE_NAME } };
    application.service.push(service);
  }
  service.$ = {
    ...(service.$ || {}),
    'android:name': PLAYER_SERVICE_NAME,
    'android:exported': 'true',
    'android:foregroundServiceType': 'mediaPlayback',
    'android:stopWithTask': 'false',
    'tools:ignore': 'ExportedService',
  };
  service['intent-filter'] = service['intent-filter'] || [];
  let browserFilter = service['intent-filter'].find((filter) =>
    filter.action?.some((action) => [
      MEDIA3_LIBRARY_SERVICE_ACTION,
      MEDIA_BROWSER_SERVICE_ACTION,
    ].includes(action.$?.['android:name'])));
  if (!browserFilter) {
    browserFilter = { action: [] };
    service['intent-filter'].push(browserFilter);
  }
  browserFilter.action = browserFilter.action || [];
  for (const actionName of [MEDIA3_LIBRARY_SERVICE_ACTION, MEDIA_BROWSER_SERVICE_ACTION]) {
    if (!browserFilter.action.some((action) => action.$?.['android:name'] === actionName)) {
      browserFilter.action.push({ $: { 'android:name': actionName } });
    }
  }
}

function upsertPlaybackEventHeadlessService(application) {
  application.service = application.service || [];
  let service = application.service.find(
    (candidate) => candidate.$?.['android:name'] === PLAYBACK_EVENT_HEADLESS_SERVICE_NAME,
  );
  if (!service) {
    service = { $: {} };
    application.service.push(service);
  }
  service.$ = {
    'android:name': PLAYBACK_EVENT_HEADLESS_SERVICE_NAME,
    'android:exported': 'false',
  };
  for (const key of Object.keys(service)) {
    if (key !== '$') delete service[key];
  }
}

function ensureMediaPlayFromSearchIntentFilter(activity) {
  activity['intent-filter'] = activity['intent-filter'] || [];
  let mediaSearch = null;
  activity['intent-filter'] = activity['intent-filter'].filter((filter) => {
    const isMediaSearch = filter.action?.some(
      (action) => action.$?.['android:name'] === PHONE_MEDIA_SEARCH_ACTION,
    );
    if (!isMediaSearch) return true;
    if (mediaSearch === null) {
      mediaSearch = filter;
      return true;
    }
    return false;
  });
  if (mediaSearch === null) {
    mediaSearch = {};
    activity['intent-filter'].push(mediaSearch);
  }
  mediaSearch.action = [{ $: { 'android:name': PHONE_MEDIA_SEARCH_ACTION } }];
  mediaSearch.category = [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }];
  delete mediaSearch.data;
}

function configureWebLinks(application, enableVerifiedAppLinks) {
  const activity = application.activity?.find(
    (candidate) => candidate.$?.['android:name'] === '.MainActivity',
  );
  if (!activity) throw new Error('withFirstPartyPlayer: .MainActivity not found');
  ensureMediaPlayFromSearchIntentFilter(activity);
  let webLinks = activity['intent-filter'].find((filter) =>
    filter.data?.some((data) => data.$?.['android:host'] === WEB_LINK_HOST),
  );
  if (!webLinks) {
    webLinks = {};
    activity['intent-filter'].push(webLinks);
  }
  webLinks.$ = { ...(webLinks.$ || {}) };
  if (enableVerifiedAppLinks) webLinks.$['android:autoVerify'] = 'true';
  else delete webLinks.$['android:autoVerify'];
  webLinks.action = [{ $: { 'android:name': 'android.intent.action.VIEW' } }];
  webLinks.category = [
    { $: { 'android:name': 'android.intent.category.DEFAULT' } },
    { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
  ];
  webLinks.data = WEB_LINK_PATHS.map((pathRule) => ({
    $: {
      'android:scheme': 'https',
      'android:host': WEB_LINK_HOST,
      ...pathRule,
    },
  }));
}

function configureManifestObject(
  manifest,
  { enableVerifiedAppLinks = false } = {},
) {
  const application = manifest.application?.[0];
  if (!application) throw new Error('withFirstPartyPlayer: <application> not found');
  upsertMetadata(application, AUTOMOTIVE_META_NAME, '@xml/automotive_app_desc');
  upsertMetadata(application, ATTRIBUTION_ICON_META_NAME, '@drawable/ic_stat_music');
  upsertPlayerService(application);
  upsertPlaybackEventHeadlessService(application);
  configureWebLinks(application, enableVerifiedAppLinks);
  return manifest;
}

function transformAutoLint(source) {
  const start = '// @generated begin withFirstPartyPlayer Auto lint';
  const end = '// @generated end withFirstPartyPlayer Auto lint';
  const previous = new RegExp(`\\n*${start}[\\s\\S]*?${end}\\n?`, 'g');
  const stripped = source.replace(previous, '').trimEnd();
  return stripped.length > 0 ? `${stripped}\n` : '';
}

function configureAutoLint(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFirstPartyPlayer: only Groovy app build.gradle files are supported');
    }
    cfg.modResults.contents = transformAutoLint(cfg.modResults.contents);
    return cfg;
  });
}

function transformMainActivity(source) {
  if (source.includes(GENERATED_MEDIA_SEARCH_ACTIVITY_MARKER)) return source;
  if (!source.includes('super.onCreate(null)')) {
    throw new Error('withFirstPartyPlayer: unsupported MainActivity onCreate');
  }
  return source.replace(
    'super.onCreate(null)',
    `super.onCreate(null)\n    ${GENERATED_MEDIA_SEARCH_ACTIVITY_MARKER}\n    if (savedInstanceState == null) MediaPlayFromSearchInbox.publishFromIntent(intent)`,
  );
}

function transformMainApplication(source) {
  if (source.includes(GENERATED_MEDIA_SEARCH_APPLICATION_MARKER)) return source;
  const anchor = 'PackageList(this).packages.apply {';
  if (!source.includes(anchor)) {
    throw new Error('withFirstPartyPlayer: unsupported MainApplication package list');
  }
  return source.replace(
    anchor,
    `${anchor}\n          ${GENERATED_MEDIA_SEARCH_APPLICATION_MARKER}\n          add(MediaPlayFromSearchPackage())`,
  );
}

function mediaPlayFromSearchKotlinSources(packageName) {
  return {
    inbox: `package ${packageName}

import android.app.SearchManager
import android.content.Intent
import android.provider.MediaStore
import org.json.JSONObject
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.CopyOnWriteArraySet

internal object MediaPlayFromSearchInbox {
  private const val MAX_FIELD_LENGTH = 512
  private const val HANDLED_EXTRA = "${packageName}.MEDIA_PLAY_FROM_SEARCH_HANDLED"

  internal data class PendingSearch(val id: Long, val payload: String)
  private data class BoundedExtra(val value: String?)

  private var nextId = 0L
  private var pending: PendingSearch? = null
  private val seenIntents = Collections.newSetFromMap(WeakHashMap<Intent, Boolean>())
  private val listeners = CopyOnWriteArraySet<(PendingSearch) -> Unit>()

  fun publishFromIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH) return
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
    if (intent.getBooleanExtra(HANDLED_EXTRA, false)) return

    val query = readOptionalExtra(intent, SearchManager.QUERY) ?: return
    val mediaFocus = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_FOCUS) ?: return
    val artist = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_ARTIST) ?: return
    val album = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_ALBUM) ?: return
    val title = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_TITLE) ?: return
    val playlist = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_PLAYLIST) ?: return
    val genre = readOptionalExtra(intent, MediaStore.EXTRA_MEDIA_GENRE) ?: return

    val payload = JSONObject().apply {
      put("query", query.value ?: "")
      mediaFocus.value?.let { put("mediaFocus", it) }
      artist.value?.let { put("artist", it) }
      album.value?.let { put("album", it) }
      title.value?.let { put("title", it) }
      playlist.value?.let { put("playlist", it) }
      genre.value?.let { put("genre", it) }
    }.toString()

    val entry: PendingSearch
    val snapshot: List<(PendingSearch) -> Unit>
    synchronized(this) {
      if (!seenIntents.add(intent)) return
      runCatching { intent.putExtra(HANDLED_EXTRA, true) }
      nextId += 1L
      entry = PendingSearch(nextId, payload)
      pending = entry
      snapshot = listeners.toList()
    }
    snapshot.forEach { listener -> listener(entry) }
  }

  private fun readOptionalExtra(intent: Intent, key: String): BoundedExtra? {
    val raw = intent.getStringExtra(key) ?: intent.getCharSequenceExtra(key)?.toString()
      ?: return BoundedExtra(null)
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return BoundedExtra(null)
    if (trimmed.length > MAX_FIELD_LENGTH) return null
    return BoundedExtra(trimmed)
  }

  fun subscribe(listener: (PendingSearch) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun consume(): String? = synchronized(this) {
    val value = pending?.payload
    pending = null
    value
  }

  fun consume(expectedId: Long): Boolean = synchronized(this) {
    if (pending?.id != expectedId) return@synchronized false
    pending = null
    true
  }
}
`,
    module: `package ${packageName}

import android.content.Intent
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicInteger

internal class MediaPlayFromSearchModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val listenerCount = AtomicInteger(0)
  private val activityEventListener = object : BaseActivityEventListener() {
    override fun onNewIntent(intent: Intent) {
      MediaPlayFromSearchInbox.publishFromIntent(intent)
    }
  }
  private val unsubscribe = MediaPlayFromSearchInbox.subscribe { entry ->
    // Keep the search payload pending until JavaScript registers its event
    // listener. The subsequent consumePendingSearch call closes the cold-start
    // and listener-registration race without duplicate delivery.
    if (listenerCount.get() <= 0) return@subscribe
    if (!emit(entry.payload)) return@subscribe
    MediaPlayFromSearchInbox.consume(entry.id)
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
    MediaPlayFromSearchInbox.publishFromIntent(reactContext.currentActivity?.intent)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun consumePendingSearch(promise: Promise) {
    MediaPlayFromSearchInbox.publishFromIntent(reactApplicationContext.currentActivity?.intent)
    promise.resolve(MediaPlayFromSearchInbox.consume())
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

  private fun emit(payload: String): Boolean =
    runCatching {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, payload)
    }.isSuccess

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(activityEventListener)
    unsubscribe()
    super.invalidate()
  }

  companion object {
    const val NAME = "MediaPlayFromSearchIntent"
    private const val EVENT_NAME = "MediaPlayFromSearchReceived"
  }
}
`,
    package: `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

internal class MediaPlayFromSearchPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(MediaPlayFromSearchModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
`,
  };
}

function writeMediaPlayFromSearchSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const packageName = cfg.android?.package;
      if (!packageName) throw new Error('withFirstPartyPlayer: android.package is required');
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );
      fs.mkdirSync(directory, { recursive: true });
      const sources = mediaPlayFromSearchKotlinSources(packageName);
      fs.writeFileSync(path.join(directory, 'MediaPlayFromSearchInbox.kt'), sources.inbox);
      fs.writeFileSync(path.join(directory, 'MediaPlayFromSearchModule.kt'), sources.module);
      fs.writeFileSync(path.join(directory, 'MediaPlayFromSearchPackage.kt'), sources.package);
      return cfg;
    },
  ]);
}

function transformTestControllerSettings(source) {
  const start = '// @generated begin withFirstPartyPlayer hostile-controller test app';
  const end = '// @generated end withFirstPartyPlayer hostile-controller test app';
  const previous = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
  const block = `${start}
include '${HOSTILE_CONTROLLER_TEST_PROJECT}'
project('${HOSTILE_CONTROLLER_TEST_PROJECT}').projectDir =
    new File(rootDir, '${HOSTILE_CONTROLLER_TEST_DIRECTORY}')
${end}`;
  return `${source.replace(previous, '').trimEnd()}\n\n${block}\n`;
}

function configureTestControllerProject(config) {
  return withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFirstPartyPlayer: only Groovy settings.gradle files are supported');
    }
    cfg.modResults.contents = transformTestControllerSettings(cfg.modResults.contents);
    return cfg;
  });
}

function writeAutomotiveDescriptor(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'automotive_app_desc.xml'), AUTOMOTIVE_DESC);
      return cfg;
    },
  ]);
}

module.exports = function withFirstPartyPlayer(config, options = {}) {
  let next = withAndroidManifest(config, (cfg) => {
    configureManifestObject(cfg.modResults.manifest, options);
    return cfg;
  });
  next = withMainActivity(next, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withFirstPartyPlayer: only Kotlin MainActivity is supported');
    }
    cfg.modResults.contents = transformMainActivity(cfg.modResults.contents);
    return cfg;
  });
  next = withMainApplication(next, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withFirstPartyPlayer: only Kotlin MainApplication is supported');
    }
    cfg.modResults.contents = transformMainApplication(cfg.modResults.contents);
    return cfg;
  });
  next = configureAutoLint(next);
  next = configureTestControllerProject(next);
  next = writeMediaPlayFromSearchSources(next);
  return writeAutomotiveDescriptor(next);
};

module.exports.AUTOMOTIVE_DESC = AUTOMOTIVE_DESC;
module.exports.WEB_LINK_HOST = WEB_LINK_HOST;
module.exports.PHONE_MEDIA_SEARCH_ACTION = PHONE_MEDIA_SEARCH_ACTION;
module.exports.PLAYBACK_EVENT_HEADLESS_SERVICE_NAME = PLAYBACK_EVENT_HEADLESS_SERVICE_NAME;
module.exports.configureManifestObject = configureManifestObject;
module.exports.configureAutoLint = configureAutoLint;
module.exports.transformAutoLint = transformAutoLint;
module.exports.transformMainActivity = transformMainActivity;
module.exports.transformMainApplication = transformMainApplication;
module.exports.mediaPlayFromSearchKotlinSources = mediaPlayFromSearchKotlinSources;
module.exports.configureTestControllerProject = configureTestControllerProject;
module.exports.transformTestControllerSettings = transformTestControllerSettings;
