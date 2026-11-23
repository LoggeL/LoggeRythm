package top.logge.loggerythm.player

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import java.net.URI
import java.util.concurrent.atomic.AtomicLong

internal data class RuntimeBrowseNode(
  val mediaItem: MediaItem,
  val childIds: List<String>,
  val source: PlayerItemSpec? = null,
) {
  override fun toString(): String =
    "RuntimeBrowseNode(mediaItem=<redacted>, childIds=<public:${childIds.size}>, " +
      "source=<redacted>)"
}

internal data class RuntimeBrowseTree(
  val revision: Long,
  val rootId: String,
  val nodes: Map<String, RuntimeBrowseNode>,
  val parentByChildId: Map<String, String>,
) {
  override fun toString(): String =
    "RuntimeBrowseTree(revision=$revision, rootId=<public>, nodes=<redacted:${nodes.size}>, " +
      "parents=<public:${parentByChildId.size}>)"
}

/** A playable browse selection resolved without accepting any caller-owned URI or metadata. */
internal data class RuntimeBrowseSelection(
  val mediaItems: List<MediaItem>,
  val startIndex: Int,
) {
  override fun toString(): String =
    "RuntimeBrowseSelection(mediaItems=<redacted:${mediaItems.size}>, startIndex=$startIndex)"
}

/** Public library invalidation only: it deliberately contains no media source or credential. */
internal data class RuntimeBrowseTreeChange(
  val childCountByParentId: Map<String, Int>,
)

internal interface LoggeRythmBrowseTreeObserver {
  fun onBrowseTreeChanged(change: RuntimeBrowseTreeChange)
}

/** In-process service bridge. The payload is limited to public parent IDs and child counts. */
internal object LoggeRythmBrowseTreeServiceBridge {
  private val lock = Any()
  private var observer: LoggeRythmBrowseTreeObserver? = null

  fun attach(value: LoggeRythmBrowseTreeObserver) = synchronized(lock) {
    if (observer != null && observer !== value) {
      throw PlayerProtocolException("browse-tree-observer-active")
    }
    observer = value
  }

  fun detach(value: LoggeRythmBrowseTreeObserver) = synchronized(lock) {
    if (observer === value) observer = null
  }

  fun publish(change: RuntimeBrowseTreeChange) {
    if (change.childCountByParentId.isEmpty()) return
    synchronized(lock) { observer }?.onBrowseTreeChanged(change)
  }
}

internal object LoggeRythmPlayerRuntime {
  private val generation = AtomicLong(0)
  private val queueGeneration = AtomicLong(0)
  private val lock = Any()
  private val cookieVault = LoggeRythmCookieVault()
  private var sessionBinding: LoggeRythmPersistedSessionBinding? = null
  private var queueSources: List<PlayerItemSpec> = emptyList()
  private var queueExtras: Map<String, String> = emptyMap()
  private var stagedSources: LinkedHashMap<Pair<String, String>, PlayerItemSpec> = linkedMapOf()
  private var stagedExtrasById: LinkedHashMap<String, String> = linkedMapOf()
  private var voiceSearchResultsByQuery: LinkedHashMap<String, List<MediaItem>> = linkedMapOf()
  private var voiceSearchSourcesById: LinkedHashMap<String, PlayerItemSpec> = linkedMapOf()
  private var voiceSearchMediaItemsById: LinkedHashMap<String, MediaItem> = linkedMapOf()
  private var voiceSearchQueryByMediaId: LinkedHashMap<String, String> = linkedMapOf()
  private var browseTree: RuntimeBrowseTree = defaultBrowseTree()
  private var browseTreeSpec: BrowseTreeSpec? = null

