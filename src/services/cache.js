/**
 * Cache — direct port of app/services/cache.py semantics (TTL-based,
 * has_recent()/age_seconds() style checks), but backed by a pluggable
 * storage adapter instead of an in-memory Python dict, per the build
 * prompt's instruction to move this to on-device storage.
 *
 * The storage adapter is injected (see storage.js for the Capacitor
 * Preferences-backed implementation) so this class itself stays
 * testable in plain Node with a simple in-memory adapter — same
 * pattern used throughout this port to keep logic testable without
 * a device.
 */

/** Minimal in-memory storage adapter — used for testing and as the
 * fallback if Capacitor Preferences isn't available for some reason.
 * Mirrors the shape storage.js's real adapter implements. */
export class InMemoryStorageAdapter {
  constructor() {
    this._store = new Map();
  }
  async get(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  async set(key, value) {
    this._store.set(key, value);
  }
  async remove(key) {
    this._store.delete(key);
  }
}

export class Cache {
  /**
   * @param {object} storageAdapter - object with async get(key),
   *   set(key, value), remove(key) — value is a JSON-serializable object
   * @param {string} namespace - prefix so multiple caches (temperature,
   *   heatmap) can share one underlying storage without key collisions
   */
  constructor(storageAdapter, namespace) {
    this._storage = storageAdapter;
    this._namespace = namespace;
  }

  _storageKey(key) {
    return `cache:${this._namespace}:${key}`;
  }

  async _readEntry(key) {
    const raw = await this._storage.get(this._storageKey(key));
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return null; // corrupted entry — treat as absent rather than throwing
    }
  }

  async hasRecent(key, maxAge) {
    const entry = await this._readEntry(key);
    if (!entry) return false;
    const age = (Date.now() / 1000) - entry.cachedAt;
    return age <= maxAge;
  }

  async get(key) {
    const entry = await this._readEntry(key);
    return entry ? entry.value : null;
  }

  async save(key, value, ttl = null) {
    const entry = { value, cachedAt: Date.now() / 1000, ttl };
    await this._storage.set(this._storageKey(key), JSON.stringify(entry));
  }

  async ageSeconds(key) {
    const entry = await this._readEntry(key);
    if (!entry) return null;
    return (Date.now() / 1000) - entry.cachedAt;
  }

  async purgeExpired(allKeys) {
    // Storage adapters here don't expose a native "list keys" the way
    // an in-memory dict does — caller passes the set of keys it knows
    // about (same limitation Capacitor Preferences has: no native
    // prefix-scan). Optional housekeeping, not required for TTL
    // correctness since hasRecent() already re-checks age on every read.
    let removed = 0;
    const now = Date.now() / 1000;
    for (const key of allKeys) {
      const entry = await this._readEntry(key);
      if (entry && entry.ttl !== null && (now - entry.cachedAt) > entry.ttl) {
        await this._storage.remove(this._storageKey(key));
        removed++;
      }
    }
    return removed;
  }

  async clear(allKeys) {
    for (const key of allKeys) {
      await this._storage.remove(this._storageKey(key));
    }
  }
}
