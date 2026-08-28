/**
 * Smart Temperature Check — direct port of smart_temperature_check()
 * in app/services/smart_temperature.py. This is the main entry point
 * the UI calls, orchestrating caching + tiering + the FortyGuard
 * client exactly as the Python version does.
 */

import { validTier } from "./tieredRequest.js";

export const VALID_EVENT_TRIGGERS = new Set([
  "outdoor_mention", "morning_check", "location_change", "manual_refresh", "scheduled_check",
]);

/**
 * @param {string} location
 * @param {string} eventTrigger
 * @param {string} tier
 * @param {string} userId
 * @param {object} client - FortyGuard client (real or mock), from fortyguardClient.js
 * @param {object} deps - { temperatureCache, tieredManager, tokenSystem, cacheTtlSeconds }
 *
 * Returns:
 *   { data: {...}, cached: bool, cost: {...}, tokens_charged: number }
 * or:
 *   { data: null, cached: false, reason: "no_qualifying_trigger" }  // no unnecessary call
 */
export async function smartTemperatureCheck(location, eventTrigger, tier, userId, client, deps) {
  const { temperatureCache, tieredManager, tokenSystem, cacheTtlSeconds, skipMockCache = false } = deps;

  if (typeof location !== "string" || !location.trim()) {
    return { data: null, cached: false, reason: "invalid_location" };
  }
  location = location.trim();
  if (!validTier(tier)) tier = "standard";

  const cacheKey = location.toLowerCase();

  const hasRecentCache = await temperatureCache.hasRecent(cacheKey, cacheTtlSeconds);
  const cachedData = hasRecentCache ? await temperatureCache.get(cacheKey) : null;
  const shouldUseCache = hasRecentCache && !(skipMockCache && cachedData?.source === 'mock');

  if (shouldUseCache) {
    tieredManager.clearWait(location, tier);
    const record = tokenSystem.recordUsage(userId, tier, true);
    return {
      data: cachedData,
      cached: true,
      cache_age_sec: Math.round(((await temperatureCache.ageSeconds(cacheKey)) || 0) * 10) / 10,
      tokens_charged: record.cost,
    };
  }

  if (!VALID_EVENT_TRIGGERS.has(eventTrigger)) {
    // No unnecessary call — this IS the efficiency mechanic, not a
    // missing feature. Per spec: "no unnecessary call".
    return { data: null, cached: false, reason: "no_qualifying_trigger" };
  }

  const costInfo = tieredManager.resolveCost(location, tier);

  let result;
  try {
    result = await client.getTemperature(location);
  } catch (e) {
    return { data: null, cached: false, reason: "fetch_failed", error: e.message || String(e) };
  }

  await temperatureCache.save(cacheKey, result, cacheTtlSeconds);
  tieredManager.clearWait(location, tier);
  const record = tokenSystem.recordUsage(userId, tier, false);

  return {
    data: result,
    cached: false,
    cost: costInfo,
    tokens_charged: record.cost,
  };
}
