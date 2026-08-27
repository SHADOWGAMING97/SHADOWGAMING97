/**
 * Location Manager — direct port of app/services/location_manager.py
 * Same 60-day retention cutoff, same last-known-location fallback
 * logic, same explicit delete-all. Storage-adapter-backed like cache.js.
 */

export class LocationManager {
  /**
   * @param {object} storageAdapter - async get/set/remove, same shape as cache.js
   * @param {number} retentionDays - defaults to 60, matches Python's config.LOCATION_RETENTION_DAYS default
   */
  constructor(storageAdapter, retentionDays = 60) {
    this._storage = storageAdapter;
    this._retentionDays = retentionDays;
  }

  _key(userId) {
    return `location_history:${userId}`;
  }

  async _readHistory(userId) {
    const raw = await this._storage.get(this._key(userId));
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return []; // corrupted data — treat as empty rather than throwing
    }
  }

  async _writeHistory(userId, entries) {
    await this._storage.set(this._key(userId), JSON.stringify(entries));
  }

  async recordLocation(userId, location) {
    if (typeof location !== "string" || !location.trim()) {
      return { saved: false, reason: "invalid_location" };
    }
    const entry = { location: location.trim(), ts: Date.now() / 1000 };
    const entries = await this._readHistory(userId);
    entries.push(entry);
    await this._writeHistory(userId, entries);
    await this.purgeOld(userId);
    return { saved: true, entry };
  }

  async getHistory(userId) {
    await this.purgeOld(userId);
    return this._readHistory(userId);
  }

  async purgeOld(userId) {
    const cutoff = (Date.now() / 1000) - (this._retentionDays * 86400);
    const entries = await this._readHistory(userId);
    const kept = entries.filter(e => e.ts >= cutoff);
    const removed = entries.length - kept.length;
    if (removed > 0) await this._writeHistory(userId, kept);
    return removed;
  }

  async lastKnownLocation(userId) {
    const history = await this.getHistory(userId);
    return history.length > 0 ? history[history.length - 1].location : null;
  }

  /** Explicit user-requested wipe — privacy control, not just retention decay. */
  async deleteAll(userId) {
    const entries = await this._readHistory(userId);
    const count = entries.length;
    await this._storage.remove(this._key(userId));
    return count;
  }
}
