#!/usr/bin/env bash
set -euo pipefail

cd /home/runner/actions-runner

: "${RUNNER_URL:?RUNNER_URL is not set (expected https://github.com/LoggeL/LoggeRythm)}"
: "${RUNNER_NAME:?RUNNER_NAME is not set}"
: "${RUNNER_LABELS:?RUNNER_LABELS is not set}"

if [ ! -e /dev/kvm ]; then
  echo "FATAL: /dev/kvm is missing in the container; the emulator QA step cannot run. Pass it with devices: [/dev/kvm]." >&2
  exit 1
fi
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "FATAL: /dev/kvm is not read/writable for uid $(id -u) ($(ls -l /dev/kvm)). Check the host permissions (expected crw-rw-rw-)." >&2
  exit 1
fi

if [ ! -f .runner ]; then
  : "${RUNNER_TOKEN:?Runner is not registered yet and RUNNER_TOKEN is empty. Create one (valid 1 h) with: gh api -X POST repos/LoggeL/LoggeRythm/actions/runners/registration-token -q .token}"
  ./config.sh --unattended --replace \
    --url "$RUNNER_URL" \
    --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS" \
    --work _work
fi

exec ./run.sh
