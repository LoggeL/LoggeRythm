# DJ transitions

Opt-in per account (`dj_transitions_enabled`, default off). The toggle is in the Android app under Profile → Playback. Only the Android player implements it. The web player ignores the field.

## Flow

```
Android (track A playing, B next)
  GET /api/dj/transition?from_id=A&to_id=B&quality=…&a_gain=…&b_gain=…
    pending   → server downloads/analyses/renders; asks again after retry_after_s
    crossfade → reason code (TEMPO_GAP, A_AMBIGUOUS_DOWNBEAT, …); regular crossfade settings apply
    beatmatch → clip timeline; app downloads GET /api/dj/clips/{id} (FLAC, ~3 MB)
```

**Server** (`api/app/services/dj/`). torch and full-track PCM run only in the subprocess `python -m app.services.dj.worker`, one job at a time.

| Module | Job |
|---|---|
| `model.py` | Beat This! (CPJKU, MIT, checkpoint `final0`) → beat/downbeat activations at 50 fps |
| `analysis.py` | Sub-frame beat peaks, phase-coherent tempo grid (constant or piecewise), meter and downbeat from class means of the downbeat activation, onset phase per 4-bar window (corrects beat vs. attack offsets of up to ~40 ms), bars, section boundaries, cue points |
| `planner.py` | `beatmatch` only for 4/4, a clear downbeat, local grid ≥ 90 % within ±25 ms, jitter ≤ 8 ms rms, a common phase reference, and at most ±6 % tempo. Otherwise `crossfade` with a reason |
| `render.py` | The clip. See below |
| `stretch.py` + `native/` | Signalsmith Stretch (MIT, headers vendored) via its own C API, streaming with a time-varying rate. Position map < 0.6 ms |
| `service.py` | Analysis cache `STORAGE_DIR/dj/analysis/<id>.<quality>.json` (bound to file size and mtime), clips `STORAGE_DIR/dj/clips/` (audio and metadata are pruned together once unused for 3 days). One worker thread. The most recently requested job runs first, and jobs nobody has polled for 60 s are dropped (logged). Failed jobs are reported as HTTP 502 for 10 minutes, never as a crossfade. Clip constraints the planner cannot see (pre-roll, B enters too late) are stored as the decision `crossfade` / `RENDER_UNSUITABLE` |

**The clip** (clip time t):
- A plays at 1.0× until its cue downbeat.
- From the cue, A's tail is time-stretched with a smoothstep ramp over one bar to B's tempo.
- B starts at 1.0× so that A's beat cue+4 meets B's beat cue+4.
- Equal-power fades, a bass swap (150 Hz) in the middle of the overlap, and a look-ahead limiter.
- A and B are already scaled by the player's loudness gains (`a_gain`, `b_gain`).
- Contract with the player: `a_media = a_start_s + t` (before `cue_s`), `b_media = t + b_offset_s`.
- Format: 16-bit FLAC. MP3 would be wrong here: Media3 trims the LAME encoder delay only on the first flush, so every deck seek would shift the audio by about 25 ms against the reported position.
- Without `quality`, the server resolves the quality the same way as `/api/tracks/{id}/stream` (the account's preferred quality).

**Android** (`LoggeRythmDjTransition.kt`). The second deck is invisible to the session, Auto and persistence. It shares the primary player's audio session, so EQ, bass boost and the LoudnessEnhancer apply to the clip as well.
1. The deck starts muted at `deck_start_s` and phase-locks to the primary player (A). It corrects with seeks first, then with ±3 % speed (Sonic). While the primary rebuffers, the deck pauses with it.
2. At `join_in_s` (between two beats) there is a 150 ms equal-gain join from primary to deck. Both play the same audio there.
3. At `primary_seek_s` the muted primary player seeks into B and locks onto the deck's B audio.
4. At `join_out_s` it joins back to the primary player and the deck stops.

The following abort the DJ transition and restore the loudness: user pause, skip or seek, a speed change, queue changes, focus loss, and the sleep fade. The controller's own seeks are matched exactly (index and position), so every other seek counts as a user action. A sleep fade aborts before it reads the base volume.

The app falls back to the regular transition (logged) in these cases:
- the deck does not lock before the cue, or the crossfade is already running;
- a "sleep after this track" timer targets A (also when it is set during the run, as long as the primary is still on A);
- A and B have different quality tiers, or need different LoudnessEnhancer boosts;
- the player plays a different codec than the server analysed (`a_mime` / `b_mime`), for example a cached MP3 after the account switched to lossless.

Declines that depend on position or transient state (past the clip start, crossfade running, deck lock timeout, decoder not known yet) are planned again after a user seek.

**Timing.** The server analyses and renders on ffmpeg's decode timeline. The player's positions differ from it by a per-track offset (`LoggeRythmDjDecoderOffset`; source: Media3 1.10.1, AOSP codec2):
- MP3: `c2.android.mp3.decoder` drops its 529-sample delay after every start and every flush.
- Media3 trims the LAME encoder delay D only after a reconfiguration (prepare, item change, cross-item seek). A seek within the same item does not trim it again.
- ffmpeg drops (D + 529) samples for tagged MP3 files and nothing for untagged ones. The clip carries that value as `a_start_skip_s` / `b_start_skip_s` (from ffprobe).
- The controller tracks whether the primary is currently "trimmed". It only mixes with verified decoders (`c2.android.mp3.decoder`, `c2.android.flac.decoder`); with any other decoder it declines and logs the decoder name.
- Seeks start at the next frame (MP3 26 ms, clip FLAC 1024 samples = 23 ms). After every seek the lock waits 300 ms before it measures again.

Logs: `adb logcat -s LoggeRythmDj`.

## Known gaps

- Pairs with different LoudnessEnhancer boosts (quiet tracks with loudness normalization on) are not mixed. The enhancer is per session and would jump in the middle of the song.
- Offline downloads (local files) are not mixed. Neither are pairs with different quality tiers.
- Half/double tempo is rejected (`HALF_DOUBLE_TEMPO`), and there is no key or vocal detection.

## Prototype results (20 tracks, Nov 26 2026)

- Over 380 ordered pairs, about 8 % come out as `beatmatch`.
- Of 8 beatmatch renders, 6 align to ≤ 3 ms and one to 9.7 ms. Two kicks fuse below about 5 ms.
- Analysis takes 12–18 s per track on the Homebox (CPU, 4 threads). Rendering a clip takes about 2 s.
- The Docker image grows by about 1.6 GB (CPU torch).
