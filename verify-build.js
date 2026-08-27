#!/usr/bin/env node
/**
 * verify-build.js — run this AFTER `npx cap sync android`, BEFORE
 * installing the APK on a device. Catches three distinct failure
 * modes, each of which has actually happened on this project:
 *
 * 1. MISSING logic — a build/bundling step silently drops the app's
 *    actual JS while keeping the static HTML markup, producing an app
 *    that LOOKS correct but has no real functionality. This is what
 *    shipped once before — a Vite bundling step incompatible with
 *    this project's structure silently dropped everything but the
 *    markup.
 * 2. STALE logic — this project has NO bundler by design. Without a
 *    build step, `npx cap sync android` is the ONLY thing that copies
 *    source changes into what actually gets built. Editing source and
 *    forgetting to re-sync produces an APK with old behavior, even
 *    though every function NAME is still present (so check #1 alone
 *    would incorrectly pass).
 * 3. OUT-OF-WEBDIR imports — `capacitor.config.ts`'s `webDir` is
 *    `src/www`; Capacitor's sync step ONLY copies what's physically
 *    inside that folder. This project's src/www/index.html imports
 *    from src/www/services/ (co-located, INSIDE webDir) specifically
 *    so those imports survive a sync — they did NOT when services/
 *    briefly lived as a sibling of www/ outside webDir, which would
 *    have made every relative import resolve to a folder Capacitor
 *    never populates at all, regardless of any bundler question.
 *    Checked here by confirming every relative import target actually
 *    exists inside src/www/ before sync is even trusted to have run
 *    correctly.
 *
 * Usage: node verify-build.js
 * Exit code 0 = looks correct and fresh, non-zero = do NOT build/install yet.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

const ANDROID_ASSETS = 'android/app/src/main/assets/public';
const SOURCE_WWW = 'src/www';

const REQUIRED_MARKERS = [
  'checkTemperature',
  'smartTemperatureCheck',
  'decisionFor',
  'updateStatusNotification',
  'speakIfCritical',
  'FortyGuard',
];

function collectFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some(ext => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Confirms every relative import (`from '...'` with a `./` or `../`
 * path) inside src/www/ actually resolves to a real file INSIDE
 * src/www/. An import that resolves outside webDir is a structural
 * bug that will silently break after sync regardless of anything
 * else being correct — this is the exact class of bug that made
 * services/ unreachable when it briefly lived outside webDir.
 */
function checkImportsStayInsideWebDir() {
  const problems = [];
  const jsAndHtmlFiles = collectFiles(SOURCE_WWW, ['.js', '.html', '.mjs']);
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;

  for (const file of jsAndHtmlFiles) {
    const content = readFileSync(file, 'utf8');
    let match;
    while ((match = importRe.exec(content)) !== null) {
      const importPath = match[1];
      const resolved = join(dirname(file), importPath);
      const resolvedRelativeToWebDir = relative(SOURCE_WWW, resolved);
      if (resolvedRelativeToWebDir.startsWith('..')) {
        problems.push(
          `${file}: imports '${importPath}', which resolves OUTSIDE ${SOURCE_WWW}/ ` +
          `(-> ${resolved}). Capacitor's sync only copies the contents of webDir ` +
          `(${SOURCE_WWW}, per capacitor.config.ts) — anything imported from outside ` +
          `it will not exist after sync, regardless of whether it exists in this source tree.`
        );
      } else if (!existsSync(resolved)) {
        problems.push(`${file}: imports '${importPath}' -> ${resolved}, which does not exist.`);
      }
    }
  }
  return problems;
}

function checkMissingLogic(assetFiles) {
  let combined = '';
  for (const f of assetFiles) combined += readFileSync(f, 'utf8');
  return REQUIRED_MARKERS.filter(marker => !combined.includes(marker));
}

/** Byte-for-byte compares every file under src/www/ against its
 * synced copy under the Android assets folder. */
function checkStaleness() {
  const problems = [];
  const wwwFiles = collectFiles(SOURCE_WWW, ['.js', '.html', '.mjs']);
  for (const src of wwwFiles) {
    const relPath = relative(SOURCE_WWW, src);
    const target = join(ANDROID_ASSETS, relPath);
    if (!existsSync(target)) {
      problems.push(`${src} -> not found at ${target} (did you run \`npx cap sync android\`?)`);
      continue;
    }
    if (readFileSync(src, 'utf8') !== readFileSync(target, 'utf8')) {
      problems.push(`${src} differs from ${target} — source was edited after the last sync`);
    }
  }
  return problems;
}

function main() {
  console.log('Step 1/3: checking all imports inside src/www/ stay inside webDir...\n');
  const importProblems = checkImportsStayInsideWebDir();
  if (importProblems.length > 0) {
    console.error(
      `FAIL: found import(s) that resolve outside ${SOURCE_WWW}/ (webDir).\n\n` +
      `${importProblems.join('\n\n')}\n\n` +
      `Fix: move the imported file(s) to live INSIDE ${SOURCE_WWW}/ and update the\n` +
      `relative import path to match, so \`npx cap sync android\` actually copies them.\n\n` +
      `DO NOT proceed until this passes.`
    );
    process.exit(1);
  }
  console.log('PASS: all imports resolve inside webDir.\n');

  console.log(`Step 2/3: checking ${ANDROID_ASSETS} contains real app logic...\n`);
  if (!existsSync(ANDROID_ASSETS)) {
    console.error(
      `FAIL: ${ANDROID_ASSETS} does not exist yet.\n` +
      `Run \`npx cap sync android\` first, then re-run this script.`
    );
    process.exit(1);
  }
  const assetFiles = collectFiles(ANDROID_ASSETS, ['.js', '.html', '.mjs']);
  if (assetFiles.length === 0) {
    console.error(`FAIL: no .js/.html files found under ${ANDROID_ASSETS} at all.`);
    process.exit(1);
  }
  const missing = checkMissingLogic(assetFiles);
  if (missing.length > 0) {
    console.error(
      `FAIL: the synced Android assets are missing real app logic.\n` +
      `Missing markers: ${missing.join(', ')}\n\n` +
      `This project does NOT need a bundler — src/www/ is a single self-\n` +
      `contained app with plain relative imports, all living inside webDir.\n` +
      `\`npx cap sync android\` should copy it straight into the Android assets\n` +
      `folder, unmodified. Do NOT run \`vite build\`, \`npm run build\` from some\n` +
      `unrelated template, or any other bundling step before \`cap sync\` — there\n` +
      `is no build step for this project, only sync.\n\n` +
      `DO NOT build/install the APK until this passes.`
    );
    process.exit(1);
  }
  console.log(`PASS: all required markers found across ${assetFiles.length} synced file(s).\n`);

  console.log('Step 3/3: checking synced assets are not stale...\n');
  const stale = checkStaleness();
  if (stale.length > 0) {
    console.error(
      `FAIL: the synced Android assets are STALE — they don't match the\n` +
      `current source. This project has no bundler, so \`npx cap sync android\`\n` +
      `is the ONLY step that copies source changes into what gets built.\n\n` +
      `Mismatches:\n  ${stale.join('\n  ')}\n\n` +
      `Run \`npx cap sync android\` again, then re-run this script.`
    );
    process.exit(1);
  }

  console.log('PASS: synced assets exactly match source.\n');
  console.log('All checks passed — safe to proceed with `npm run build:android` / installing the APK.');
}

main();
