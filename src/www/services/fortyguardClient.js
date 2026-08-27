/**
 * FortyGuard Client — direct port of app/services/fortyguard_client.py
 *
 * IMPORTANT PLATFORM DIFFERENCE (flagged per the build prompt's
 * instruction to test rather than assume): whether FortyGuard's API
 * sends CORS headers permissive enough for a WebView's plain fetch()
 * could NOT be verified — this environment's own network egress
 * blocks api.fortyguard.com entirely (confirmed: an OPTIONS/HEAD
 * request to the real host returned a proxy-level 403 with
 * "x-deny-reason: host_not_allowed" BEFORE reaching FortyGuard at
 * all, same as when the Python backend's real-mode call was tested
 * previously). There is no network path from this sandbox to
 * FortyGuard, so this could not be empirically confirmed either way.
 *
 * Built the safe way regardless: getTemperature()/getHeatmap() below
 * call through Capacitor's @capacitor/http (or @capacitor-community/http
 * on older Capacitor versions) native HTTP plugin, NOT the browser's
 * fetch(). Native HTTP requests are not subject to browser CORS policy
 * at all — this sidesteps the question entirely rather than gambling
 * on an unconfirmed assumption. If it later turns out FortyGuard does
 * send permissive CORS headers, this approach still works identically;
 * it's strictly the safer choice, not a more complex one.
 */

import { CapacitorHttp } from '@capacitor/core';

export const MAX_FETCH_BYTES = 300_000; // matches Python's bounded-read cap (informational here —
                                          // CapacitorHttp doesn't expose raw chunked reads the way
                                          // urllib does, so this constant documents intent; response
                                          // size is bounded by FortyGuard's own payload size in practice
                                          // for the small polygons this client requests)
export const REQUEST_TIMEOUT_MS = 8000; // matches Python's REQUEST_TIMEOUT_SEC = 8

// FortyGuard needs real coordinates, not place names — it has no
// geocoding of its own. This is a small bridge table for demo cities;
// a real product needs a real geocoding step (Google/Mapbox/OSM)
// before this call, which is explicitly out of scope for this build.
// Exact same 7 entries as the Python KNOWN_CITY_COORDS.
export const KNOWN_CITY_COORDS = {
  phoenix: [33.4484, -112.0740],
  tempe: [33.4255, -111.9400],
  austin: [30.2672, -97.7431],
  denver: [39.7392, -104.9903],
  miami: [25.7617, -80.1918],
  seattle: [47.6062, -122.3321],
  "new york": [40.7128, -74.0060],
};

// how wide (degrees) the small polygon around a point should be —
// small enough to stay a cheap query, big enough for the heatmap
// endpoint to return more than a single degenerate cell
export const POLYGON_HALF_WIDTH_DEG = 0.01;

// FortyGuard's real API only accepts these exact granularity values
// (confirmed live in the Python backend: 50 was rejected as a 422).
// Anything else must not be sent — validate before ever composing a
// payload. DO NOT change these values without a fresh live
// confirmation — see the build prompt's explicit instruction not to
// touch this.
export const VALID_GRANULARITIES = [60, 80, 100];

export class FortyGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "FortyGuardError";
  }
}

/**
 * Accepts either 'lat,lng' or a known demo city name. Returns
 * [lat, lng] or null if it can't resolve — caller decides how to
 * fail (never silently guesses a location). Direct port of Python's
 * _resolve_coords().
 */
export function resolveCoords(location) {
  if (typeof location !== "string" || !location.trim()) return null;
  if (location.includes(",")) {
    const parts = location.split(",");
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return [lat, lng];
  }
  const key = location.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KNOWN_CITY_COORDS, key)
    ? KNOWN_CITY_COORDS[key]
    : null;
}

/** Direct port of Python's _polygon_around(). */
export function polygonAround(lat, lng, halfWidth = POLYGON_HALF_WIDTH_DEG) {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[
          [lng - halfWidth, lat - halfWidth],
          [lng + halfWidth, lat - halfWidth],
          [lng + halfWidth, lat + halfWidth],
          [lng - halfWidth, lat + halfWidth],
          [lng - halfWidth, lat - halfWidth],
        ]],
      },
    }],
  };
}

/**
 * FortyGuard returns raw heat data, not a risk classification — that
 * judgment call is L'sA's, so it's made here explicitly rather than
 * invented by the third party. Direct port of Python's _risk_level_for().
 */
export function riskLevelFor(tempF) {
  if (tempF >= 110) return "extreme";
  if (tempF >= 95) return "high";
  if (tempF >= 80) return "moderate";
  return "low";
}

/**
 * Defensive normalization — a third-party response's exact field
 * names/shape are never trusted blindly. Averages whatever per-cell
 * temperature values are present; missing/malformed data degrades to
 * safe defaults rather than throwing. Direct port of Python's
 * _temperature_from_heatmap().
 */
export function temperatureFromHeatmap(raw, location) {
  const temps = [];
  const features = (raw && raw.features) || [];
  for (const feature of features) {
    const props = (feature && typeof feature === "object" && feature.properties) || {};
    const val = props.temp_f ?? props.temperature ?? props.lst;
    if (typeof val === "number" && !Number.isNaN(val)) temps.push(val);
  }

  const avgTemp = temps.length > 0
    ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10
    : (raw && raw.avg_temp_f) || 0;

  return {
    location,
    temp_f: avgTemp,
    // condition is ALWAYS "unknown" — FortyGuard's real API only
    // returns temperature and risk data, never rain/cloud/storm.
    // Do not fabricate weather conditions here (per build prompt).
    condition: "unknown",
    risk_level: avgTemp ? riskLevelFor(avgTemp) : "unknown",
    humidity: raw ? raw.humidity : undefined,
    fetched_at: Date.now() / 1000,
    source: "live_api",
  };
}

