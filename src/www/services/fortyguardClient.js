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
export const MAX_API_REQUESTS_PER_READING = 30; // one submit + up to 29 status checks
export const STATUS_POLL_DELAY_MS = 3000;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function toFahrenheit(value, unit = 'c') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return unit === 'f' ? numeric : (numeric * 9 / 5) + 32;
}

function extractMeanCelsius(statsData) {
  const stats = statsData || {};
  const temperatureStats = stats.temperature_stats || stats.Temperature_stats || stats.temperatureStats || {};
  return temperatureStats.mean ?? temperatureStats.Mean ?? stats.mean ?? stats.Mean ?? null;
}

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
  const mapData = raw?.map_data || raw;
  const features = (mapData && mapData.features) || [];
  for (const feature of features) {
    const props = (feature && typeof feature === "object" && feature.properties) || {};
    if (props.temp_f != null || props.temperature_f != null) {
      const value = Number(props.temp_f ?? props.temperature_f);
      if (Number.isFinite(value)) temps.push(value);
      continue;
    }
    const celsius = props.temperature ?? props.tcm ?? props.lst ?? props.value;
    const value = toFahrenheit(celsius, 'c');
    if (value != null) temps.push(value);
  }

  const meanC = extractMeanCelsius(raw?.stats_data);
  const meanF = raw?.avg_temp_f != null
    ? Number(raw.avg_temp_f)
    : toFahrenheit(meanC, 'c');
  const avgTemp = temps.length > 0
    ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10
    : (Number.isFinite(meanF) ? Math.round(meanF * 10) / 10 : 0);

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
  constructor(apiKey, baseUrl, http = CapacitorHttp, options = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.http = http;
    this.pollDelayMs = options.pollDelayMs ?? STATUS_POLL_DELAY_MS;
    this.maxApiRequests = options.maxApiRequests ?? MAX_API_REQUESTS_PER_READING;
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
      analytic_type: 'tcm',
      granularity,
    };

    const requestOptions = {
      headers: this._headers(),
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    };

    let response;
    try {
      response = await this.http.post({
        url: `${this.baseUrl}/heatmap`,
        ...requestOptions,
        data: payload,
      });
    } catch (e) {
      throw new FortyGuardError(`Network error: ${e.message || e}`);
    }

    const submission = this._parseResponse(response, 'submission');
    const activityId = submission?.data?.activity_id || submission?.activity_id;
    if (!activityId) {
      // Keep compatibility with a legacy synchronous response if a server
      // returns the final map directly instead of an activity task.
      if (submission?.map_data || submission?.features || submission?.stats_data) return submission;
      throw new FortyGuardError('API submission did not return an activity_id');
    }

    // FortyGuard heatmap generation is asynchronous. A POST only submits the
    // task; the final map and statistics arrive from the status endpoint.
    for (let attempt = 0; attempt < this.maxApiRequests - 1; attempt += 1) {
      await wait(this.pollDelayMs);
      let statusResponse;
      try {
        statusResponse = await this.http.get({
          url: `${this.baseUrl}/status/${encodeURIComponent(activityId)}`,
          ...requestOptions,
        });
      } catch (e) {
        throw new FortyGuardError(`Status network error: ${e.message || e}`);
      }

      // Per official docs: 404 means "Activity not found or temporarily
      // unavailable immediately after submission." This is a normal
      // non-terminal state during the first few seconds.
      if (statusResponse.status === 404) continue;

      const statusPayload = this._parseResponse(statusResponse, 'status');
      const statusData = statusPayload?.data || statusPayload;
      const status = String(statusData?.status || statusPayload?.message || '').toLowerCase();
      if (status === 'completed' || status === 'succeeded' || status === 'complete') {
        return statusData.result || statusData;
      }
      if (status === 'failed' || status === 'error') {
        throw new FortyGuardError(`API activity ${activityId} failed`);
      }
    }

    throw new FortyGuardError(`API activity ${activityId} is still processing after ${this.maxApiRequests} requests`);
  }

  _parseResponse(response, label) {
    if (!response || response.status < 200 || response.status >= 300) {
      const detail = typeof response?.data === 'string' ? response.data : JSON.stringify(response?.data || {});
      throw new FortyGuardError(`API ${label} error ${response?.status || 'unknown'}: ${detail.slice(0, 140)}`);
    }
    if (typeof response.data === 'string') {
      try {
        return JSON.parse(response.data);
      } catch (e) {
        throw new FortyGuardError(`API ${label} returned invalid JSON`);
      }
    }
    return response.data || {};
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
    // We call the heatmap endpoint with granularity 60 for temperature lookup
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
