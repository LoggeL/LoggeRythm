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
  private var browseTree: RuntimeBrowseTree = defaultBrowseTree()

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
      browseTree = defaultBrowseTree(generation.incrementAndGet())
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
      mediaItems to queueGeneration.incrementAndGet()
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    return installed
  }

  fun clearQueueHeaders() {
    val revision = synchronized(lock) {
      cookieVault.clearQueue()
      queueSources = emptyList()
      queueExtras = emptyMap()
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
            extrasJson = "{}",
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
      tree to publicTreeChange(previousTree, tree)
    }
    LoggeRythmBrowseTreeServiceBridge.publish(change)
    return installed
  }

  fun browseTree(): RuntimeBrowseTree = synchronized(lock) { browseTree }

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

  fun cookieFor(url: String): String? = synchronized(lock) {
    cookieVault.cookieFor(url)
  }

  fun extrasFor(mediaId: String): String = synchronized(lock) {
    queueExtras[mediaId] ?: "{}"
  }

  /**
   * Reconciles the Media3 timeline back to its private source sidecars. Unknown or URI-mismatched
   * items fail closed so a controller cannot smuggle an unvalidated source into durable state.
   */
  fun captureQueue(mediaItems: List<MediaItem>): List<PlayerItemSpec> {
    val (captured, revision) = synchronized(lock) {
      val binding = sessionBinding ?: throw PlayerProtocolException("player-session-unbound")
      val queueById = queueSources.associateBy(PlayerItemSpec::id)
      val result = mediaItems.map { mediaItem ->
        val source = queueById[mediaItem.mediaId]
          ?: browseTree.nodes[mediaItem.mediaId]?.source
          ?: throw PlayerProtocolException("player-source-sidecar-missing")
        val liveUrl = mediaItem.localConfiguration?.uri?.toString()
          ?: throw PlayerProtocolException("player-source-uri-missing")
        if (source.url != liveUrl) throw PlayerProtocolException("player-source-uri-mismatch")
        requireCookieMatchesBinding(source, binding)
        source
      }
      cookieVault.replaceQueue(result.map { it.url to it.cookie })
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
      browseTree = defaultBrowseTree(generation.incrementAndGet())
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
      browseTree = defaultBrowseTree(generation.incrementAndGet())
      queueGeneration.incrementAndGet() to publicTreeChange(previousTree, browseTree)
    }
    LoggeRythmCacheServiceBridge.queueChanged(revision)
    LoggeRythmBrowseTreeServiceBridge.publish(browseChange)
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
}
