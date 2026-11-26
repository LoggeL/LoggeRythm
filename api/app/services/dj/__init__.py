"""DJ transitions: beat-matched, tempo-ramped transitions between two tracks.

Pipeline (all heavy work runs in a ``python -m app.services.dj.worker`` subprocess,
never inside the API process):

* ``analysis``  Beat This! activations -> tempo grid, meter, onset phase, bars, cues
* ``planner``   ordered pair A -> B: ``beatmatch`` or ``crossfade`` with an explicit reason
* ``render``    the transition clip: A's tail time-stretched onto B's grid (Signalsmith
                Stretch), B entering on the downbeat, bass swap, limiter -> MP3
* ``service``   per-file analysis cache, clip cache, background job queue

The Android player plays the clip on a second deck and joins it to the real tracks
at both ends, so all musical alignment is sample-exact on the server.
"""
