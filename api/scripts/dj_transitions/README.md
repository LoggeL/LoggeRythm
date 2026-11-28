# DJ transitions: offline analysis prototype

This prototype checks whether LoggeRythm can make beat-matched DJ transitions (tempo-matched crossfades on the downbeat) from server-side analysis. It runs entirely offline in its own venv. The API process never imports it.

```
audio (MP3 from STORAGE_DIR)
  └─ analysis.py   Beat This! beats/downbeats → tempo grid → bars → sections → cue points → onset phase
       └─ planner.py   per pair A→B: "beatmatch" or "crossfade" + explicit reason
            └─ render.py    A's tail time-stretched (Signalsmith, streaming) + bass swap → MP3
                 └─ evaluate.py  measures, bar by bar, how far A's and B's hits are apart
```

## Setup

```bash
cd api/scripts/dj_transitions
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt pytest
./native/build.sh                     # fetches pinned Signalsmith sources (MIT), builds libstretch
.venv/bin/python -m pytest -q test_stretch.py
```

The first analysis downloads the Beat This! checkpoint `final0` (~78 MB, MIT) to `~/.cache/torch/hub/checkpoints/`.

## Running it

The audio folder holds `<deezer_id>.mp3` and `<deezer_id>.json`, the same layout as `STORAGE_DIR` on the server.

```bash
.venv/bin/python cli.py analyze  <audio_dir> <out_dir> --device mps   # or cpu / cuda
.venv/bin/python cli.py matrix   <out_dir>                            # plan every ordered pair
.venv/bin/python cli.py render   <audio_dir> <out_dir> A_ID B_ID [A_ID B_ID ...]
.venv/bin/python cli.py evaluate <out_dir>
```

`render` writes three files per pair into `<out_dir>/mixes/`:

| File | Contents |
|---|---|
| `*.dj.mp3` | The planned transition, about 20 s before and 20 s after |
| `*.naive.mp3` | Today's web behaviour for comparison: a linear 8 s fade at the end of the file, B starting at 0 |
| `*.plan.json` | The decision, cue points, grids, timeline and limiter value |

## How it works

**Decode.** One pinned ffmpeg call decodes every file, so analysis and rendering see the same samples. Beat This!'s own `load_audio` is not used: it silently falls back between torchaudio, soundfile and madmom, and each handles MP3 encoder delay differently.

**Tempo grid.**
- Beats come from Beat This! peaks with sub-frame (parabolic) refinement.
- Constant-tempo tracks are fitted with a global phase-coherence search. Gaps and off-grid detections cannot shift the beat count.
- Tracks with drifting tempo (live drummers) use a piecewise fit and a local grid.

**Meter and downbeat.** Taken from the downbeat activation per beat class. A track is rejected as `AMBIGUOUS_DOWNBEAT` when two bar phases are nearly equally likely, which happens with some hip-hop.

**Cue points.**
- Sections are found from energy steps per bar, not from a global 8-bar grid, because pop songs have 2-bar fills.
- On A: the outro start, or the last 8 bars if the track ends hard.
- On B: N bars before the first section at main-part loudness.

**Onset phase.**
- Beat This! places its beats at different distances from the drum attack depending on the track. R3HAB vs Calvin Harris measured about 40 ms apart.
- Each grid is therefore shifted onto the percussive onsets, using a beat-synchronous onset profile in 4-bar windows.
- On constant-tempo tracks the period comes from the whole track.

**Plan.**
- The tracks are mixed as `beatmatch` only if all of these hold:
  - both tracks are 4/4 with a clear downbeat;
  - the grid in the mix region has ≥ 90 % of beats within ±25 ms;
  - beat jitter is ≤ 8 ms rms;
  - A would need at most ±6 % tempo change.
- Otherwise the plan is `crossfade` with the reason, e.g. `TEMPO_GAP`, `B_LOW_BEAT_PRECISION` or `A_AMBIGUOUS_DOWNBEAT`.
- Half or double tempo is rejected for now (`HALF_DOUBLE_TEMPO`).

