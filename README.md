# L'SA — Heat Intelligence (Android APK, zero-server build)

Standalone Capacitor Android port of the LSA_Life_Change Flask
backend + frontend. **No server involved at runtime** — every backend
service (`tiered_request.py`, `cache.py`, `token_system.py`,
`fortyguard_client.py`, `location_manager.py`, `smart_temperature.py`)
has been ported 1:1 to JavaScript and now runs on-device.

## Latest pass: 5 critical fixes from real-device testing

This build was actually installed and tested on a real Redmi 9 —
confirmed working baseline: 3-tab UI, notification appears, heat
figure renders, token/frequency logic, Template Whitelist chat. Five
issues were found on-device and fixed this pass, all verified together
against mock data in one combined test run (10/10 checks passed):

1. **Full-screen bug** — app rendered as a small centered box instead
   of filling the real screen. Fixed with a `Capacitor.isNativePlatform()`
   -driven CSS class set synchronously before first paint, since the
   `@media (max-width:480px)` rule alone proved unreliable in the real
   WebView. Also fixed `body`'s unconditional flex-centering and a
   missing `width:100%` on `.app-frame` that could trap the layout at
   its desktop-preview size even when the media query did fire.
2. **"Looks static/mock-looking"** — traced the full data path with an
   actual test run across all 4 mock risk levels and confirmed
   `checkTemperature()` → `renderScene`/`renderFigure`/`tempNum`/
   `condBadge`/`decisionMsg` is genuinely correctly wired, not a
   placeholder. This was a visual-fidelity symptom of fixes #1 and #5
   combined, not a wiring bug. Did find and fix one real, separate bug
   while tracing this: the "no fresh data" path left the screen frozen
   with zero explanation — now shows an honest status message and a
   "NO DATA" state on true cold start.
3. **Notification dies when app is swiped from Recents** — root cause
   confirmed: missing `android:stopWithTask="false"` in the manifest.
   Also switched from the stale/unmaintained
   `@capacitor-community/foreground-service` to the actively
   maintained `@capawesome-team/capacitor-android-foreground-service`,
   added the `serviceType: 'dataSync'` Android 34+ requires. See
   `ANDROID_PERMISSIONS.md` for the exact manifest `<service>` block —
   this is a manifest-level fix, the JS start-once/update-in-place
   logic was already correct.
4. **Location permission never prompts, always shows "not supported
   here"** — confirmed this only happens when `checkPermissions()`
   *throws*, which specifically means the plugin never synced into the
   native project (a genuinely-denied permission does not throw — that
   path was already handled correctly). Verified all three cases
   separately: unregistered/throws, genuinely-denied, genuinely-granted.
   Added loud `console.error` diagnostics so this failure mode is never
   silently mistaken for "device has no GPS" again.
5. **Figure art too primitive** — redesigned all 4 SVGs as filled
   flat-design human figures (solid torso shapes, rounded bent limbs)
   instead of thin stick-line art. All 4 validated as well-formed XML.
   The 4-state risk mapping, umbrella+water/house-entering details, and
   `.drop`/`.doorglow` animation hooks are unchanged, as instructed.

## Latest pass: null-safety fix + location-permission behavior change

Two changes this round, on top of the 5 critical fixes above:

1. **`decisionFor()` null-safety fix** — found during fuzz testing:
   the shared template function threw on `null`/`undefined`/malformed
   input instead of defending itself, relying entirely on callers to
   guard first. It's an exported utility used by both the UI and
   `tts.js` — a future caller that doesn't guard would have crashed.
   Now self-defends: bad input returns the existing `fallback`
   template instead of throwing. Verified against `null`, `undefined`,
   `{}`, missing `risk_level`, and a wrong-typed `risk_level` — all
   fail closed cleanly; the normal-input case is unchanged.

