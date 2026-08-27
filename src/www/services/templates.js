/**
 * Template Whitelist — exact set from PART 6 of the original spec.
 * Fixed sentences only; the app fills {temp}/{risk_level}, it never
 * invents new phrasing.
 *
 * Extracted from index.html into its own module so there is exactly
 * ONE source of these sentences. Per the final-sprint spec: "TTS
 * speaks the exact same sentence already shown/sent as the
 * notification, never a separately generated line" — that guarantee
 * only holds if there's a single shared function, not two copies that
 * could drift. Both the UI (index.html's decisionMsg/chat) and
 * tts.js import decisionFor() from here.
 */

export const TEMPLATES = {
  extreme_risk:   t => `Don't go outside right now — ${t.temp_f}°F is dangerously hot`,
  high_risk:      t => `Be careful — ${t.temp_f}°F is quite hot`,
  moderate_risk:  t => `Fine to go outside — it's ${t.temp_f}°F, bring water`,
  low_risk:       t => `All normal — ${t.temp_f}°F, nothing to worry about`,
  general_status: t => `It's ${t.temp_f}°F right now, ${t.risk_level} risk`,
  fallback:       t => `Temperature data available — ${t.temp_f}°F`,
};

export function decisionFor(t) {
  // Self-defending, not caller-dependent — this is an exported, shared
  // utility (index.html AND tts.js both call it), so it must not rely
  // on every future call site remembering to guard first. Found during
  // fuzz testing: a null/undefined/malformed reading would otherwise
  // throw here even though the current call sites happen to guard
  // upstream — a new caller that doesn't guard would crash on this
  // alone.
  if (!t || typeof t.risk_level !== "string") {
    return TEMPLATES.fallback({ temp_f: "—" });
  }
  return (TEMPLATES[`${t.risk_level}_risk`] || TEMPLATES.fallback)(t);
}
