package top.logge.loggerythm.player

internal object LoggeRythmProgressTickerPolicy {
  const val INTERVAL_MS = 1_000L

  fun shouldRun(
    listenerCount: Int,
    isPlaying: Boolean,
    isBuffering: Boolean,
    playWhenReady: Boolean,
    invalidated: Boolean,
  ): Boolean =
    !invalidated &&
      listenerCount > 0 &&
      (isPlaying || (isBuffering && playWhenReady))
}
