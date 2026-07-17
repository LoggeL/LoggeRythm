module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import top.logge.loggerythm.updater.LoggeRythmUpdaterPackage;',
        packageInstance: 'new LoggeRythmUpdaterPackage()',
      },
    },
  },
};
