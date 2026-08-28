/**
 * Scheduler — persistent background scheduling for Kira.
 * Supports both pricing tiers and user-defined custom intervals.
 */

import { storageAdapter } from './storage.js';
import { PRICING_TIERS } from './tieredRequest.js';

const SCHEDULER_KEY = 'kira_scheduler_state';

// Default state
let state = {
  selectedTier: 'standard',
  customIntervalMin: 0, // 0 means use tier-based interval
  lastCallAt: 0,
  nextCallAt: 0,
};

let initialized = false;
let listeners = new Set();

export async function initScheduler() {
  if (initialized) return;
  const raw = await storageAdapter.get(SCHEDULER_KEY);
  if (raw) {
    try {
      state = { ...state, ...JSON.parse(raw) };
    } catch (e) {
      console.warn("[Kira] scheduler state corrupt, resetting");
    }
  }
  if (!state.nextCallAt) {
    await recalculateNextCall();
  }
  initialized = true;
  notify();
}

async function save() {
  await storageAdapter.set(SCHEDULER_KEY, JSON.stringify(state));
  notify();
}

function notify() {
  for (const l of listeners) l(state);
}

export function subscribe(l) {
  listeners.add(l);
  if (initialized) l(state);
  return () => listeners.delete(l);
}

export function getSchedulerState() {
  return state;
}

/**
 * Sets a custom interval in minutes. 0 means revert to tier-based.
 */
export async function setCustomInterval(minutes) {
  state.customIntervalMin = Math.max(0, parseInt(minutes) || 0);
  await recalculateNextCall();
}

/**
 * Updates the selected tier.
 */
export async function setScheduledTier(tier) {
  if (!PRICING_TIERS[tier]) return;
  state.selectedTier = tier;
  await recalculateNextCall();
}

async function recalculateNextCall() {
  let intervalMs;
  if (state.customIntervalMin > 0) {
    intervalMs = state.customIntervalMin * 60 * 1000;
  } else {
    intervalMs = PRICING_TIERS[state.selectedTier].max_delay_sec * 1000;
  }
  
  state.nextCallAt = state.lastCallAt + intervalMs;
  
  // If we've already passed that time or never called, trigger soon
  if (state.nextCallAt < Date.now()) {
    state.nextCallAt = Date.now() + 5000; // trigger in 5s
  }
  
  await save();
}

/**
 * Record that a call just happened.
 */
export async function recordCallSuccess() {
  state.lastCallAt = Date.now();
  let intervalMs;
  if (state.customIntervalMin > 0) {
    intervalMs = state.customIntervalMin * 60 * 1000;
  } else {
    intervalMs = PRICING_TIERS[state.selectedTier].max_delay_sec * 1000;
  }
  state.nextCallAt = state.lastCallAt + intervalMs;
  await save();
}

export function getSecondsRemaining() {
  if (!state.nextCallAt) return 0;
  return Math.max(0, Math.floor((state.nextCallAt - Date.now()) / 1000));
}

export function isCallDue() {
  return state.nextCallAt > 0 && Date.now() >= state.nextCallAt;
}
