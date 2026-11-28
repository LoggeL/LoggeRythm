"""DJ-transition prototype CLI.

    .venv/bin/python cli.py analyze <audio_dir> <out_dir> [--device mps|cpu]
    .venv/bin/python cli.py matrix  <out_dir>
    .venv/bin/python cli.py render  <audio_dir> <out_dir> A_ID B_ID [A_ID B_ID ...]
    .venv/bin/python cli.py evaluate <out_dir>

Audio files are named <deezer_id>.mp3 with a <deezer_id>.json sidecar
(title/artist), exactly as in the API's STORAGE_DIR.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def _meta(audio_dir: Path, track_id: str) -> dict:
    side = audio_dir / f"{track_id}.json"
    if not side.is_file():
        raise SystemExit(f"missing sidecar {side}")
    return json.loads(side.read_text())


def _label(meta: dict) -> str:
    return f"{meta['artist']} - {meta['title']}"


def cmd_analyze(args) -> int:
    import analysis

    audio_dir, out_dir = Path(args.audio_dir), Path(args.out_dir)
    (out_dir / "analysis").mkdir(parents=True, exist_ok=True)
    failures = []
    files = sorted(audio_dir.glob("*.mp3"))
    if not files:
        raise SystemExit(f"no .mp3 files in {audio_dir}")
    for f in files:
        tid = f.stem
        meta = _meta(audio_dir, tid)
        dest = out_dir / "analysis" / f"{tid}.json"
        try:
            a = analysis.analyze(f, args.device)
        except analysis.AnalysisError as e:
            # an analysable-but-unsuitable track is a result, not a crash: store it with its reason
            a = {"analysis_version": analysis.ANALYSIS_VERSION, "status": "unsuitable", "file": f.name, "reason": str(e)}
            failures.append((tid, str(e)))
        a["track"] = {"id": tid, "artist": meta["artist"], "title": meta["title"]}
        dest.write_text(json.dumps(a))
        if a["status"] == "ok":
            t, c = a["tempo"], a["cues"]
            print(f"{_label(meta)[:48]:48s} {t['bpm']:7.2f} bpm conf={t['global_conf']:.2f} "
                  f"stable={t['stable']!s:5s} meter={a['meter']['meter']}({a['meter']['conf']:.2f}) "
                  f"intro={c['intro_bars']:3d} outro={c['outro_bars']:3d} model={a['timing_s']['model']:.1f}s")
        else:
            print(f"{_label(meta)[:48]:48s} UNSUITABLE: {a['reason']}")
    if failures:
        print(f"\n{len(failures)} track(s) unsuitable for beat analysis:", file=sys.stderr)
        for tid, why in failures:
            print(f"  {tid}: {why}", file=sys.stderr)
    return 0


def _load_all(out_dir: Path) -> dict[str, dict]:
    res = {}
    for p in sorted((out_dir / "analysis").glob("*.json")):
        res[p.stem] = json.loads(p.read_text())
    if not res:
        raise SystemExit(f"no analyses in {out_dir / 'analysis'}; run `analyze` first")
    return res


def cmd_matrix(args) -> int:
    import planner

    out_dir = Path(args.out_dir)
    an = _load_all(out_dir)
    rows = []
    for a_id, a in an.items():
        for b_id, b in an.items():
            if a_id == b_id:
                continue
            p = planner.plan(a, b)
            rows.append(p)
    (out_dir / "matrix.json").write_text(json.dumps(rows, indent=1))
    from collections import Counter

    kinds = Counter(r["kind"] for r in rows)
    reasons = Counter(r["reason"] for r in rows if r["kind"] != "beatmatch")
    print(f"{len(rows)} ordered pairs: {dict(kinds)}")
    print("non-beatmatch reasons:", dict(reasons))
    mix = sorted((r for r in rows if r["kind"] == "beatmatch"), key=lambda r: abs(r["tempo"]["a_speed"] - 1))
    for r in mix[: args.top]:
        print(f"  {r['a']['label'][:38]:38s} -> {r['b']['label'][:38]:38s} speed={r['tempo']['a_speed']:.4f} bars={r['bars']}")
    return 0


def cmd_render(args) -> int:
    import planner
    import render

    audio_dir, out_dir = Path(args.audio_dir), Path(args.out_dir)
    an = _load_all(out_dir)
    ids = args.pairs
    if len(ids) % 2:
        raise SystemExit("render expects pairs of track ids")
    for a_id, b_id in zip(ids[::2], ids[1::2]):
        for tid in (a_id, b_id):
            if tid not in an:
                raise SystemExit(f"track {tid} has no analysis in {out_dir}")
        p = planner.plan(an[a_id], an[b_id])
        t0 = time.perf_counter()
        result = render.render_pair(audio_dir, an[a_id], an[b_id], p, out_dir / "mixes")
        print(f"{p['a']['label'][:36]:36s} -> {p['b']['label'][:36]:36s} {p['kind']:9s} "
              f"{p['reason']:22s} -> {result['files']['mix'].name} ({time.perf_counter() - t0:.1f}s)")
    return 0


def cmd_evaluate(args) -> int:
    import evaluate

    return evaluate.main(Path(args.out_dir))


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("audio_dir")
    a.add_argument("out_dir")
    a.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"])
    a.set_defaults(func=cmd_analyze)
    m = sub.add_parser("matrix")
    m.add_argument("out_dir")
    m.add_argument("--top", type=int, default=25)
    m.set_defaults(func=cmd_matrix)
    r = sub.add_parser("render")
    r.add_argument("audio_dir")
    r.add_argument("out_dir")
    r.add_argument("pairs", nargs="+")
    r.set_defaults(func=cmd_render)
    e = sub.add_parser("evaluate")
    e.add_argument("out_dir")
    e.set_defaults(func=cmd_evaluate)
    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
