const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const exclusions = (indent) =>
  DOMAINS.map((domain) => `${indent}<exclude domain="${domain}" path="." />`).join('\n');

const LEGACY_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${exclusions('    ')}
</full-backup-content>
`;

const EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
${exclusions('        ')}
    </cloud-backup>
    <device-transfer>
${exclusions('        ')}
    </device-transfer>
</data-extraction-rules>
`;

module.exports = function withNoBackup(config) {
  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) throw new Error('withNoBackup: <application> not found');
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/no_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/no_data_extraction_rules';
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const directory = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'no_backup_rules.xml'), LEGACY_RULES);
      fs.writeFileSync(path.join(directory, 'no_data_extraction_rules.xml'), EXTRACTION_RULES);
      return cfg;
    },
  ]);
};
