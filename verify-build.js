#!/usr/bin/env node
/**
 * verify-build.js — run this AFTER `npx cap sync android`, BEFORE
 * installing the APK on a device. Catches the exact failure that
 * happened this round: a build/bundling step silently dropping the
 * app's actual JS logic while keeping the static HTML markup, which
 * produces an app that LOOKS correct (right layout, right CSS) but
 * has no real functionality at all — frozen placeholder numbers, no
 * notifications, because the code that would ever call the real
 * temperature-check / notification / TTS logic never made it into
 * the shipped assets.
 *
 * This is a deliberately dumb, cheap check — grep for known function
 * names inside the ACTUAL files Android will load, not the source
 * tree. A source file being correct proves nothing about what
 * actually got copied into android/app/src/main/assets/public/ during
 * sync — that copy step is exactly where this went wrong last time.
 *
 * Usage: node verify-build.js
 * Exit code 0 = looks correct, non-zero = something is missing, do
 * NOT build/install the APK yet.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ANDROID_ASSETS = 'android/app/src/main/assets/public';

const REQUIRED_MARKERS = [
  'checkTemperature',
  'smartTemperatureCheck',
  'decisionFor',
  'updateStatusNotification',
  'speakIfCritical',
  'FortyGuard',
];

function collectJsAndHtmlFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectJsAndHtmlFiles(full));
    } else if (/\.(js|html|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  console.log(`Checking ${ANDROID_ASSETS} for real app logic...\n`);

  if (!existsSync(ANDROID_ASSETS)) {
    console.error(
      `FAIL: ${ANDROID_ASSETS} does not exist yet.\n` +
      `Run \`npx cap sync android\` first, then re-run this script.`
    );
    process.exit(1);
  }

  const files = collectJsAndHtmlFiles(ANDROID_ASSETS);
  if (files.length === 0) {
    console.error(`FAIL: no .js/.html files found under ${ANDROID_ASSETS} at all.`);
    process.exit(1);
  }

  let combined = '';
  for (const f of files) {
    combined += readFileSync(f, 'utf8');
  }

  const missing = REQUIRED_MARKERS.filter(marker => !combined.includes(marker));

  if (missing.length > 0) {
    console.error(
      `FAIL: the synced Android assets are missing real app logic.\n` +
      `Missing markers: ${missing.join(', ')}\n\n` +
      `This is the exact failure that shipped a broken APK previously —\n` +
      `the HTML/CSS looked correct but the actual JS (checkTemperature,\n` +
      `the notification/TTS wiring, the FortyGuard client) never made it\n` +
      `into the built assets. Common cause: running src/www/index.html\n` +
      `through a bundler (Vite/webpack/etc.) that wasn't configured for\n` +
      `this project's structure. This project does NOT need a bundler —\n` +
      `src/www/index.html is a single self-contained file with a plain\n` +
      `<script type="module"> and relative ../services/*.js imports.\n` +
      `\`npx cap sync android\` should copy src/www/ (this project's\n` +
      `webDir, see capacitor.config.ts) straight into the Android\n` +
      `assets folder, unmodified. Do NOT run \`vite build\`, \`npm run\n` +
      `build\` from some other template, or any other bundling step\n` +
      `before \`cap sync\` — there is no build step for this project,\n` +
      `only sync.\n\n` +
      `DO NOT build/install the APK until this passes.`
    );
    process.exit(1);
  }

  console.log('PASS: all required app-logic markers found in the synced assets.');
  console.log(`Checked ${files.length} file(s) under ${ANDROID_ASSETS}.`);
  console.log('Safe to proceed with `npm run build:android` / installing the APK.');
}

main();
