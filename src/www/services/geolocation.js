/**
 * Geolocation — hybrid on-open resolution, per explicit instruction:
 *   - Every app open ACTIVELY checks/requests location permission —
 *     never silently reuses a cached coordinate without checking
 *     whether location is currently available.
 *   - If location is ON right now: always pull a fresh GPS fix and
 *     use/store that (never serve a stale cached value while location
 *     is actively available).
 *   - If location is OFF right now: fall back to the last stored
 *     coordinate, but ONLY if it's still within a 5-day window. Past
 *     that, there is nothing usable from cache — falls through to the
 *     last-known-location manager, then the hardcoded demo city as
 *     the absolute last resort (not a silent default choice — a
 *     genuine "nothing else is available" floor).
 */

import { Geolocation } from '@capacitor/geolocation';
import { storageAdapter } from './storage.js';

const COORDS_KEY = 'lsa_coords';
const COORDS_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export async function getStoredCoords() {
  const raw = await storageAdapter.get(COORDS_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed.coordStr !== 'string' || typeof parsed.savedAt !== 'number') {
    return null;
  }
  return parsed;
}

export async function hasValidStoredCoords() {
  const stored = await getStoredCoords();
  if (!stored) return false;
  return (Date.now() - stored.savedAt) <= COORDS_TTL_MS;
}

export async function storeCoords(lat, lng) {
  const str = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  await storageAdapter.set(COORDS_KEY, JSON.stringify({ coordStr: str, savedAt: Date.now() }));
  return str;
}

export async function resolveLocation(locationManager, userId) {
  // Wait a bit for bridge readiness on cold start
  await new Promise(r => setTimeout(r, 1000));

  let permStatus;
  try {
    permStatus = await Geolocation.checkPermissions();
  } catch (e) {
    // Retry once after another delay if it threw (bridge might still be initializing)
    try {
      await new Promise(r => setTimeout(r, 2000));
      permStatus = await Geolocation.checkPermissions();
    } catch (retryError) {
      console.error("[Kira] Geolocation.checkPermissions() threw:", retryError);
      return await fallbackChain(locationManager, userId, 'not supported here', '—');
    }
  }

  // Actively request permission if not already granted
  if (permStatus.location !== 'granted') {
    try {
      permStatus = await Geolocation.requestPermissions();
    } catch (e) {
      console.warn("[Kira] Geolocation.requestPermissions() failed:", e);
      permStatus = { location: 'denied' };
    }
  }

  if (permStatus.location === 'granted') {
    try {
      const pos = await Geolocation.getCurrentPosition();
      const coordStr = await storeCoords(pos.coords.latitude, pos.coords.longitude);
      try {
        await locationManager.recordLocation(userId, coordStr);
      } catch (e) {}
      return { coordStr, statusLine: 'live GPS · saved', statusVal: 'on', trigger: 'location_change' };
    } catch (e) {
      console.warn("[Kira] getCurrentPosition failed despite permission:", e);
    }
  }

  return await fallbackChain(locationManager, userId, 'off — using last known', 'off');
}

async function fallbackChain(locationManager, userId, statusLine, statusVal) {
  const stored = await getStoredCoords();
  if (stored && (Date.now() - stored.savedAt) <= COORDS_TTL_MS) {
    return { coordStr: stored.coordStr, statusLine, statusVal, trigger: 'morning_check' };
  }

  let last = null;
  try {
    last = await locationManager.lastKnownLocation(userId);
  } catch (e) {}

  return {
    coordStr: last || 'phoenix',
    statusLine: stored ? 'saved location expired (5 days)' : statusLine,
    statusVal,
    trigger: 'morning_check',
  };
}
