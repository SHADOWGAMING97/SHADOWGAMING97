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
 *
 * This replaces the previous "ask once on first install, cache
 * forever, never re-check" behavior — that was flagged as wrong: a
 * stale coordinate could silently persist indefinitely even once the
 * device's actual location had changed or permission been revoked.
 */

import { Geolocation } from '@capacitor/geolocation';
import { storageAdapter } from './storage.js';

const COORDS_KEY = 'lsa_coords';
const COORDS_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days, per explicit instruction

/**
 * Stored shape is JSON: { coordStr: "lat,lng", savedAt: <ms epoch> }
 * — not just the raw "lat,lng" string as before, since expiry needs a
 * timestamp to check against.
 */
export async function getStoredCoords() {
  const raw = await storageAdapter.get(COORDS_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null; // corrupted entry — treat as absent, never throw on a bad cache read
  }
  if (!parsed || typeof parsed.coordStr !== 'string' || typeof parsed.savedAt !== 'number') {
    return null;
  }
  return parsed;
}

/** True if a stored coordinate exists and is still within the 5-day window. */
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

/**
 * @param {object} locationManager - LocationManager instance, for the
 *   last-known-location fallback branch
 * @param {string} userId
 * @returns {Promise<{ coordStr: string, statusLine: string, statusVal: string, trigger: string }>}
 *   trigger is the event_trigger to pass into smartTemperatureCheck,
 *   matching the web version's choice per branch exactly.
 */
export async function resolveLocation(locationManager, userId) {
  // Every open actively checks permission — never skip straight to a
  // cached value without asking first. checkPermissions() itself does
  // not show a system prompt (requestPermissions() does, only if
  // needed below), so this is cheap to do unconditionally.
  let permStatus;
  try {
    permStatus = await Geolocation.checkPermissions();
  } catch (e) {
    // This branch firing on every real-device run (not just genuinely
    // unsupported hardware) is a specific, checkable symptom —
    // Geolocation.checkPermissions() only throws like this when the
    // @capacitor/geolocation plugin itself never got registered into
    // the native Android project (missing from `npx cap sync android`,
    // or added to package.json after the last sync ran). A genuinely
    // permission-denied device does NOT throw here — that path is
    // handled separately below. Logged loudly so this is never
    // silently mistaken for "device doesn't support GPS" again.
    console.error(
      "[Kira] Geolocation.checkPermissions() threw — this almost always " +
      "means @capacitor/geolocation was not synced into the native " +
      "Android project. Run `npx cap sync android` and confirm " +
      "ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION appear in " +
      "AndroidManifest.xml before assuming this device genuinely lacks " +
      "GPS support. See ANDROID_PERMISSIONS.md.",
      e
    );
    return await fallbackChain(locationManager, userId, 'not supported here', '—');
  }

  if (permStatus.location !== 'granted') {
    try {
      permStatus = await Geolocation.requestPermissions();
    } catch (e) {
      permStatus = { location: 'denied' };
    }
  }

  if (permStatus.location === 'granted') {
    // Location is ON right now — always pull a fresh fix, never serve
    // a cached value while it's actively available, per explicit
    // instruction ("if location is on then let use location only to
    // use coordinate").
    try {
      const pos = await Geolocation.getCurrentPosition();
      const coordStr = await storeCoords(pos.coords.latitude, pos.coords.longitude);
      try {
        await locationManager.recordLocation(userId, coordStr);
      } catch (e) { /* local storage write failed — coords are still returned to the caller below */ }
      return { coordStr, statusLine: 'live GPS · saved', statusVal: 'on', trigger: 'location_change' };
    } catch (e) {
      // getCurrentPosition failed even though permission was granted
      // (GPS off at the hardware/OS toggle level despite app
      // permission being granted, timeout, etc.) — fall through to
      // the cached-coordinate chain below, same as a denied permission.
    }
  }

  // Location is OFF (or a live fix failed above) — per explicit
  // instruction, use the stored coordinate ONLY if it's still within
  // its 5-day window; otherwise there's nothing cached worth trusting
  // and we fall through further.
  return await fallbackChain(locationManager, userId, 'off — using last known', 'off');
}

async function fallbackChain(locationManager, userId, statusLine, statusVal) {
  const stored = await getStoredCoords();
  if (stored && (Date.now() - stored.savedAt) <= COORDS_TTL_MS) {
    return { coordStr: stored.coordStr, statusLine, statusVal, trigger: 'morning_check' };
  }

  // Stored coordinate is missing or expired (>5 days old) — try the
  // location manager's own last-known record as a secondary source
  // before giving up to the hardcoded demo city.
  let last = null;
  try {
    last = await locationManager.lastKnownLocation(userId);
  } catch (e) { /* local storage read failed — fall through to hardcoded default */ }

  return {
    coordStr: last || 'phoenix',
    statusLine: stored ? 'saved location expired (5 days)' : statusLine,
    statusVal,
    trigger: 'morning_check',
  };
}
