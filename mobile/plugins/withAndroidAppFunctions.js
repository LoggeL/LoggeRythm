const {
  withAppBuildGradle,
  withProjectBuildGradle,
  withSettingsGradle,
} = require('expo/config-plugins');

const APP_FUNCTIONS_PROJECT = ':loggerythm-appfunctions';
const APP_FUNCTIONS_DIRECTORY = '../modules/loggerythm-appfunctions';
const KSP_PLUGIN_VERSION = '2.1.20-2.0.1';
const KSP_GRADLE_PLUGIN_CLASSPATH =
  `com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin:${KSP_PLUGIN_VERSION}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function transformSettingsGradle(source) {
  const start = '// @generated begin withAndroidAppFunctions project';
  const end = '// @generated end withAndroidAppFunctions project';
  const previous = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'g');
  const block = `${start}
include '${APP_FUNCTIONS_PROJECT}'
project('${APP_FUNCTIONS_PROJECT}').projectDir =
    new File(rootDir, '${APP_FUNCTIONS_DIRECTORY}')
${end}`;
  return `${source.replace(previous, '').trimEnd()}\n\n${block}\n`;
}

function transformProjectBuildGradle(source) {
  const start = '// @generated begin withAndroidAppFunctions ksp classpath';
  const end = '// @generated end withAndroidAppFunctions ksp classpath';
  const previous = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    'g',
  );
  const cleaned = source.replace(previous, '');
  const anchor = /([ \t]*classpath\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin['"]\)\s*\n)/;
  if (!anchor.test(cleaned)) {
    throw new Error(
      'withAndroidAppFunctions: could not find kotlin-gradle-plugin classpath in android/build.gradle',
    );
  }
  const block = `    ${start}
    classpath('${KSP_GRADLE_PLUGIN_CLASSPATH}')
    ${end}\n`;
  return cleaned.replace(anchor, `$1${block}`);
}

function transformAppBuildGradle(source) {
  const depStart = '// @generated begin withAndroidAppFunctions dependency';
  const depEnd = '// @generated end withAndroidAppFunctions dependency';
  const previousDep = new RegExp(
    `[ \\t]*${escapeRegExp(depStart)}[\\s\\S]*?${escapeRegExp(depEnd)}\\n?`,
    'g',
  );
  const pkgStart = '// @generated begin withAndroidAppFunctions packaging';
  const pkgEnd = '// @generated end withAndroidAppFunctions packaging';
  const previousPkg = new RegExp(
    `\\n?${escapeRegExp(pkgStart)}[\\s\\S]*?${escapeRegExp(pkgEnd)}\\n?`,
    'g',
  );
  const cleaned = source.replace(previousDep, '').replace(previousPkg, '');
  const anchor = /(dependencies\s*\{\s*\n)/;
  if (!anchor.test(cleaned)) {
    throw new Error(
      'withAndroidAppFunctions: could not find dependencies block in android/app/build.gradle',
    );
  }
  const depBlock = `    ${depStart}
    implementation(project('${APP_FUNCTIONS_PROJECT}'))
    ${depEnd}\n`;
  const pkgBlock = `${pkgStart}
// KSP writes AppFunctions XML into Java resources while :loggerythm-appfunctions
// promotes those files into first-class Android assets. Exclude the duplicate
// Java-resource copies so :app:packageRelease packages each XML file once.
android {
    packagingOptions {
        resources {
            excludes += ['assets/app_functions.xml', 'assets/app_functions_v2.xml']
        }
    }
}
${pkgEnd}`;
  const withDep = cleaned.replace(anchor, `$1${depBlock}`);
  return `${withDep.trimEnd()}\n\n${pkgBlock}\n`;
}

function withAndroidAppFunctions(config) {
  let next = withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidAppFunctions: only Groovy settings.gradle files are supported');
    }
    cfg.modResults.contents = transformSettingsGradle(cfg.modResults.contents);
    return cfg;
  });

  next = withProjectBuildGradle(next, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidAppFunctions: only Groovy root build.gradle files are supported');
    }
    cfg.modResults.contents = transformProjectBuildGradle(cfg.modResults.contents);
    return cfg;
  });

  return withAppBuildGradle(next, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidAppFunctions: only Groovy app build.gradle files are supported');
    }
    cfg.modResults.contents = transformAppBuildGradle(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withAndroidAppFunctions;
module.exports.APP_FUNCTIONS_PROJECT = APP_FUNCTIONS_PROJECT;
module.exports.APP_FUNCTIONS_DIRECTORY = APP_FUNCTIONS_DIRECTORY;
module.exports.KSP_PLUGIN_VERSION = KSP_PLUGIN_VERSION;
module.exports.KSP_GRADLE_PLUGIN_CLASSPATH = KSP_GRADLE_PLUGIN_CLASSPATH;
module.exports.transformSettingsGradle = transformSettingsGradle;
module.exports.transformProjectBuildGradle = transformProjectBuildGradle;
module.exports.transformAppBuildGradle = transformAppBuildGradle;