2. **Location permission — hybrid on-open resolution with a 5-day
   coordinate expiry.** Previously: ask once ever, cache forever, and
   silently reuse that cache indefinitely without re-checking whether
   location was even available. This was a real problem — a stale
   coordinate could persist forever even if the device's actual
   position changed or permission was later revoked. Rewritten
   `geolocation.js` now, on every app open:
   - Always actively checks/requests permission (never skips straight
     to a cached value without asking)
   - If location is ON right now: always pulls a **fresh** GPS fix and
     uses/stores that — never serves a cached value while location is
     actively available, even if the cache is still valid
   - If location is OFF right now: falls back to the last stored
     coordinate, but **only if it's still within a 5-day window**.
     Past that, the stored coordinate is treated as expired and
     rejected — falls through to `LocationManager`'s last-known
     location, then the hardcoded demo city as the absolute last
     resort (not a silent default — a genuine "nothing else is
     available" floor)

   Verified with 5 separate scenarios: location-on-always-fetches-
   fresh (even with a valid cache present), location-off-uses-valid-
   cache, location-off-rejects-expired-cache, fallback-chain-ordering
   (LocationManager before the hardcoded city), and a regression check
   confirming the earlier plugin-not-registered diagnostic (see Issue
   4 above) still works correctly. All 5 passed.

## URGENT — the last built APK ("Kira.apk") did not contain this app's real logic at all

Inspected the actual APK that got built and installed (an APK is a zip
— extracted and read its contents directly, no execution needed).
Found the root cause with certainty:

**The shipped `index.html` inside that APK has the correct layout,
CSS, and structural markup — but its entire `<script type="module">`
block (all the real logic: `checkTemperature`, the notification/TTS
wiring, the FortyGuard client) is completely absent.** In its place
was a reference to a separately bundled, Vite-generated JS chunk that,
on inspection, turned out to be nothing but Vite's own module-preload
runtime boilerplate — none of this project's actual function names
exist anywhere in it. This explains every symptom at once: the "40°F /
Hi Lucky" text is static HTML with nothing left to ever replace it,
and no notification ever fires because the only code that would call
`updateStatusNotification()`/`speakIfCritical()` is inside the missing
script.

**Root cause: this project does not need or want a bundler.**
`src/www/index.html` is a single, self-contained file with a plain
inline `<script type="module">` and relative `../services/*.js`
imports — `npx cap sync android` is supposed to copy `src/www/` (this
project's `webDir`, see `capacitor.config.ts`) straight into the
Android assets folder, completely unmodified. Somewhere in whatever
produced `Kira.apk`, this file was instead run through a Vite build
step (visible from the `modulepreload`/hashed-chunk-filename pattern
in the output), which is designed for a very different kind of
multi-entry JS project structure than this one — and that mismatched
process silently dropped the actual app logic while keeping the
markup, rather than erroring loudly.

**Fixed this round: it is now structurally difficult to repeat this
by accident.** Added `verify-build.js` — checks the ACTUAL files under
`android/app/src/main/assets/public/` (not the source tree, which was
never the problem) for the presence of the app's real function names.
`npm run build:android` now runs this check between `cap sync` and the
actual Gradle build, and stops immediately (non-zero exit, Gradle
never runs) if the logic is missing — verified this against a
reconstruction of exactly the broken build that shipped (correctly
fails) and against this project's real source (correctly passes).

**What to tell whoever builds this next, in plain terms: do not run
`vite build`, `npm run build` from some unrelated template, or any
other bundling/compilation step on this project before `cap sync`.
The only commands this project needs are `npm install`, `npx cap sync
android`, then a normal Gradle/Android Studio build — nothing else.**

## Status bar / "battery, time showing in UI"

Confirmed this is the phone's own Android system status bar (clock,
signal, battery %) — not anything this app renders. No app, native or
web, can remove that on stock Android without a special permission
Google restricts to kiosk/launcher-category apps specifically, so
there is no code fix that makes it disappear entirely. What IS a real,
standard thing professional apps do (added this round, in
`capacitor.config.ts`): configure the status bar to overlay/blend into
the app's own content edge-to-edge (transparent background, app draws
behind it) instead of sitting in a separate opaque colored strip —
this needs `@capacitor/status-bar` installed (`npm install
@capacitor/status-bar`) for the config option to take effect; the
config entry is in place, the dependency install is a one-line step
left for your machine since it's a new package addition.

## Setup (run these on your own machine — real npm/network access needed)

```bash
npm install
npx cap add android
```

