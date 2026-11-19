# Homebox runner for Native Android QA

`Native Android QA` runs on this self-hosted runner (label `homebox-android`)
for pushes to `master`/`release/**` and manual runs. Pull requests stay on
GitHub's `ubuntu-latest`: the repository is public and PR code must not run on
the Homebox, which also hosts the live server. Fork PR workflows additionally
need approval for every external contributor (repository setting).

## Isolation

- Unprivileged container: user `runner` (uid 1001), no sudo, `cap_drop: ALL`,
  `no-new-privileges`, no Docker socket, no host paths, own bridge network.
- Only `/dev/kvm` is passed through, for the emulator QA step.
- Limits: 12 CPUs, 18 GB RAM, so the live services keep their share.
- The named volume `runner-home` keeps the registration, the tool cache,
  Gradle, npm, the Android SDK and the AVDs between runs.

## Operate (on the Homebox, in `~/loggerythm-android-runner`)

The files there are copies of this directory.

```bash
docker compose build && docker compose up -d   # after changing these files
docker logs -f loggerythm-android-runner       # "Listening for Jobs" when idle
```

Re-register (new volume or removed runner): create a token, valid for one hour,
put it into `.env` as `RUNNER_TOKEN=...`, start the container, then delete
`.env` again.

```bash
gh api -X POST repos/LoggeL/LoggeRythm/actions/runners/registration-token -q .token
```

Without a registration and without a token the container exits with an error
that says so. It also refuses to start without a read/writable `/dev/kvm`.
