const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const EXCLUDED_FILES = ['stations.tcd', 'meta.json'];

// A directory mirrors everything under "files/" inside Android Auto Backup,
// so an out-of-band copy of the tide database is excluded from both Google
// cloud backups and device-to-device transfers. "recent-stations.json" lives
// beside them but is intentionally NOT excluded and keeps getting backed up.
const RULES_DIR_REL = path.join('app', 'src', 'main', 'res', 'xml');
const DATA_EXTRACTION_FILE = 'data_extraction_rules.xml';
const FULL_BACKUP_FILE = 'backup_rules.xml';

// expo-secure-store persists the GitHub access token (see src/lib/github-token.ts)
// in the "SecureStore" SharedPreferences, encrypted with an Android Keystore key
// that is not restored across devices. Backing it up would leave a copy that can
// never be decrypted, so it is excluded here. The app.json entry for
// expo-secure-store sets configureAndroidBackup: false and relies on these rules.
const EXCLUDE_SECURE_STORE_SHARED_PREF = '    <exclude domain="sharedpref" path="SecureStore"/>';

function excludeEntries() {
  // Android Lint (FullBackupContent / DataExtractionRules) rejects an `<exclude>`
  // that is not covered by an `<include>` in the same domain, so the whole file
  // domain is included first and only the tide database files are carved out.
  // This keeps every other file (e.g. recent-stations.json) backed up as before.
  return `    <include domain="file" path="."/>\n${EXCLUDED_FILES.map(
    (name) => `    <exclude domain="file" path="tide-times/${name}"/>`
  ).join('\n')}`;
}

function excludeSharedPrefEntries() {
  // Including the whole sharedpref domain first makes the exclusion explicit and
  // keeps every other preference backed up as before.
  return `    <include domain="sharedpref" path="."/>\n${EXCLUDE_SECURE_STORE_SHARED_PREF}`;
}

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludeEntries()}
${excludeSharedPrefEntries()}
  </cloud-backup>
  <device-transfer>
${excludeEntries()}
${excludeSharedPrefEntries()}
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludeEntries()}
${excludeSharedPrefEntries()}
</full-backup-content>
`;

const withBackupRulesFiles = (config) =>
  withDangerousMod(config, [
    'android',
    (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, RULES_DIR_REL);
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, DATA_EXTRACTION_FILE), DATA_EXTRACTION_RULES);
      fs.writeFileSync(path.join(xmlDir, FULL_BACKUP_FILE), FULL_BACKUP_CONTENT);
      return config;
    },
  ]);

const withBackupRulesManifest = (config) =>
  withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    if (application) {
      application.$['android:dataExtractionRules'] = `@xml/${DATA_EXTRACTION_FILE.replace(/\.xml$/, '')}`;
      application.$['android:fullBackupContent'] = `@xml/${FULL_BACKUP_FILE.replace(/\.xml$/, '')}`;
    }
    return config;
  });

const withAndroidBackupRules = (config) => {
  config = withBackupRulesFiles(config);
  return withBackupRulesManifest(config);
};

module.exports = withAndroidBackupRules;