`npx cap add android` is the one step I could not run or verify myself
— this sandbox has no npm registry access at all (`npm view` fails
with a 403). This is a completely standard, reliable Capacitor CLI
command though; running it yourself is the correct and safe way to
get a guaranteed-correct Gradle/Android scaffold, rather than me
hand-writing Gradle boilerplate I have no way to verify. See
`ANDROID_PERMISSIONS.md` for the permissions to add after this step.

Then:
```bash
npx cap sync android
npx cap open android    # opens Android Studio — build/run from there
# or, from the command line:
npm run build:android   # produces android/app/build/outputs/apk/debug/app-debug.apk
```

## Project structure

```
src/
  services/           — ported backend logic (see "What was ported" below)
    tieredRequest.js     ← app/services/tiered_request.py
    tokenSystem.js       ← app/services/token_system.py
    fortyguardClient.js  ← app/services/fortyguard_client.py
    cache.js             ← app/services/cache.py
    locationManager.js   ← app/services/location_manager.py
    smartTemperature.js  ← app/services/smart_temperature.py (orchestrator)
    storage.js            (new — Capacitor Preferences adapter)
    config.js              (new — on-device settings, replaces .env)
    geolocation.js         (new — Capacitor Geolocation wrapper)
    templates.js            (extracted — the Template Whitelist, single
                             source of truth shared by the UI and TTS)
    notifications.js        (rewritten — foreground-service ongoing
                             notification, replaces the old one-shot
                             LocalNotifications version)
    tts.js                  (new — high/extreme-only text-to-speech)
    appService.js           (new — wires everything together for the UI)
  www/
    index.html          — the wrapped frontend (Capacitor's webDir)
capacitor.config.ts
package.json
ANDROID_PERMISSIONS.md
```

## What "done" looks like, honestly

**Fully ported and unit-tested** (in plain Node, matching the exact
scenarios I ran against the Python originals, with numeric parity
confirmed): `tieredRequest.js`, `tokenSystem.js`, `cache.js`,
`locationManager.js`, `smartTemperature.js`, and all the pure-logic
parts of `fortyguardClient.js` (`resolveCoords`, `polygonAround`,
`riskLevelFor`, `temperatureFromHeatmap`, the granularity pre-flight
guard, `MockFortyGuardClient`).

