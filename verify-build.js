#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const ANDROID_ASSETS = 'android/app/src/main/assets/public';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? collectFiles(full) : [full];
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(join(DIST, 'index.html'))) {
  fail('dist/index.html is missing. Run npm run build:web first.');
}

const distFiles = collectFiles(DIST);
const textFiles = distFiles.filter((file) => /\.(html|js|css)$/.test(file));
const distText = textFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

for (const marker of ['FortyGuard', "L'SA", 'Heat Intelligence', 'monitoring active', 'ic_stat_lsa', 'heatmap', 'api-key']) {
  if (!distText.includes(marker)) {
    fail(`generated bundle is missing stable app marker: ${marker}`);
  }
}

for (const file of textFiles) {
  const text = readFileSync(file, 'utf8');
  if (text.includes("from '@") || text.includes('from "@') || text.includes("import '@") || text.includes('import "@')) {
    fail(`generated bundle still contains a bare package import: ${file}`);
  }
}

if (!existsSync(ANDROID_ASSETS)) {
  fail(`${ANDROID_ASSETS} is missing. Run npm run build:web && npx cap sync android.`);
}

const androidFiles = collectFiles(ANDROID_ASSETS);
for (const source of distFiles) {
  const rel = relative(DIST, source);
  const target = join(ANDROID_ASSETS, rel);
  if (!existsSync(target)) fail(`Android asset missing after sync: ${rel}`);
  const sourceBytes = readFileSync(source);
  const targetBytes = readFileSync(target);
  if (Buffer.compare(sourceBytes, targetBytes) !== 0) {
    fail(`Android asset is stale: ${rel}`);
  }
}

if (!existsSync(MANIFEST)) fail('AndroidManifest.xml is missing.');
const manifestText = readFileSync(MANIFEST, 'utf8');
for (const marker of [
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'POST_NOTIFICATIONS',
  'FOREGROUND_SERVICE',
  'ACCESS_NETWORK_STATE',
  'WAKE_LOCK',
  'io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService',
  'io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver',
  'foregroundServiceType="dataSync"',
  'stopWithTask="false"',
]) {
  if (!manifestText.includes(marker)) fail(`manifest is missing required marker: ${marker}`);
}

console.log(`PASS: generated bundle contains stable app markers (${textFiles.length} text assets).`);
console.log(`PASS: Android assets match dist exactly (${androidFiles.length} files).`);
console.log('PASS: Android manifest contains location, notification, and foreground-service declarations.');
console.log('Static checks passed. Physical Redmi 9 behavior still requires device testing.');
