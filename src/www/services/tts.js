/**
 * Text-to-Speech — high/extreme risk only, per the final-sprint spec.
 * Low and moderate risk stay silent by design: this matches the
 * existing "silent by default, don't spam the user" principle
 * already in the app — TTS is for genuinely important alerts, not
 * routine updates.
 *
 * Speaks the EXACT same sentence decisionFor() produces for the UI
 * and notification — imported from templates.js, never a separately
 * generated line. This is the same discipline the Template Whitelist
 * itself follows: fixed sentences only, nothing free-generated.
 */

import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { decisionFor } from './templates.js';

const SPEAKABLE_RISK_LEVELS = new Set(['high', 'extreme']);

/**
 * @param {object} reading - a temperature reading with at least
 *   { risk_level, temp_f } — same shape as checkTemperature()'s
 *   result.data, which is what callers should pass in.
 */
export async function speakIfCritical(reading) {
  if (!reading || typeof reading.risk_level !== 'string') return;
  if (!SPEAKABLE_RISK_LEVELS.has(reading.risk_level)) {
    return; // low/moderate: stay silent, on purpose
  }

  const message = decisionFor(reading);

  try {
    await TextToSpeech.speak({ text: message, rate: 1.0 });
  } catch (e) {
    // TTS failing (engine unavailable, language pack missing, etc.)
    // must never break the temperature-check flow it's attached to —
    // same fire-and-forget posture as notifications.js already uses.
    console.warn("[Kira] TTS failed:", e.message || e);
  }
}