**Render.** This mirrors the proposed Android design (one player, a separately decoded tail of A):
- A plays at 1.0× up to the cue downbeat.
- From there, A's tail is time-stretched with a smoothstep ramp over one bar, from 1.0× to B's tempo.
- B starts at 1.0× so that A's beat cue+4 meets B's beat cue+4.
- Equal-power fades, a bass swap in the middle of the overlap, attenuation-only loudness matching, and a look-ahead limiter.

**Stretcher.**
- `native/stretch_capi.cpp` is a thin C API over Signalsmith Stretch's streaming calls (`seek`, `process` with lengths per block). An Android JNI bridge would make the same calls.
- `python-stretch` is not usable here: in blocks it shifts pitch (440 → 461 Hz) and produces discontinuities.
- `test_stretch.py` pins the position map to < 0.6 ms under tempo ramps.

**Measurement.**
- Uses the un-gained A and B signals in the overlap.
- Per bar: cross-correlation of broadband onset envelopes, plus beat-synchronous profiles of broadband and of 2–8 kHz flux.
- The 2–8 kHz check is independent of the feature used for alignment.
- A self-test shifts B by 25 ms. If the metric doesn't recover the shift, the measurement for that pair counts as unreliable.

## Results (20 tracks from the Homebox, 26 Nov 2026)

Analysis time per track on the M5 Pro, warm, 3.5–6 min tracks:

| Device | Model | Total incl. decode and post-processing |
|---|---|---|
| CPU (4 threads) | 2.4–4.7 s | 4–8 s |
| MPS | 0.7–1.1 s | 3–4 s |

Post-processing takes about 2 s, mostly the onset STFT and the filters. A small home server on CPU should land at roughly 10–20 s per track (estimate).

- Electronic and pop/hip-hop tracks with a drum machine: exact tempo, e.g. 128.00, 150.00, 155.00, 125.0 or 112.25 BPM, with grid confidence ≥ 0.95.
- Live recordings (Queen "Bohemian Rhapsody", "Don't Stop Me Now", ABBA): correctly flagged as not mixable.

Planner over 380 ordered pairs: 31 beatmatch, 349 crossfade. Main reasons: tempo gap, beat precision, ambiguous downbeat.

Beatmatch renders, alignment after the tempo ramp (median per bar, B relative to A):

| Pair | A tempo factor | Offset | Note |
|---|---|---|---|
| R3HAB → Calvin Harris "Blame" | 1.024 | −0.2 ms | |
| Alignment → Nico Moreno | 1.033 | −0.1 ms | |
| Calvin Harris "Summer" → "Blame" | 1.000 | −0.3 ms | |
| Calvin Harris "Outside" → Lost Frequencies | 1.016 | +1.7 ms | |
| Eminem "Without Me" → Queen "Another One Bites The Dust" | 0.979 | +2.0 ms | |
| T78 → Lost Frequencies | 0.942 | +3.1 ms | |
| Calvin Harris "Blame" → R3HAB | 0.976 | +9.7 ms | borderline; R3HAB's intro has hi-hats at double tempo |
| Lost Frequencies → "Blame" | 0.985 | not measurable | Blame's intro has no drums, so there is nothing to flam |

For orientation: two kicks fuse below about 5 ms, and a flam becomes audible from about 10–20 ms.

## Known gaps

- **No listening test yet.** In particular, stretching artifacts at ±3–6 % on A's tail haven't been judged by ear.
- Half/double tempo is rejected rather than handled.
- There is no vocal detection, so two vocals can overlap.
- Key/Camelot is not yet used.
- Cue selection is heuristic: an 8-bar overlap almost everywhere, because most radio edits have no outro.
- The Android side (encoder delay ExoPlayer vs ffmpeg, binding the analysis to the file hash) is untested. See the research notes in the session.
