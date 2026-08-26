# Android permissions this app needs

`npx cap add android` generates `android/app/src/main/AndroidManifest.xml`
with Capacitor's own defaults. Add these permissions to it (inside the
`<manifest>` tag, above `<application>`) for the plugins this app uses:

```xml
<!-- Geolocation plugin -->
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- Foreground Service plugin (this is what actually survives
     the app being force-closed / swiped from Recents) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

## CRITICAL — the actual fix for "notification disappears when app is swiped from Recents"

Confirmed on real-device testing that the notification did NOT survive
task removal. Root cause: **by default, a foreground service tied to
an Activity stops when its task is removed from Recents**, unless the
service is explicitly declared otherwise in the manifest. The JS
start-once/update-in-place call sequence in `notifications.js` was
already correct — this is a manifest-only fix.

Inside `<application>`, add (or if Capacitor/the plugin's own install
step already added a `<service>` block for
`@capawesome-team/capacitor-android-foreground-service`, edit it to
match this rather than duplicating it):

```xml
<service
    android:name="io.capawesome.capacitorjs.plugins.foregroundservice.ForegroundService"
    android:enabled="true"
    android:exported="false"
    android:stopWithTask="false"
    android:foregroundServiceType="dataSync" />
```

Two things must both be true, not just one:
- `android:stopWithTask="false"` — this is very likely THE bug fix.
  Without it, Android tears down the service the moment the task is
  swiped away regardless of anything else being correct.
- `android:foregroundServiceType="dataSync"` — must match the
  `serviceType: 'dataSync'` value passed in
  `notifications.js`'s `startForegroundService()` call. Android 34+
  requires both the manifest declaration AND the call-time value to
  agree; having only one is not sufficient on recent Android versions.

The exact `android:name` (the fully-qualified service class) depends
on the installed plugin version — confirm it against what
`@capawesome-team/capacitor-android-foreground-service`'s own install
step generates or documents, since a class-name mismatch here would
silently fail rather than error obviously.

<!-- Internet — required for the direct-to-FortyGuard native HTTP call -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

`INTERNET`/`ACCESS_NETWORK_STATE` are almost certainly already present
in Capacitor's generated manifest by default (every Capacitor app can
reach its own WebView content), but confirm they're there since this
app's real-mode FortyGuard calls depend on it.

## Foreground service notification icon

`notifications.js` references `smallIcon: 'ic_stat_lsa'` — this must
exist as a drawable resource at
`android/app/src/main/res/drawable/ic_stat_lsa.png` (or `.xml` for a
vector) after running `cap add android`. Android will fail to show the
notification (or show a blank/default icon) without it. Any simple
white-on-transparent icon works for a status-bar notification; this
wasn't designed as part of this sprint since it's an asset, not logic.

## Text-to-Speech language/engine availability

`@capacitor-community/text-to-speech` depends on a TTS engine and
language pack being installed on the device (Android ships with
Google's TTS engine by default on most devices, but not universally on
every emulator image). If TTS silently doesn't speak on-device during
the verification pass, check Android Settings → Accessibility →
Text-to-speech output before assuming the wiring is broken — the JS
layer's gate logic (`speakIfCritical`) is unit-tested and confirmed
correct; whether the OS actually has a voice available to use it with
is an on-device environment question, not something this code controls.

These are standard, well-documented Capacitor plugin requirements —
not hand-written boilerplate at risk of being subtly wrong the way a
full Gradle scaffold would be. Cross-reference against each plugin's
own README if anything looks off:
- https://capacitorjs.com/docs/apis/geolocation
- https://github.com/capacitor-community/text-to-speech
- https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/android-foreground-service

## "Not supported here" always showing, permission prompt never appears

Confirmed on real-device testing. This has a specific, checkable
cause: `Geolocation.checkPermissions()` only throws (which is what
triggers the "not supported" fallback text in `geolocation.js`) when
`@capacitor/geolocation` never actually got registered into the native
Android project — it does NOT throw for a genuinely-denied permission,
that case is already handled correctly elsewhere in the same function.

Before assuming this is a real device limitation, verify:
1. `@capacitor/geolocation` is listed in `package.json` (it is, in
   this project) AND `npm install` was run again after any
   `package.json` change, AND `npx cap sync android` was run
   afterward — a plugin added to `package.json` without a subsequent
   sync will not be in the native project.
2. `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` actually appear
   in the generated `android/app/src/main/AndroidManifest.xml` after
   sync. If they're missing, the sync did not pick up the plugin —
   re-run `npm install && npx cap sync android` and check again.

`geolocation.js` now logs a loud `console.error` with this exact
diagnosis (visible in `adb logcat` or Android Studio's Logcat panel)
if this failure mode happens again, specifically so it's never
silently mistaken for a real "this device has no GPS" case.

