/**
 * Storage — Capacitor Preferences-backed adapter, matching the
 * get/set/remove shape the port's services expect (see cache.js's
 * InMemoryStorageAdapter for the same interface used in tests).
 *
 * Preferences is a simple key-value store (like SharedPreferences on
 * Android) — sufficient for cache entries, token balance/history, and
 * location history at this app's scale. The build prompt notes SQLite
 * is "a reasonable candidate" for token history specifically if it
 * grows large or needs querying; this implementation keeps history as
 * one JSON array per user under one Preferences key, which is simple
 * and correct at hackathon-demo scale but would need to move to
 * SQLite (via @capacitor-community/sqlite) if token history grows
 * large enough that reading/writing the whole array on every update
 * becomes a real cost — flagged here rather than silently building
 * SQLite support that can't be tested in this environment either.
 */

import { Preferences } from '@capacitor/preferences';

export class CapacitorStorageAdapter {
  async get(key) {
    const { value } = await Preferences.get({ key });
    return value; // null if not present, matches InMemoryStorageAdapter's contract
  }

  async set(key, value) {
    await Preferences.set({ key, value });
  }

  async remove(key) {
    await Preferences.remove({ key });
  }
}

export const storageAdapter = new CapacitorStorageAdapter();
