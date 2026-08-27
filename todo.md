# LSA Repair TODO

- [x] Fix UI runtime failure caused by unresolved bare package imports in the native WebView.
- [x] Preserve the existing UI while adding a reproducible Vite bundle for Capacitor.
- [x] Rebuild and verify the APK after the UI runtime fix.
- [x] Confirm the final APK checksum and document any behavior that still requires physical Redmi 9 testing.

- [x] Add Android location, notification, and foreground-service manifest declarations.
- [x] Make saving a non-empty API key switch off mock mode.
- [x] Pin text-to-speech plugin to Capacitor-compatible version 5.1.0.
- [x] Add a default notification icon resource reference.
- [x] Synchronize Android web assets and pass the existing verify-build checks.
- [x] Produce a debug APK from the uploaded source.

## Reported bug

The user reports that the installed APK UI is not working. The source currently loads `src/www/index.html` directly and its inline module imports package specifiers such as `@capacitor/core`, `@capacitor/geolocation`, `@capacitor/preferences`, `@capawesome-team/capacitor-android-foreground-service`, and `@capacitor-community/text-to-speech`. A plain WebView cannot resolve those npm package specifiers without a bundling step, so the module can fail before event listeners and boot logic are registered.

## Required minimal solution

Add a Vite build that bundles the unchanged UI/service source, point Capacitor `webDir` at the generated `dist` directory, run the web build before `cap sync android`, then rebuild the APK. Do not redesign the UI or add features.

- [x] Fix ongoing notification so it is actually posted to the Android notification bar on app startup/after the first reading.
- [x] Fix real API request path so a saved API key reaches the native HTTP call and mock data is not silently used.
- [x] Add static checks for notification startup and real-mode request wiring.
- [x] Rebuild and deliver a fresh APK without changing the existing UI.
- [x] Refresh the UI to match the supplied dark mobile reference (sunset hero, bold temp, chat card).
- [x] Generate a reference-matched character/hero scene asset.
- [x] Deliver the refreshed source and APK while preserving all fixed notification/API logic.
- [x] Make the GitHub Android workflow reapply the native foreground-service manifest and notification icon after `npx cap add android`.
- [x] Fix "API connection fail" by improving FortyGuard request reliability and error visibility.
- [x] Replace the current silhouette hero with a more appealing LSA character/mascot.
- [x] Rebuild and verify the final competition-ready APK.
- [x] Fix real FortyGuard API connection failure (verify async result extraction).
- [x] Replace close-up mascot with four distant character reaction scenes (calm, sweating, umbrella, house).
- [x] Ensure character scenes correctly swap based on `risk_level` from real API data.
- [x] Fix null DOM crash in `loadReading` when updating elements that were removed in the dark UI refresh.
- [x] Update persistent Android notification with recent API call details (location, status, temp, risk).
- [x] Verify that saving an API key correctly triggers the real call and notification update.
- [x] Improve the persistent Android notification content to be more polished and readable.
- [x] Ensure the notification clearly summarizes heat status (temp, risk, location) and recent API call status.
- [x] Fix the remaining "Cannot set properties of null" error on the Save screen (shown in the latest screenshot).
- [x] Make the persistent notification even richer and more readable (clearer lines, better hierarchy).
- [x] Rebuild and verify that the Save-triggered real call and notification bar update are both working correctly.
