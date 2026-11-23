import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  APP_FUNCTIONS_DIRECTORY,
  APP_FUNCTIONS_PROJECT,
  KSP_GRADLE_PLUGIN_CLASSPATH,
  transformAppBuildGradle,
  transformProjectBuildGradle,
  transformSettingsGradle,
} = require('./withAndroidAppFunctions');

const SAMPLE_SETTINGS_GRADLE = `rootProject.name = 'LoggeRythm'

include ':app'
`;

const SAMPLE_PROJECT_BUILD_GRADLE = `buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
    classpath('com.facebook.react:react-native-gradle-plugin')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
  }
}
`;

const SAMPLE_APP_BUILD_GRADLE = `dependencies {
    implementation("com.facebook.react:react-android")
}
`;

describe('withAndroidAppFunctions', () => {
  it('registers :loggerythm-appfunctions in settings.gradle idempotently', () => {
    const once = transformSettingsGradle(SAMPLE_SETTINGS_GRADLE);
    expect(once).toContain(`include '${APP_FUNCTIONS_PROJECT}'`);
    expect(once).toContain(`new File(rootDir, '${APP_FUNCTIONS_DIRECTORY}')`);

    const twice = transformSettingsGradle(once);
    expect(twice).toBe(once);
  });

  it('adds the KSP Gradle plugin classpath to android/build.gradle idempotently', () => {
    const once = transformProjectBuildGradle(SAMPLE_PROJECT_BUILD_GRADLE);
    expect(once).toContain(`classpath('${KSP_GRADLE_PLUGIN_CLASSPATH}')`);

    const twice = transformProjectBuildGradle(once);
    expect(twice).toBe(once);
  });

  it('fails loudly if kotlin-gradle-plugin anchor is missing in android/build.gradle', () => {
    expect(() => transformProjectBuildGradle('buildscript { dependencies {} }\n')).toThrow(
      'could not find kotlin-gradle-plugin classpath',
    );
  });

  it('adds :loggerythm-appfunctions dependency and Java-resource XML exclusion to android/app/build.gradle idempotently', () => {
    const once = transformAppBuildGradle(SAMPLE_APP_BUILD_GRADLE);
    expect(once).toContain(`implementation(project('${APP_FUNCTIONS_PROJECT}'))`);
    expect(once).toContain("excludes += ['assets/app_functions.xml', 'assets/app_functions_v2.xml']");

    const twice = transformAppBuildGradle(once);
    expect(twice).toBe(once);
  });

  it('fails loudly if dependencies block is missing in android/app/build.gradle', () => {
    expect(() => transformAppBuildGradle('android { compileSdk 36 }\n')).toThrow(
      'could not find dependencies block',
    );
  });
});
