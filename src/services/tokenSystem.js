/**
 * Token System — direct port of app/services/token_system.py
 * Same token costs, same savings formula, same loyalty thresholds.
 *
 * Persistence differs from Python: the Flask version kept history in
 * an in-memory dict per-process (lost on restart, same as any Flask
 * dev server). Here, history is handed to the caller to persist via
 * the storage layer (Capacitor Preferences/SQLite) — this class
 * itself stays storage-agnostic so it's testable in plain Node
 * without a device. See storage.js for the persisted wrapper.
 */

export const TOKEN_COSTS = {
  instant_call: 5,
  fast_call: 2,
  standard_call: 1,
  batched_call: 1,
  cached_hit: 0,
};

export const TIER_TO_COST_KEY = {
  instant: "instant_call",
  fast: "fast_call",
  standard: "standard_call",
  batched: "batched_call",
};

export class TokenSystem {
  constructor() {
    this._history = new Map(); // userId -> array of records
    this._balance = new Map(); // userId -> number
  }

  _costFor(tier, cached) {
    if (cached) return TOKEN_COSTS.cached_hit;
    const key = TIER_TO_COST_KEY[tier] || "standard_call";
    return TOKEN_COSTS[key];
  }

  recordUsage(userId, tier, cached) {
    const cost = this._costFor(tier, cached);
    const record = { tier, cached, cost, ts: Date.now() / 1000 };
    if (!this._history.has(userId)) this._history.set(userId, []);
    this._history.get(userId).push(record);
    const currentBalance = this._balance.has(userId) ? this._balance.get(userId) : 100; // 100 starting tokens, matches Python
    this._balance.set(userId, currentBalance - cost);
    return record;
  }

  getBalance(userId) {
    return this._balance.has(userId) ? this._balance.get(userId) : 100;
  }

  getHistory(userId) {
    return [...(this._history.get(userId) || [])];
  }

  /**
   * Real savings: what it WOULD have cost if every request had been
   * an uncached instant_call, vs what it actually cost.
   */
  calculateSavings(userId) {
    const history = this._history.get(userId) || [];
    if (history.length === 0) {
      return { total_possible_cost: 0, actual_cost: 0, saved: 0, requests: 0 };
    }
    const instantCost = TOKEN_COSTS.instant_call;
    const totalPossible = history.length * instantCost;
    const actual = history.reduce((sum, r) => sum + r.cost, 0);
    return {
      total_possible_cost: totalPossible,
      actual_cost: actual,
      saved: totalPossible - actual,
      requests: history.length,
    };
  }

  cacheHitRate(userId) {
    const history = this._history.get(userId) || [];
    if (history.length === 0) return 0.0;
    const hits = history.filter(r => r.cached).length;
    return Math.round((hits / history.length) * 1000) / 10; // matches Python's round(x, 1) on a percentage
  }

  batchedTierUsagePct(userId) {
    const history = this._history.get(userId) || [];
    if (history.length === 0) return 0.0;
    const batched = history.filter(r => r.tier === "batched").length;
    return Math.round((batched / history.length) * 1000) / 10;
  }

  /**
   * Pitch-level per spec, but the calculation itself is real and
   * testable — only actual token-crediting/redemption UX is out of
   * scope, same caveat as the Python version.
   */
  calculateLoyaltyReward(userId) {
    const batchedPct = this.batchedTierUsagePct(userId);
    const cachePct = this.cacheHitRate(userId);

    if (batchedPct > 70) return { badge: "eco_saver_badge", bonus_tokens: 20 };
    if (cachePct > 50) return { badge: "efficient_user_badge", bonus_tokens: 10 };
    return null;
  }

  /**
   * Adds tokens — no real payment processing (pitch-slide item per
   * scope freeze, same as Python), but the balance mechanic itself is
   * real so the UI has something functional to demo against.
   */
  topUp(userId, amount) {
    const newBalance = this.getBalance(userId) + amount;
    this._balance.set(userId, newBalance);
    return newBalance;
  }
}

export const tokenSystem = new TokenSystem();