  /**
   * Installs the only account/origin identity allowed to own live player sources. A changed
   * binding invalidates all process-only credentials before any restore or new queue is admitted.
   */
  fun bindSession(binding: LoggeRythmPersistedSessionBinding): Boolean {
    LoggeRythmPersistedSessionBindingPolicy.requireValid(binding)
    val (changed, revision, browseChange) = synchronized(lock) {
      if (sessionBinding == binding) return@synchronized Triple(false, null, null)
      val previousTree = browseTree
      sessionBinding = binding
      cookieVault.clearAll()
      queueSources = emptyList()
      queueExtras = emptyMap()
      stagedSources.clear()
      stagedExtrasById.clear()
      clearVoiceSearchCacheLocked()
      browseTree = defaultBrowseTree(generation.incrementAndGet())
      browseTreeSpec = null
      Triple(
        true,
        queueGeneration.incrementAndGet(),
        publicTreeChange(previousTree, browseTree),
      )
    }
    revision?.let(LoggeRythmCacheServiceBridge::queueChanged)
    browseChange?.let(LoggeRythmBrowseTreeServiceBridge::publish)
    return changed
  }

  fun currentSessionBinding(): LoggeRythmPersistedSessionBinding? = synchronized(lock) {
    sessionBinding
  }

  fun installQueue(items: List<PlayerItemSpec>): List<MediaItem> {
    val (installed, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      items.forEach { requireCookieMatchesBinding(it, binding) }
      val cookies = mutableListOf<Pair<String, String?>>()
      val nextExtras = linkedMapOf<String, String>()
      val mediaItems = items.map { item ->
        if (item.url.startsWith("https://")) cookies += item.url to item.cookie
        nextExtras[item.id] = item.extrasJson
        mediaItem(
          id = item.id,
          url = item.url,
          title = item.title,
          artist = item.artist,
          album = item.album,
          subtitle = null,
          artworkUrl = item.artworkUrl,
          durationMs = item.durationMs,
          browsable = false,
          playable = true,
        )
      }
      cookieVault.replaceQueue(cookies)
      queueSources = items.toList()
      queueExtras = nextExtras.toMap()
      stagedSources.clear()
      stagedExtrasById.clear()
      mediaItems to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return installed
  }

  /**
   * Stages newly added or inserted queue items ahead of an in-place Media3 `addMediaItems` call.
   * Staging by `(id, url)` ensures a spontaneous `EVENT_TIMELINE_CHANGED` (such as progressive
   * duration resolution) arriving before the MediaSession IPC executes cannot drop the pending
   * sidecar or cookie, while hostile controllers still fail closed in [captureQueue].
   */
  fun stageAddedQueueItems(
    existingIds: Set<String>,
    items: List<PlayerItemSpec>,
  ): List<MediaItem> {
    if (items.isEmpty()) throw PlayerProtocolException("queue-items-empty")
    val (staged, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      if (existingIds.size + items.size > LoggeRythmPlayerProtocol.MAX_QUEUE_ITEMS) {
        throw PlayerProtocolException("queue-too-large")
      }
      val seenIds = existingIds.toMutableSet()
      items.forEach { item ->
        requireCookieMatchesBinding(item, binding)
        if (!seenIds.add(item.id)) throw PlayerProtocolException("queue-item-id-duplicate")
      }
      val candidateCookies = buildList {
        queueSources.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
        stagedSources.values.filter { it.url.startsWith("https://") }.forEach {
          add(it.url to it.cookie)
        }
        items.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
      }
      cookieVault.replaceQueue(candidateCookies)
      val mediaItems = items.map { item ->
        stagedSources[item.id to item.url] = item
        stagedExtrasById[item.id] = item.extrasJson
        mediaItem(
          id = item.id,
          url = item.url,
          title = item.title,
          artist = item.artist,
          album = item.album,
          subtitle = null,
          artworkUrl = item.artworkUrl,
          durationMs = item.durationMs,
          browsable = false,
          playable = true,
        )
      }
      mediaItems to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return staged
  }

  /**
   * Stages one replacement item ahead of an in-place Media3 `replaceMediaItem` call. Supports
   * updating the URL or cookie of an existing mediaId (such as playback recovery) without causing
   * a transient sidecar mismatch if an earlier timeline callback fires first.
   */
  fun stageReplacedQueueItem(replacedId: String, item: PlayerItemSpec): MediaItem {
    val (staged, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      requireCookieMatchesBinding(item, binding)
      val candidateCookies = buildList {
        queueSources.forEach { existing ->
          if (!existing.url.startsWith("https://")) return@forEach
          if (existing.id == replacedId && existing.url == item.url) return@forEach
          add(existing.url to existing.cookie)
        }
        stagedSources.values.forEach { existing ->
          if (!existing.url.startsWith("https://")) return@forEach
          if (existing.id == replacedId && existing.url == item.url) return@forEach
          add(existing.url to existing.cookie)
        }
        if (item.url.startsWith("https://")) add(item.url to item.cookie)
      }
      cookieVault.replaceQueue(candidateCookies)
      stagedSources[item.id to item.url] = item
      stagedExtrasById[item.id] = item.extrasJson
      mediaItem(
        id = item.id,
        url = item.url,
        title = item.title,
        artist = item.artist,
        album = item.album,
        subtitle = null,
        artworkUrl = item.artworkUrl,
        durationMs = item.durationMs,
        browsable = false,
        playable = true,
      ) to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return staged
  }

  /**
   * Stages all items of an active-preserving `replaceQueue` splice ahead of incremental
   * `removeMediaItems` / `addMediaItems` calls around the uninterrupted running track.
   */
  fun stagePreservedReplaceQueue(items: List<PlayerItemSpec>): List<MediaItem> {
    if (items.isEmpty()) throw PlayerProtocolException("empty-queue-replace-invalid")
    val (staged, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      if (items.size > LoggeRythmPlayerProtocol.MAX_QUEUE_ITEMS) {
        throw PlayerProtocolException("queue-too-large")
      }
      val seenIds = mutableSetOf<String>()
      items.forEach { item ->
        requireCookieMatchesBinding(item, binding)
        if (!seenIds.add(item.id)) throw PlayerProtocolException("queue-item-id-duplicate")
      }
      val candidateCookies = items
        .filter { it.url.startsWith("https://") }
        .map { it.url to it.cookie }
      cookieVault.replaceQueue(candidateCookies)
      stagedSources.clear()
      stagedExtrasById.clear()
      val mediaItems = items.map { item ->
        stagedSources[item.id to item.url] = item
        stagedExtrasById[item.id] = item.extrasJson
        mediaItem(
          id = item.id,
          url = item.url,
          title = item.title,
          artist = item.artist,
          album = item.album,
          subtitle = null,
          artworkUrl = item.artworkUrl,
          durationMs = item.durationMs,
          browsable = false,
          playable = true,
        )
      }
      mediaItems to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return staged
  }

  fun unstageQueueItems(items: List<PlayerItemSpec>) {
    synchronized(lock) {
      items.forEach { item -> stagedSources.remove(item.id to item.url) }
      rebuildStagedExtrasLocked()
      val candidateCookies = buildList {
        queueSources.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
        stagedSources.values.filter { it.url.startsWith("https://") }.forEach {
          add(it.url to it.cookie)
        }
      }
      cookieVault.replaceQueue(candidateCookies)
    }
  }

  /**
   * Publishes already protocol-validated radio items to the private sidecars before Media3 sees
   * them. Cookies are vaulted in the same synchronized mutation and the native queue generation
   * advances exactly once. The coordinator persists the resulting queue and event removal before
   * resolving the JavaScript completion promise.
   */
  fun appendQueue(items: List<PlayerItemSpec>): List<MediaItem> {
    if (items.isEmpty()) return emptyList()
    val (appended, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      val existingIds = queueSources.mapTo(mutableSetOf(), PlayerItemSpec::id)
      items.forEach { item ->
        requireCookieMatchesBinding(item, binding)
        if (!existingIds.add(item.id)) throw PlayerProtocolException("queue-item-id-duplicate")
      }
      val mediaItems = items.map { item ->
        mediaItem(
          id = item.id,
          url = item.url,
          title = item.title,
          artist = item.artist,
          album = item.album,
          subtitle = null,
          artworkUrl = item.artworkUrl,
          durationMs = item.durationMs,
          browsable = false,
          playable = true,
        )
      }
      val nextSources = queueSources + items
      // Validate every old/new URL conflict before publishing any new sidecar.
      cookieVault.replaceQueue(
        nextSources.filter { it.url.startsWith("https://") }.map { it.url to it.cookie },
      )
      queueSources = nextSources
      queueExtras = nextSources.associate { it.id to it.extrasJson }
      mediaItems to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return appended
  }

  fun clearQueueHeaders() {
    val revision = synchronized(lock) {
      cookieVault.clearQueue()
      queueSources = emptyList()
      queueExtras = emptyMap()
      stagedSources.clear()
      stagedExtrasById.clear()
      queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
  }

  fun installBrowseTree(spec: BrowseTreeSpec): RuntimeBrowseTree {
    if (spec.root.id != BROWSE_ROOT_ID) {
      throw PlayerProtocolException("browse-root-id-invalid")
    }
    val (installed, change) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      val revision = generation.incrementAndGet()
      val cookies = mutableListOf<Pair<String, String?>>()
      val nodes = linkedMapOf<String, RuntimeBrowseNode>()
      val parents = linkedMapOf<String, String>()

      fun visit(node: BrowseNodeSpec, parentId: String?) {
        val source = if (node.playable) {
          PlayerItemSpec(
            id = node.id,
            url = checkNotNull(node.url),
            title = node.title,
            artist = node.artist,
            album = node.album,
            artworkUrl = node.artworkUrl,
            durationMs = node.durationMs,
            cookie = node.cookie,
            extrasJson = node.extrasJson,
          ).also { requireCookieMatchesBinding(it, binding) }
        } else {
          null
        }
        if (node.playable && node.url?.startsWith("https://") == true) {
          cookies += node.url to node.cookie
        }
        if (parentId != null) parents[node.id] = parentId
        nodes[node.id] = RuntimeBrowseNode(
          mediaItem = mediaItem(
            id = node.id,
            url = node.url,
            title = node.title,
            artist = node.artist,
            album = node.album,
            subtitle = node.subtitle,
            artworkUrl = node.artworkUrl,
            durationMs = node.durationMs,
            // In this schema every non-playable node is a container, including an empty one.
            browsable = !node.playable,
            playable = node.playable,
          ),
          childIds = node.children.map(BrowseNodeSpec::id),
          source = source,
        )
        node.children.forEach { child -> visit(child, node.id) }
      }

      visit(spec.root, null)
      val tree = RuntimeBrowseTree(
        revision = revision,
        rootId = spec.root.id,
        nodes = nodes.toMap(),
        parentByChildId = parents.toMap(),
      )
      // Validate all Cookie conflicts before publishing either the new tree or its sidecars.
      cookieVault.replaceBrowse(cookies)
      val previousTree = browseTree
      browseTree = tree
      browseTreeSpec = spec
      tree to publicTreeChange(previousTree, tree)
    }
    LoggeRythmBrowseTreeServiceBridge.publish(change)
    return installed
  }

  fun browseTree(): RuntimeBrowseTree = synchronized(lock) { browseTree }

  /** Private, validated source form used only by encrypted persistence. */
  fun persistedBrowseTree(): BrowseTreeSpec? = synchronized(lock) { browseTreeSpec }

  fun browseItem(mediaId: String): MediaItem? = synchronized(lock) {
    browseTree.nodes[mediaId]?.mediaItem
  }

  /**
   * Resolve one selected playable leaf to the ordered playable children of its direct parent.
   * Caller-provided MediaItems are never consulted, so a controller cannot smuggle a URI.
   */
  fun playableBrowseSiblings(mediaId: String): RuntimeBrowseSelection? = synchronized(lock) {
    val tree = browseTree
    val selected = tree.nodes[mediaId]?.takeIf { it.source != null } ?: return@synchronized null
    val parentId = tree.parentByChildId[mediaId] ?: return@synchronized null
    val parent = tree.nodes[parentId] ?: return@synchronized null
    val playableIds = parent.childIds.filter { childId -> tree.nodes[childId]?.source != null }
    val selectedIndex = playableIds.indexOf(mediaId)
    if (selectedIndex < 0) return@synchronized null
    val mediaItems = playableIds.map { childId ->
      tree.nodes[childId]?.mediaItem ?: return@synchronized null
    }
    if (mediaItems.isEmpty() || mediaItems[selectedIndex] !== selected.mediaItem) {
      return@synchronized null
    }
    RuntimeBrowseSelection(mediaItems, selectedIndex)
  }

  /**
   * Resolve one published non-root container to its ordered directly playable children, starting
   * at the first. Like [playableBrowseSiblings], only native tree sources are used.
   */
  fun playableBrowseChildren(containerId: String): RuntimeBrowseSelection? = synchronized(lock) {
    val tree = browseTree
    if (containerId == tree.rootId) return@synchronized null
    val container = tree.nodes[containerId]?.takeIf { it.source == null }
      ?: return@synchronized null
    val mediaItems = container.childIds.mapNotNull { childId ->
      tree.nodes[childId]?.takeIf { it.source != null }?.mediaItem
    }
    if (mediaItems.isEmpty()) null else RuntimeBrowseSelection(mediaItems, 0)
  }

  fun cookieFor(url: String): String? = synchronized(lock) {
    cookieVault.cookieFor(url)
  }

  /**
   * Returns `(origin, cookie)` for the currently bound session when at least one authenticated
   * HTTPS queue or browse source has vaulted a session cookie for that exact origin.
   */
  fun sessionCookieForCurrentOrigin(): Pair<String, String>? = synchronized(lock) {
    val binding = sessionBinding ?: return@synchronized null
    val cookie = cookieVault.sessionCookieForOrigin(binding.origin) ?: return@synchronized null
    binding.origin to cookie
  }

  /**
   * Caches validated, account-scoped live catalog search results for Android Auto `onSearch` /
   * `onGetSearchResult` and subsequent tap-to-play selection. Automatically cleared on account
   * switch, logout, or cache clear.
   */
  fun installVoiceSearchResults(
    normalizedQueryKey: String,
    items: List<PlayerItemSpec>,
  ): List<MediaItem> = synchronized(lock) {
    val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
    val bounded = items.take(MAX_VOICE_SEARCH_ITEMS_PER_QUERY)
    bounded.forEach { item ->
      requireCookieMatchesBinding(item, binding)
      if (!LoggeRythmCarLibraryState.hasPhoneTrackMetadata(item.extrasJson)) {
        throw PlayerProtocolException("voice-search-item-metadata-invalid")
      }
    }
    voiceSearchResultsByQuery.remove(normalizedQueryKey)
    while (voiceSearchResultsByQuery.size >= MAX_VOICE_SEARCH_CACHED_QUERIES) {
      val oldestKey = voiceSearchResultsByQuery.keys.firstOrNull() ?: break
      voiceSearchResultsByQuery.remove(oldestKey)
    }
    val mediaItems = bounded.map { item ->
      mediaItem(
        id = item.id,
        url = item.url,
        title = item.title,
        artist = item.artist,
        album = item.album,
        subtitle = null,
        artworkUrl = item.artworkUrl,
        durationMs = item.durationMs,
        browsable = false,
        playable = true,
      )
    }
    voiceSearchResultsByQuery[normalizedQueryKey] = mediaItems
    bounded.forEachIndexed { index, spec ->
      voiceSearchSourcesById[spec.id] = spec
      voiceSearchMediaItemsById[spec.id] = mediaItems[index]
      voiceSearchQueryByMediaId[spec.id] = normalizedQueryKey
    }
    pruneVoiceSearchSourcesLocked()
    rebuildSearchCookiesLocked()
    mediaItems
  }

  fun cachedVoiceSearchResults(normalizedQueryKey: String): List<MediaItem>? = synchronized(lock) {
    voiceSearchResultsByQuery[normalizedQueryKey]?.toList()
  }

  fun voiceSearchItem(mediaId: String): MediaItem? = synchronized(lock) {
    voiceSearchMediaItemsById[mediaId]
  }

  fun clearVoiceSearchCache() = synchronized(lock) {
    clearVoiceSearchCacheLocked()
  }

  fun removeVoiceSearchQuery(normalizedQueryKey: String) = synchronized(lock) {
    if (voiceSearchResultsByQuery.remove(normalizedQueryKey) != null) {
      pruneVoiceSearchSourcesLocked()
      rebuildSearchCookiesLocked()
    }
  }

  fun playableVoiceSearchSelection(mediaId: String): RuntimeBrowseSelection? = synchronized(lock) {
    val queryKey = voiceSearchQueryByMediaId[mediaId] ?: return@synchronized null
    val results = voiceSearchResultsByQuery[queryKey] ?: return@synchronized null
    val selectedIndex = results.indexOfFirst { it.mediaId == mediaId }
    if (selectedIndex < 0) return@synchronized null
    val specs = results.map { item -> voiceSearchSourcesById[item.mediaId] ?: return@synchronized null }
    stageVoiceSelectionLocked(specs)
    RuntimeBrowseSelection(results, selectedIndex)
  }

  /**
   * Stages a live voice catalog selection so `onSetMediaItems` / `captureQueue` adopts every item's
   * validated URL, cookie, and phone-compatible `extrasJson` sidecar atomically.
   */
  fun stageVoiceSelection(items: List<PlayerItemSpec>): List<MediaItem> {
    if (items.isEmpty()) throw PlayerProtocolException("queue-items-empty")
    val (mediaItems, revision) = synchronized(lock) {
      stageVoiceSelectionLocked(items) to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return mediaItems
  }

  private fun stageVoiceSelectionLocked(items: List<PlayerItemSpec>): List<MediaItem> {
    val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
    if (items.size > LoggeRythmPlayerProtocol.MAX_QUEUE_ITEMS) {
      throw PlayerProtocolException("queue-too-large")
    }
    val seenIds = mutableSetOf<String>()
    items.forEach { item ->
      requireCookieMatchesBinding(item, binding)
      if (!seenIds.add(item.id)) throw PlayerProtocolException("queue-item-id-duplicate")
      if (!LoggeRythmCarLibraryState.hasPhoneTrackMetadata(item.extrasJson)) {
        throw PlayerProtocolException("voice-item-metadata-invalid")
      }
    }
    val candidateCookies = buildList {
      queueSources.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
      stagedSources.values.filter { it.url.startsWith("https://") }.forEach {
        add(it.url to it.cookie)
      }
      items.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
    }
    cookieVault.replaceQueue(candidateCookies)
    return items.map { item ->
      stagedSources[item.id to item.url] = item
      stagedExtrasById[item.id] = item.extrasJson
      mediaItem(
        id = item.id,
        url = item.url,
        title = item.title,
        artist = item.artist,
        album = item.album,
        subtitle = null,
        artworkUrl = item.artworkUrl,
        durationMs = item.durationMs,
        browsable = false,
        playable = true,
      )
    }
  }

  fun extrasFor(mediaId: String): String = synchronized(lock) {
    stagedExtrasById[mediaId] ?: queueExtras[mediaId] ?: voiceSearchSourcesById[mediaId]?.extrasJson ?: "{}"
  }

  fun loudnessGainFor(mediaId: String?): Float = synchronized(lock) {
    if (mediaId == null) return@synchronized 1f
    LoggeRythmLoudnessNormalization.gainLinearFromExtras(
      stagedExtrasById[mediaId] ?: queueExtras[mediaId] ?: "{}",
    )
  }

  /**
   * Reconciles the Media3 timeline back to its private source sidecars. Unknown or URI-mismatched
   * items fail closed so a controller cannot smuggle an unvalidated source into durable state.
   */
  fun captureQueue(mediaItems: List<MediaItem>): List<PlayerItemSpec> =
    captureQueueEntries(mediaItems.map { it.mediaId to it.localConfiguration?.uri?.toString() })

  internal fun captureQueueEntries(entries: List<Pair<String, String?>>): List<PlayerItemSpec> {
    val (captured, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      val queueById = queueSources.associateBy(PlayerItemSpec::id)
      val consumedStaged = mutableSetOf<Pair<String, String>>()
      val result = entries.map { (mediaId, rawLiveUrl) ->
        val liveUrl = rawLiveUrl
          ?: throw PlayerProtocolException("player-source-uri-missing")
        val stagedKey = mediaId to liveUrl
        val staged = stagedSources[stagedKey]
        val source = if (staged != null) {
          consumedStaged += stagedKey
          staged
        } else {
          val existing = queueById[mediaId]
            ?: browseTree.nodes[mediaId]?.source
            ?: voiceSearchSourcesById[mediaId]
            ?: throw PlayerProtocolException("player-source-sidecar-missing")
          if (existing.url != liveUrl) throw PlayerProtocolException("player-source-uri-mismatch")
          existing
        }
        requireCookieMatchesBinding(source, binding)
        source
      }
      consumedStaged.forEach(stagedSources::remove)
      rebuildStagedExtrasLocked()
      val cookieEntries = buildList {
        result.filter { it.url.startsWith("https://") }.forEach { add(it.url to it.cookie) }
        stagedSources.values.filter { it.url.startsWith("https://") }.forEach {
          add(it.url to it.cookie)
        }
      }
      cookieVault.replaceQueue(cookieEntries)
      val changed = result != queueSources
      queueSources = result.toList()
      queueExtras = result.associate { it.id to it.extrasJson }
      result to if (changed) queueGeneration.incrementAndGet() else null
    }
    revision?.let(LoggeRythmCacheServiceBridge::queueChanged)
    return captured
  }

  fun queueSources(): List<PlayerItemSpec> = synchronized(lock) { queueSources.toList() }

  fun currentQueueGeneration(): Long = queueGeneration.get()

  fun clearAllHeadersAndBrowseTree() {
    val (revision, browseChange) = synchronized(lock) {
      val previousTree = browseTree
      cookieVault.clearAll()
      queueSources = emptyList()
      queueExtras = emptyMap()
      stagedSources.clear()
      stagedExtrasById.clear()
      clearVoiceSearchCacheLocked()
      browseTree = defaultBrowseTree(generation.incrementAndGet())
      browseTreeSpec = null
      queueGeneration.incrementAndGet() to publicTreeChange(previousTree, browseTree)
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    LoggeRythmBrowseTreeServiceBridge.publish(browseChange)
  }

  fun clearSessionAndAllData() {
    val (revision, browseChange) = synchronized(lock) {
      val previousTree = browseTree
      sessionBinding = null
      cookieVault.clearAll()
      queueSources = emptyList()
      queueExtras = emptyMap()
      stagedSources.clear()
      stagedExtrasById.clear()
      clearVoiceSearchCacheLocked()
      browseTree = defaultBrowseTree(generation.incrementAndGet())
      browseTreeSpec = null
      queueGeneration.incrementAndGet() to publicTreeChange(previousTree, browseTree)
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    LoggeRythmBrowseTreeServiceBridge.publish(browseChange)
  }

  private fun clearVoiceSearchCacheLocked() {
    voiceSearchResultsByQuery.clear()
    voiceSearchSourcesById.clear()
    voiceSearchMediaItemsById.clear()
    voiceSearchQueryByMediaId.clear()
    cookieVault.clearSearch()
  }

  private fun pruneVoiceSearchSourcesLocked() {
    val activeIds = voiceSearchResultsByQuery.values.flatten().mapTo(mutableSetOf()) { it.mediaId }
    voiceSearchSourcesById.keys.retainAll(activeIds)
    voiceSearchMediaItemsById.keys.retainAll(activeIds)
    voiceSearchQueryByMediaId.keys.retainAll(activeIds)
  }

  private fun rebuildSearchCookiesLocked() {
    cookieVault.replaceSearch(
      voiceSearchSourcesById.values
        .filter { it.url.startsWith("https://") }
        .map { it.url to it.cookie },
    )
  }

  private fun rebuildStagedExtrasLocked() {
    stagedExtrasById.clear()
    stagedSources.values.forEach { item -> stagedExtrasById[item.id] = item.extrasJson }
  }

  /** Compare only Media3-public fields; private source sidecars and Cookie never enter the diff. */
  private fun publicTreeChange(
    previous: RuntimeBrowseTree,
    next: RuntimeBrowseTree,
  ): RuntimeBrowseTreeChange {
    val parentIds = linkedSetOf<String>()
    previous.nodes.forEach { (id, node) -> if (node.source == null) parentIds += id }
    next.nodes.forEach { (id, node) -> if (node.source == null) parentIds += id }
    val changed = linkedMapOf<String, Int>()
    parentIds.forEach { parentId ->
      val oldParent = previous.nodes[parentId]
      val newParent = next.nodes[parentId]
      val oldChildren = oldParent?.childIds.orEmpty()
      val newChildren = newParent?.childIds.orEmpty()
      val publicChildrenChanged = oldChildren != newChildren || newChildren.any { childId ->
        !samePublicMediaItem(previous.nodes[childId]?.mediaItem, next.nodes[childId]?.mediaItem)
      }
      if (publicChildrenChanged) changed[parentId] = newChildren.size
    }
    return RuntimeBrowseTreeChange(changed.toMap())
  }

  private fun samePublicMediaItem(left: MediaItem?, right: MediaItem?): Boolean {
    if (left == null || right == null) return left === right
    val leftMetadata = left.mediaMetadata
    val rightMetadata = right.mediaMetadata
    return left.mediaId == right.mediaId &&
      leftMetadata.title?.toString() == rightMetadata.title?.toString() &&
      leftMetadata.subtitle?.toString() == rightMetadata.subtitle?.toString() &&
      leftMetadata.artist?.toString() == rightMetadata.artist?.toString() &&
      leftMetadata.albumTitle?.toString() == rightMetadata.albumTitle?.toString() &&
      leftMetadata.artworkUri == rightMetadata.artworkUri &&
      leftMetadata.durationMs == rightMetadata.durationMs &&
      leftMetadata.isBrowsable == rightMetadata.isBrowsable &&
      leftMetadata.isPlayable == rightMetadata.isPlayable
  }

  private fun requireCookieMatchesBinding(
    item: PlayerItemSpec,
    binding: LoggeRythmPersistedSessionBinding,
  ) {
    if (item.cookie == null) return
    val uri = try {
      URI(item.url)
    } catch (_: Exception) {
      throw PlayerProtocolException("cookie-origin-invalid")
    }
    val port = if (uri.port == 443) -1 else uri.port
    val origin = try {
      URI("https", null, uri.host?.lowercase(), port, null, null, null).toASCIIString()
    } catch (_: Exception) {
      throw PlayerProtocolException("cookie-origin-invalid")
    }
    if (origin != binding.origin) throw PlayerProtocolException("cookie-origin-mismatch")
  }

  private fun mediaItem(
    id: String,
    url: String?,
    title: String?,
    artist: String?,
    album: String?,
    subtitle: String?,
    artworkUrl: String?,
    durationMs: Long?,
    browsable: Boolean,
    playable: Boolean,
  ): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      .setSubtitle(subtitle)
      .setArtworkUri(artworkUrl?.let(Uri::parse))
      .setDurationMs(durationMs)
      .setIsBrowsable(browsable)
      .setIsPlayable(playable)
      .build()
    return MediaItem.Builder()
      .setMediaId(id)
      .setMediaMetadata(metadata)
      .apply {
        if (url != null) setUri(url)
      }
      .build()
  }

  private fun defaultBrowseTree(revision: Long = 0L): RuntimeBrowseTree {
    val root = mediaItem(
      id = BROWSE_ROOT_ID,
      url = null,
      title = "LoggeRythm",
      artist = null,
      album = null,
      subtitle = null,
      artworkUrl = null,
      durationMs = null,
      browsable = true,
      playable = false,
    )
    return RuntimeBrowseTree(
      revision = revision,
      rootId = BROWSE_ROOT_ID,
      nodes = mapOf(BROWSE_ROOT_ID to RuntimeBrowseNode(root, emptyList())),
      parentByChildId = emptyMap(),
    )
  }

  internal const val BROWSE_ROOT_ID = "loggerythm:root"
  private const val MAX_VOICE_SEARCH_CACHED_QUERIES = 8
  private const val MAX_VOICE_SEARCH_ITEMS_PER_QUERY = 25
}
