#!/usr/bin/env node
// Wires up a release signing config in the generated android/app/build.gradle:
// loads android/keystore.properties and points the release buildType at a
// release signingConfig instead of the template's debug keystore.
// Required because `expo prebuild` regenerates android/ and wipes manual edits.
const fs = require('fs');
const path = require('path');

const ROOT = fs.realpathSync(process.argv[2] || path.join(__dirname, '..'));
const GRADLE_FILE = path.join(ROOT, 'android', 'app', 'build.gradle');
const PROPERTIES_FILE = path.join(ROOT, 'android', 'keystore.properties');

if (!fs.existsSync(PROPERTIES_FILE)) {
  console.error(`error: ${PROPERTIES_FILE} not found`);
  process.exit(1);
}
if (!fs.existsSync(GRADLE_FILE)) {
  console.error(`error: ${GRADLE_FILE} not found`);
  process.exit(1);
}

let s = fs.readFileSync(GRADLE_FILE, 'utf8');

const loadMarker = 'def keystorePropertiesFile = rootProject.file("keystore.properties")';

if (!s.includes(loadMarker)) {
  const loadBlock =
    `${loadMarker}\n` +
    `def keystoreProperties = new Properties()\n` +
    `keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n\n`;
  if (!/^android \{/m.test(s)) {
    console.error(`error: could not find the "android {" block in ${GRADLE_FILE}`);
    process.exit(1);
  }
  s = s.replace(/^(android \{)/m, loadBlock + '$1');
}

if (!s.includes('signingConfig signingConfigs.release')) {
  const signingConfigsStart = s.indexOf('signingConfigs {');
  if (signingConfigsStart === -1) {
    console.error(`error: could not find the "signingConfigs" block in ${GRADLE_FILE}`);
    process.exit(1);
  }
  const debugSigning = s.indexOf('debug {', signingConfigsStart);
  if (debugSigning === -1) {
    console.error(`error: could not find the debug signingConfig in ${GRADLE_FILE}`);
    process.exit(1);
  }
  const debugLineStart = s.lastIndexOf('\n', debugSigning) + 1;
  const indent = s.slice(debugLineStart, debugSigning).match(/[ \t]+$/)[0];
  const releaseBlock =
    `${indent}release {\n` +
    `${indent}    storeFile file(keystoreProperties['storeFile'])\n` +
    `${indent}    storePassword keystoreProperties['storePassword']\n` +
    `${indent}    keyAlias keystoreProperties['keyAlias']\n` +
    `${indent}    keyPassword keystoreProperties['keyPassword']\n` +
    `${indent}}\n`;
  s = s.slice(0, debugLineStart) + releaseBlock + s.slice(debugLineStart);

  const buildTypesStart = s.indexOf('buildTypes {');
  if (buildTypesStart === -1) {
    console.error(`error: could not find the "buildTypes" block in ${GRADLE_FILE}`);
    process.exit(1);
  }
  const releaseBuildType = s.indexOf('release {', buildTypesStart);
  if (releaseBuildType === -1) {
    console.error(`error: could not find the "release" buildType in ${GRADLE_FILE}`);
    process.exit(1);
  }
  const target = 'signingConfig signingConfigs.debug';
  const signingLine = s.indexOf(target, releaseBuildType);
  if (signingLine === -1) {
    console.error(`error: could not find the release signing line in ${GRADLE_FILE}`);
    process.exit(1);
  }
  s = s.slice(0, signingLine) + 'signingConfig signingConfigs.release' + s.slice(signingLine + target.length);
}

fs.writeFileSync(GRADLE_FILE, s);
console.log(`wired release signing in ${GRADLE_FILE}`);