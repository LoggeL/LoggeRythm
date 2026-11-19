# Self-hosted GitHub Actions runner for the "Native Android QA" workflow on
# the Homebox. Runs unprivileged: non-root user, no sudo, no Docker socket,
# no host paths. Only /dev/kvm is passed through (see docker-compose.yml).
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.338.2
ARG RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40

ENV DEBIAN_FRONTEND=noninteractive

# Build tools for the workflow plus the shared libraries the headless Android
# emulator links against (it runs with -no-window, so no X server is needed).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git git-lfs jq unzip zip xz-utils tar gzip file procps \
      build-essential python3 \
      libpulse0 libgl1 libegl1 libnss3 libxcomposite1 libxcursor1 libxi6 libxtst6 \
      libxrandr2 libxdamage1 libxkbcommon0 libxkbfile1 libasound2t64 libdbus-1-3 \
      libx11-6 libfontconfig1 libbz2-1.0 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 --shell /bin/bash runner

WORKDIR /home/runner/actions-runner
RUN curl -fsSL -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
 && echo "${RUNNER_SHA256}  runner.tar.gz" | sha256sum -c - \
 && tar xzf runner.tar.gz \
 && rm runner.tar.gz \
 && ./bin/installdependencies.sh \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R runner:runner /home/runner

COPY --chmod=0755 entrypoint.sh /usr/local/bin/runner-entrypoint

USER runner
ENV ANDROID_HOME=/home/runner/android-sdk \
    ANDROID_SDK_ROOT=/home/runner/android-sdk

ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