export class RealFortyGuardClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  _headers() {
    return { "api-key": this.apiKey, "Content-Type": "application/json" };
  }

  async _callHeatmapApi(polygonAoi, granularity = 100) {
    if (!VALID_GRANULARITIES.includes(granularity)) {
      throw new FortyGuardError(
        `invalid granularity ${JSON.stringify(granularity)} — FortyGuard only ` +
        `accepts ${JSON.stringify(VALID_GRANULARITIES)}, refusing to burn a call on a request that will 422`
      );
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const payload = {
      polygon_aoi: polygonAoi,
      date_time: {
        start_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        start_time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        filter_type: 1,
      },
      granularity,
    };

    let response;
    try {
      // CapacitorHttp — native platform HTTP request, bypasses
      // WebView/browser CORS entirely. See module docstring above.
      response = await CapacitorHttp.post({
        url: `${this.baseUrl}/heatmap`,
        headers: this._headers(),
        data: payload,
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS,
      });
    } catch (e) {
      throw new FortyGuardError(`FortyGuard request failed: ${e.message || e}`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new FortyGuardError(`FortyGuard API error ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`);
    }

    // CapacitorHttp auto-parses JSON responses into response.data;
    // guard anyway in case a plugin version returns a raw string.
    if (typeof response.data === "string") {
      try {
        return JSON.parse(response.data);
      } catch (e) {
        throw new FortyGuardError(`FortyGuard returned unparseable response: ${e.message}`);
      }
    }
    return response.data;
  }

  async getTemperature(location) {
    const coords = resolveCoords(location);
    if (coords === null) {
      throw new FortyGuardError(
        `can't resolve '${location}' to coordinates — pass 'lat,lng' or a known demo city name`
      );
    }
    const [lat, lng] = coords;
    const polygon = polygonAround(lat, lng);
    const data = await this._callHeatmapApi(polygon, 60);
    return temperatureFromHeatmap(data, location);
  }

  async getHeatmap(area) {
    const coords = resolveCoords(area);
    if (coords === null) {
      throw new FortyGuardError(
        `can't resolve '${area}' to coordinates — pass 'lat,lng' or a known demo city name`
      );
    }
    const [lat, lng] = coords;
    // wider polygon for a proper heatmap view vs. the tight point-lookup above
    const polygon = polygonAround(lat, lng, 0.05);
    return this._callHeatmapApi(polygon, 100);
  }
}

/**
 * Deterministic-ish but varied mock data — good enough to exercise
 * every code path (extreme/high/moderate/low risk) without a real
 * key or a real network call. Direct port of Python's
 * MockFortyGuardClient, including the same 6 profiles in the same
 * order (so the same location string produces the same mock reading
 * on both platforms, in case that ever matters for a side-by-side demo).
 */
const MOCK_PROFILES = [
  { temp_f: 112, risk_level: "extreme", humidity: 15 },
  { temp_f: 98, risk_level: "high", humidity: 30 },
  { temp_f: 85, risk_level: "moderate", humidity: 45 },
  { temp_f: 72, risk_level: "low", humidity: 50 },
  { temp_f: 65, risk_level: "low", humidity: 80 },
  { temp_f: 40, risk_level: "moderate", humidity: 90 },
];

/** Matches Python's `abs(hash(location)) % len(profiles)` behavior
 * closely enough for demo purposes — Python's hash() isn't stable
 * across runs anyway (hash randomization), so exact cross-platform
 * parity was never actually guaranteed by the original either. This
 * uses a simple stable string hash so the JS side is at least
 * internally consistent within itself. */
function stableHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class MockFortyGuardClient {
  async getTemperature(location) {
    const idx = stableHash(location) % MOCK_PROFILES.length;
    const profile = MOCK_PROFILES[idx];
    return {
      location,
      temp_f: profile.temp_f,
      condition: "unknown", // matches real client — FortyGuard has no condition data
      risk_level: profile.risk_level,
      humidity: profile.humidity,
      fetched_at: Date.now() / 1000,
      source: "mock",
    };
  }

  async getHeatmap(area) {
    const idx = stableHash(area) % MOCK_PROFILES.length;
    const profile = MOCK_PROFILES[idx];
    return {
      type: "FeatureCollection",
      area,
      avg_temp_f: profile.temp_f,
      risk_level: profile.risk_level,
      features: Array.from({ length: 4 }, () => ({
        type: "Feature",
        properties: { temp_f: profile.temp_f + (Math.floor(Math.random() * 7) - 3) },
        geometry: { type: "Point", coordinates: [0.0, 0.0] },
      })),
      source: "mock",
      fetched_at: Date.now() / 1000,
    };
  }
}

/**
 * Factory — returns the right client based on config, mirroring
 * Python's get_client(). Config comes from the storage/config module
 * (see config.js), not hardcoded here.
 */
export function getClient(config) {
  if (config.useMockData) return new MockFortyGuardClient();
  return new RealFortyGuardClient(config.fortyguardApiKey, config.fortyguardBaseUrl);
}
