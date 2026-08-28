/**
 * App Service — wires every ported service together and exposes the
 * SAME function names/shapes the original frontend already calls
 * (checkTemperature, getTokenBalance, getTokenSavings, etc.) so the
 * HTML file's own JS needs minimal changes: swap the old apiFetch()-
 * based implementations for calls into this module, keep every
 * caller site the same.
 */

import { loadConfig, statusSummary as _statusSummary, setApiKey as _setApiKey, setMockMode as _setMockMode } from './config.js';
import { getClient } from './fortyguardClient.js';
import { Cache } from './cache.js';
import { CapacitorStorageAdapter } from './storage.js';
import { TieredRequestManager } from './tieredRequest.js';
import { TokenSystem } from './tokenSystem.js';
import { LocationManager } from './locationManager.js';
import { smartTemperatureCheck } from './smartTemperature.js';
import { resolveLocation as _resolveLocation } from './geolocation.js';
import { updateStatusNotification, ensureNotificationPermission, startIdleNotification } from './notifications.js';
import { speakIfCritical } from './tts.js';

// Module-level singletons, mirroring the Python backend's singleton
// pattern (temperature_cache, tiered_manager, token_system module
// globals). Each Cache instance gets its own storage namespace so
// temperature and heatmap entries never collide under one key.
const storage = new CapacitorStorageAdapter();
const temperatureCache = new Cache(storage, 'temperature');
const heatmapCache = new Cache(storage, 'heatmap');
const tieredManager = new TieredRequestManager();
const tokenSystem = new TokenSystem();
const locationManager = new LocationManager(storage);

export const USER_ID = 'lucky'; // demo user_id — no auth, matches the Flask backend's current state exactly

/**
 * Same signature/behavior as the old checkTemperature() in
 * frontend/index.html, but calls the local service layer instead of
 * fetch()-ing a Flask backend. No mock-fallback try/catch needed here
 * the way the old apiFetch() had one — mock vs. real is decided once
 * by config.useMockData, not by a failed network call.
 */
export async function checkTemperature(location, eventTrigger, tier) {
  const config = await loadConfig();
  const client = getClient(config);
  const result = await smartTemperatureCheck(location, eventTrigger, tier, USER_ID, client, {
    temperatureCache,
    tieredManager,
    tokenSystem,
    cacheTtlSeconds: config.cacheTtlTemperature,
    skipMockCache: !config.useMockData,
  });

  // Native notification — the capability a browser page never had.
  // Fire-and-forget; a notification failure should never block the
  // in-app UI from updating.
  // Native notification — the capability a browser page never had.
  // Fire-and-forget; a notification failure should never block the
  // in-app UI from updating. Now updates even on failure to show recent
  // call details in the notification bar.
  updateStatusNotification(result, tier).catch(() => {});

  // TTS — same trigger point as the notification, gated to
  // high/extreme only inside speakIfCritical() itself. Also
  // fire-and-forget: TTS failing must never block the UI.
  if (result.data) {
    speakIfCritical(result.data).catch(() => {});
  }

  return result;
}

export async function getTokenBalance() {
  return tokenSystem.getBalance(USER_ID);
}

export async function getTokenSavings() {
  return {
    savings: tokenSystem.calculateSavings(USER_ID),
    cache_hit_rate_pct: tokenSystem.cacheHitRate(USER_ID),
    batched_tier_usage_pct: tokenSystem.batchedTierUsagePct(USER_ID),
    loyalty_reward: tokenSystem.calculateLoyaltyReward(USER_ID),
  };
}

export async function resolveLocation() {
  return _resolveLocation(locationManager, USER_ID);
}

export async function recordLocation(location) {
  return locationManager.recordLocation(USER_ID, location);
}

export async function getLastKnownLocation() {
  return locationManager.lastKnownLocation(USER_ID);
}

export async function initNotifications() {
  await ensureNotificationPermission();
  try {
    await startIdleNotification();
  } catch (e) {
    console.warn("[Kira] startup foreground notification failed:", e.message || e);
  }
}

// ---- Settings-screen config functions (Profile tab API key field) ----
export const statusSummary = _statusSummary;
export const setApiKey = _setApiKey;
export const setMockMode = _setMockMode;
