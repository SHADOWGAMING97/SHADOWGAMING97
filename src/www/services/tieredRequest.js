/**
 * Tiered Request Manager — direct port of app/services/tiered_request.py
 * Same tiers, same cost multipliers, same 0.45%/sec decay formula,
 * same floor. Diff this file against the Python source to verify —
 * that's the intent, not just "equivalent behavior."
 */

export const PRICING_TIERS = {
  instant:  { max_delay_sec: 300,   cost_multiplier: 3.0 },
  fast:     { max_delay_sec: 1800,  cost_multiplier: 1.5 },
  standard: { max_delay_sec: 7200,  cost_multiplier: 1.0 },
  batched:  { max_delay_sec: 86400, cost_multiplier: 0.3 },
};

export const DECAY_PER_SECOND = 0.0045; // 0.45%/sec, per spec
export const MIN_MULTIPLIER = 0.1;       // floor — cost never hits literal zero via decay alone

export function validTier(tier) {
  return Object.prototype.hasOwnProperty.call(PRICING_TIERS, tier);
}

/**
 * The longer the user has already waited within their chosen tier's
 * window, the cheaper the eventual request becomes. Mirrors Python's
 * decayed_multiplier() exactly, including the floor math.
 */
export function decayedMultiplier(tier, waitedSec) {
  if (!validTier(tier)) tier = "standard";
  const base = PRICING_TIERS[tier].cost_multiplier;
  const decay = 1.0 - (DECAY_PER_SECOND * Math.max(0.0, waitedSec));
  const floor = base ? MIN_MULTIPLIER / base : MIN_MULTIPLIER;
  const clampedDecay = Math.max(floor, decay);
  return Math.round(base * clampedDecay * 10000) / 10000; // round to 4dp, same as Python's round(x, 4)
}

/**
 * TieredRequestManager — same (location, tier) -> first-requested-
 * timestamp wait-tracking as the Python class. Persisted wait state
 * lives only in memory per app session, matching the Python
 * implementation's in-memory dict (it was never persisted server-side
 * either — a fresh Flask process also starts with no wait history).
 */
export class TieredRequestManager {
  constructor() {
    this._pendingSince = new Map(); // "location|tier" -> ms timestamp
  }

  _key(location, tier) {
    return `${location}|${tier}`;
  }

  _trackWait(location, tier) {
    const key = this._key(location, tier);
    const now = Date.now() / 1000;
    if (!this._pendingSince.has(key)) {
      this._pendingSince.set(key, now);
      return 0.0;
    }
    return now - this._pendingSince.get(key);
  }

  clearWait(location, tier) {
    this._pendingSince.delete(this._key(location, tier));
  }

  /**
   * Returns the actual cost multiplier for a request right now,
   * accounting for how long it's already been waiting in this tier.
   */
  resolveCost(location, tier) {
    if (!validTier(tier)) tier = "standard";
    const waited = this._trackWait(location, tier);
    const multiplier = decayedMultiplier(tier, waited);
    return {
      tier,
      waited_sec: Math.round(waited * 10) / 10,
      cost_multiplier: multiplier,
      max_delay_sec: PRICING_TIERS[tier].max_delay_sec,
    };
  }
}

// module-level singleton, mirrors the Python pattern
export const tieredManager = new TieredRequestManager();
