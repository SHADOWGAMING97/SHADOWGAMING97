/**
 * Scheduler — persistent background scheduling for Kira.
 *
 * Manages the "Next API Call" countdown and ensures checks trigger
 * automatically based on the selected tier. State is persisted to
 * Preferences so it survives app restarts.
 */

import { storageAdapter } from './storage.js';
import { PRICING_TIERS } from './tieredRequest.js';

const SCHEDULER_KEY = 'kira_scheduler_state';

// Default state
let state = {
  selectedTier: 'standard',
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
 * Updates the selected tier and recalculates the next call time.
 * If the new tier would have already triggered a call, it sets
 * nextCallAt to 'now'.
 */
export async function setScheduledTier(tier) {
  if (!PRICING_TIERS[tier]) return;
  state.selectedTier = tier;
  
  // Recalculate next call based on last call + new tier delay
  const interval = PRICING_TIERS[tier].max_delay_sec * 1000;
  state.nextCallAt = state.lastCallAt + interval;
  
  // If we've already passed that time, trigger soon
  if (state.nextCallAt < Date.now()) {
    state.nextCallAt = Date.now() + 2000; // trigger in 2s
  }
  
  await save();
}

/**
 * Record that a call just happened (manual or scheduled).
 * Resets the countdown for the next interval.
 */
export async function recordCallSuccess() {
  state.lastCallAt = Date.now();
  const interval = PRICING_TIERS[state.selectedTier].max_delay_sec * 1000;
  state.nextCallAt = state.lastCallAt + interval;
  await save();
}

/**
 * Returns seconds remaining until the next scheduled call.
 */
export function getSecondsRemaining() {
  if (!state.nextCallAt) return 0;
  return Math.max(0, Math.floor((state.nextCallAt - Date.now()) / 1000));
}

/**
 * Checks if a scheduled call is due.
 */
export function isCallDue() {
  return state.nextCallAt > 0 && Date.now() >= state.nextCallAt;
}
