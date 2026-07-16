module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import top.logge.loggerythm.player.LoggeRythmPlayerPackage;',
        packageInstance: 'new LoggeRythmPlayerPackage()',
      },
    },
  },
};
