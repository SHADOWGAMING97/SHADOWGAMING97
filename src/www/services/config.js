/**
 * Config — mirrors app/config.py's role as the single source of truth
 * for env-driven settings. There's no .env on a compiled Android app
 * (nothing reads process.env at runtime on-device), so this reads from
 * Capacitor Preferences instead — same "everything else imports FROM
 * here" discipline as the Python version, just backed by device
 * storage instead of a dotenv file.
 *
 * IMPORTANT ASSUMPTION (flagging per the build prompt's instruction
 * to flag assumptions not explicitly covered): the build prompt
 * doesn't specify how the API key should get onto the device — e.g.
 * a settings screen, a build-time constant, or Capacitor's native
 * config injection. This implementation defaults to mock mode and
 * exposes setApiKey()/setMockMode() for a settings screen to call,
 * since hardcoding a real key into the shipped APK's JS bundle would
 * make it trivially extractable by anyone who unzips the APK — the
 * same key-never-in-client-code principle the Flask backend followed
 * by keeping it server-side in .env. A settings-screen entry point is
 * the safer default; wiring an actual UI for it is not built here
 * since the attached frontend has no such screen yet — flagged rather
 * than silently added as a new feature.
 */

import { storageAdapter } from './storage.js';

const KEYS = {
  apiKey: 'config:fortyguard_api_key',
  baseUrl: 'config:fortyguard_base_url',
  forceMockMode: 'config:force_mock_mode',
  cacheTtlTemperature: 'config:cache_ttl_temperature',
  cacheTtlHeatmap: 'config:cache_ttl_heatmap',
  locationRetentionDays: 'config:location_retention_days',
};

const DEFAULTS = {
  baseUrl: 'https://api.fortyguard.com/v1',
  cacheTtlTemperature: 1800,
  cacheTtlHeatmap: 3600,
  locationRetentionDays: 60,
};

export async function loadConfig() {
  const apiKey = (await storageAdapter.get(KEYS.apiKey)) || '';
  const baseUrl = (await storageAdapter.get(KEYS.baseUrl)) || DEFAULTS.baseUrl;
  const forceMockModeRaw = await storageAdapter.get(KEYS.forceMockMode);
  // Default to mock mode (forceMockMode = true) when nothing has been
  // configured yet — same "safe by default" posture as the Python
  // config, where USE_MOCK_DATA is true whenever no key is present.
  const forceMockMode = forceMockModeRaw === null ? true : forceMockModeRaw === 'true';

  const cacheTtlTemperature = parseInt(await storageAdapter.get(KEYS.cacheTtlTemperature), 10) || DEFAULTS.cacheTtlTemperature;
  const cacheTtlHeatmap = parseInt(await storageAdapter.get(KEYS.cacheTtlHeatmap), 10) || DEFAULTS.cacheTtlHeatmap;
  const locationRetentionDays = parseInt(await storageAdapter.get(KEYS.locationRetentionDays), 10) || DEFAULTS.locationRetentionDays;

  const useMockData = forceMockMode || !apiKey;

  return {
    fortyguardApiKey: apiKey,
    fortyguardBaseUrl: baseUrl,
    forceMockMode,
    useMockData,
    cacheTtlTemperature,
    cacheTtlHeatmap,
    locationRetentionDays,
  };
}

export async function setApiKey(apiKey) {
  const trimmed = (apiKey || '').trim();
  await storageAdapter.set(KEYS.apiKey, trimmed);
  // The moment a real key is saved, pivot to real-mode automatically.
  // Previously this required a SEPARATE manual mock-mode toggle flip —
  // saving a key alone did nothing observable, which read as "the app
  // is fake/unresponsive" even after correctly entering credentials.
  // Only auto-disable mock mode for a non-empty key; clearing the key
  // (saving an empty string) should not silently force mock mode back
  // on either way — leave forceMockMode as whatever it already was in
  // that case, since loadConfig()'s useMockData already falls back to
  // mock automatically once fortyguardApiKey is empty regardless of
  // the forceMockMode flag's value.
  if (trimmed) {
    await setMockMode(false);
  }
}

export async function setMockMode(enabled) {
  await storageAdapter.set(KEYS.forceMockMode, enabled ? 'true' : 'false');
}

/** Safe-to-display config summary — never includes the actual key.
 * Mirrors Python's config.status_summary(). */
export async function statusSummary() {
  const config = await loadConfig();
  return {
    mock_mode: config.useMockData,
    api_key_configured: !!config.fortyguardApiKey,
    base_url: config.fortyguardBaseUrl,
    cache_ttl_temperature_sec: config.cacheTtlTemperature,
    cache_ttl_heatmap_sec: config.cacheTtlHeatmap,
    location_retention_days: config.locationRetentionDays,
  };
}