**Fully wired but only integration-smoke-tested against temporary
test-only stubs** (not the real Capacitor plugins — see "What I
could not verify" below): `storage.js`, `geolocation.js`,
`notifications.js`, `appService.js`, and the wrapped `index.html`.
The full call chain — bad trigger skips the call, real call costs
tokens, cache hit is free, notification fires with matching data,
settings toggle mock mode correctly — all worked correctly against
the stubs. This is strong evidence the wiring is correct, but it is
not the same as running on a real device.

- **Notifications**: originally a one-shot local notification per
  check. **Upgraded this sprint** to a true ongoing foreground-service
  notification (`@capacitor-community/foreground-service`) — this is
  what actually survives the app being force-closed, which a plain
  `LocalNotifications.schedule()` call does not. Same content as
  before (tier, cached, tokens, time since last call); only the
  delivery mechanism changed.
- **Text-to-Speech**: new this sprint. Speaks only for `high`/`extreme`
  risk — silent for `low`/`moderate` by design, matching the app's
  existing "don't spam the user" posture. Speaks the exact same
  sentence the UI and notification already show, via a shared
  `templates.js` module extracted from the frontend so there's
  genuinely one source of that sentence, not two copies that could
  drift apart.

## What was ported 1:1

Every function in the 6 target Python files above has a named JS
equivalent, same logic, same constants (tier multipliers, the exact
0.45%/sec decay formula, token costs, the 60/80/100 granularity
whitelist, the 7-city coordinate table, the 60-day retention default).
Diff `fortyguardClient.js` against `fortyguard_client.py` side by side
— the structure intentionally mirrors it function-for-function so
that's straightforward.

## What had to be adapted for the platform difference (and why)

- **Storage**: Python's in-memory dicts/files → Capacitor Preferences
  (`storage.js`). One real limitation: Preferences has no native
  "list all keys with this prefix" the way iterating a Python dict
  does — `Cache.purgeExpired()` now needs the caller to pass in which
  keys to check, since there's no way to discover them from storage
  alone. Not a correctness problem (TTL is still checked correctly on
  every read via `hasRecent()`), just a housekeeping-sweep limitation,
  flagged in the code itself.
- **The FortyGuard call**: routed through Capacitor's native
  `CapacitorHttp` bridge instead of `fetch()`, specifically to avoid
  the CORS question entirely (see next section — I could not actually
  test whether it was needed, so I built the safer option rather than
  guessing).
- **API key storage**: Python kept it server-side in `.env`, which has
  no equivalent on a compiled APK. Added a collapsed "advanced"
  settings panel to the Profile tab (password-masked input, save
  button, mock-mode toggle) per your explicit direction that it stay
  out of the visible demo flow.
- **Notifications**: new capability, doesn't exist in the Python
  version at all — `notifications.js` fires/updates one fixed-ID local
  notification per temperature check, mirroring exactly what the
  in-app call-strip shows (tier, cached, tokens, time since last call).

## What I could not verify, and why (flagging honestly rather than guessing)

**This entire sprint's central gap remains true after this round too:
the app has still never run on a real device or emulator.** Everything
below was tested with temporary Node-only stubs standing in for
`@capacitor/preferences`, `@capacitor/geolocation`,
`@capacitor-community/text-to-speech`, and
`@capacitor-community/foreground-service` — good evidence the wiring
and call-order logic is correct (verified: bad trigger skips the call,
real call costs tokens, cache hit is free, foreground service starts
once then updates in place rather than restarting, TTS fires only on
high/extreme and speaks the exact `decisionFor()` sentence, low/
moderate stays silent) — but none of it is a substitute for actually
running `npx cap add android → sync → build → install` and watching it
work on a screen, which is exactly what this sprint's own task list
identifies as the most important remaining gap. I could not run that
command here (no npm registry access in this sandbox — confirmed
again this round) — **this is still the #1 thing to do before the
demo**, not optional polish.

**Whether FortyGuard's API sends CORS headers permissive enough for a
plain WebView `fetch()`.** Unchanged from before — still could not
test it (this sandbox has no network path to `api.fortyguard.com` at
all), so the architecture still routes real calls through
`CapacitorHttp` specifically to make this question irrelevant rather
than gambling on an answer I couldn't confirm.

**The Gradle/Android native project itself.** Still not hand-written,
per your earlier call that this isn't worth the risk for a demo app.
`ANDROID_PERMISSIONS.md` now also documents the foreground-service
manifest entries and TTS/notification-icon asset requirements this
sprint added — read it before running `cap add android`.

**TTS actually producing audible speech on a real device.** The gate
logic (only speak for high/extreme, speak the correct sentence) is
unit-tested and correct. Whether a given device/emulator actually has
a TTS engine and voice installed to speak it with is an OS-level
question this code doesn't control — flagged in
`ANDROID_PERMISSIONS.md` so it isn't mistaken for a code bug during
the verification pass if it doesn't make sound.

**The foreground service surviving an actual force-close.** The JS
call sequence (start once, update in place, stop on request) is
tested and correct. Whether Android's OS-level foreground service
guarantees actually keep it alive through a real force-close on a real
device is exactly the test item #4 in the sprint doc describes — this
still needs to happen on-device, it cannot be confirmed from here.

## Assumptions I made that weren't explicitly covered in the build prompt

1. **Notification style**: a per-event local notification that
   replaces itself (fixed ID) on each check, not a persistent/ongoing
   foreground-service notification. The prompt said "kill-proof status
   information," which read as "survives the WebView being
   backgrounded," not "a permanently pinned notification" — flagging
   this interpretation since a foreground service is a meaningfully
   bigger, more intrusive addition if that's actually wanted instead.
2. **API key delivery to the device**: not covered in the build
   prompt at all. Resolved via your direct answer (collapsed settings
   field, hidden from the demo flow) rather than guessing.
3. **Mock-mode default on a fresh install**: defaults to `true` (same
   safe-by-default posture as the Python config when no key is
   configured), so a fresh APK install never silently attempts real
   API calls before a key has been entered.
