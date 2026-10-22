#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_RUN_NUMBER:?GitHub did not provide GITHUB_RUN_NUMBER}"
export ANDROID_VERSION_CODE=$((20000 + GITHUB_RUN_NUMBER))

chmod +x ./gradlew
./gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" \
  :loggerythm_player-native:connectedDebugAndroidTest

./gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" :app:clean :app:assembleRelease \
  -PreactNativeArchitectures=x86_64 \
  -PhermesEnabled=true \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true

npm --prefix .. run qa:android-release -- \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --startup-only \
  --output-dir android-smoke-evidence

cp app/build/outputs/apk/release/app-release.apk LoggeRythm-native-x86_64-qa.apk
sha256sum LoggeRythm-native-x86_64-qa.apk
