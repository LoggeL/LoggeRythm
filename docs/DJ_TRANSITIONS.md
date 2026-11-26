# DJ transitions

Opt-in per account (`dj_transitions_enabled`, default off). The toggle is in the Android app under Profile → Playback. Only the Android player implements it. The web player ignores the field.

## Flow

```
Android (track A playing, B next)
  GET /api/dj/transition?from_id=A&to_id=B&quality=…&a_gain=…&b_gain=…
    pending   → server downloads/analyses/renders; asks again after retry_after_s
    crossfade → reason code (TEMPO_GAP, A_AMBIGUOUS_DOWNBEAT, …); regular crossfade settings apply
    beatmatch → clip timeline; app downloads GET /api/dj/clips/{id} (MP3, ~1 MB)
```

**Server** (`api/app/services/dj/`). torch and full-track PCM run only in the subprocess `python -m app.services.dj.worker`, one job at a time.

| Module | Job |
|---|---|
| `model.py` | Beat This! (CPJKU, MIT, checkpoint `final0`) → beat/downbeat activations at 50 fps |
| `analysis.py` | Sub-frame beat peaks, phase-coherent tempo grid (constant or piecewise), meter and downbeat from class means of the downbeat activation, onset phase per 4-bar window (corrects beat vs. attack offsets of up to ~40 ms), bars, section boundaries, cue points |
| `planner.py` | `beatmatch` only for 4/4, a clear downbeat, local grid ≥ 90 % within ±25 ms, jitter ≤ 8 ms rms, a common phase reference, and at most ±6 % tempo. Otherwise `crossfade` with a reason |
| `render.py` | The clip. See below |
| `stretch.py` + `native/` | Signalsmith Stretch (MIT, headers vendored) via its own C API, streaming with a time-varying rate. Position map < 0.6 ms |
| `service.py` | Analysis cache `STORAGE_DIR/dj/analysis/<id>.<quality>.json` (bound to file size and mtime), clips `STORAGE_DIR/dj/clips/` (pruned after 3 days), job queue. Failed jobs are reported as HTTP 502 for 10 minutes, never as a crossfade |

**The clip** (clip time t):
- A plays at 1.0× until its cue downbeat.
- From the cue, A's tail is time-stretched with a smoothstep ramp over one bar to B's tempo.
- B starts at 1.0× so that A's beat cue+4 meets B's beat cue+4.
- Equal-power fades, a bass swap (150 Hz) in the middle of the overlap, and a look-ahead limiter.
- A and B are already scaled by the player's loudness gains (`a_gain`, `b_gain`).
- Contract with the player: `a_media = a_start_s + t` (before `cue_s`), `b_media = t + b_offset_s`.

**Android** (`LoggeRythmDjTransition.kt`). The second deck is invisible to the session, Auto and persistence.
1. The deck starts muted at `deck_start_s` and phase-locks to the primary player (A). It corrects with seeks first, then with ±3 % speed (Sonic).
2. At `join_in_s` (between two beats) there is a 150 ms equal-gain join from primary to deck. Both play the same audio there.
3. At `primary_seek_s` the muted primary player seeks into B and locks onto the deck's B audio.
4. At `join_out_s` it joins back to the primary player and the deck stops.

The following abort the DJ transition and restore the loudness: user pause, skip or seek, queue changes, focus loss, and the sleep fade. If the deck does not lock before the cue, the regular transition runs instead (logged).

Logs: `adb logcat -s LoggeRythmDj`.

## Known gaps

- EQ, bass boost and the LoudnessEnhancer only apply to the primary player, so they are missing during the clip (same as the existing crossfade).
- Offline downloads (local files) are not mixed. Neither are pairs with different quality tiers.
- Half/double tempo is rejected (`HALF_DOUBLE_TEMPO`), and there is no key or vocal detection.

## Prototype results (20 tracks, Nov 26 2026)

- Over 380 ordered pairs, about 8 % come out as `beatmatch`.
- Of 8 beatmatch renders, 6 align to ≤ 3 ms and one to 9.7 ms. Two kicks fuse below about 5 ms.
- Analysis takes 12–18 s per track on the Homebox (CPU, 4 threads). Rendering a clip takes about 2 s.
- The Docker image grows by about 1.6 GB (CPU torch).
