"""Subprocess entry point for the heavy DJ work, so torch and full-track PCM never live
in the API process.

    python -m app.services.dj.worker analyze AUDIO OUT_JSON
    python -m app.services.dj.worker render A_AUDIO B_AUDIO PLAN_JSON A_GAIN B_GAIN OUT_FLAC OUT_JSON

Exit code 0 means OUT_JSON was written. ``analyze`` also exits 0 for a track that
cannot be beat-matched; its JSON then has ``status: "unsuitable"`` and the reason.
``render`` likewise exits 0 without writing OUT_FLAC when the pair violates a clip
constraint (``render.RenderUnsuitable``); OUT_JSON then has ``status: "unsuitable"``.
Any other failure exits non-zero with the error on stderr.
"""
from __future__ import annotations

import json
import os
import sys
import time

from . import analysis, audio, render


def _write_json_atomic(path: str, payload: dict) -> None:
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, path)


def cmd_analyze(audio_path: str, out_json: str) -> None:
    from . import model  # torch only here

    started = time.perf_counter()
    pcm = audio.decode(audio_path)
    beat, down = model.activations(pcm, audio.SR)
    try:
        result = {"status": "ok", **analysis.analyze_activations(pcm, beat, down)}
    except analysis.AnalysisError as exc:
        result = {"status": "unsuitable", "reason": str(exc)}
    result.update({
        "analysis_version": analysis.ANALYSIS_VERSION,
        "analyzer": model.ANALYZER,
        "elapsed_s": round(time.perf_counter() - started, 2),
    })
    _write_json_atomic(out_json, result)


def cmd_render(a_path: str, b_path: str, plan_json: str, a_gain: str, b_gain: str,
               out_flac: str, out_json: str) -> None:
    with open(plan_json, "r", encoding="utf-8") as fh:
        plan = json.load(fh)
    try:
        clip, timeline = render.render_clip(
            audio.decode(a_path), audio.decode(b_path), plan, float(a_gain), float(b_gain)
        )
    except render.RenderUnsuitable as exc:
        _write_json_atomic(out_json, {"status": "unsuitable", "detail": str(exc)})
        return
    # how far ffmpeg's timeline (the clip's) is shifted against each source file's start
    timeline["a_start_skip_s"] = audio.start_skip_s(a_path)
    timeline["b_start_skip_s"] = audio.start_skip_s(b_path)
    tmp = out_flac + ".part"
    audio.write_flac(tmp, clip)
    os.replace(tmp, out_flac)
    _write_json_atomic(out_json, timeline)


def main(argv: list[str]) -> int:
    if len(argv) >= 1 and argv[0] == "analyze" and len(argv) == 3:
        cmd_analyze(argv[1], argv[2])
        return 0
    if len(argv) >= 1 and argv[0] == "render" and len(argv) == 8:
        cmd_render(*argv[1:])
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
