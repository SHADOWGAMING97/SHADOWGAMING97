/**
 * Notifications — true ongoing foreground-service notification.
 *
 * CORRECTED THIS PASS: was importing from
 * @capacitor-community/foreground-service, which is the wrong/stale
 * package — confirmed on real-device testing that the resulting
 * notification did not survive the app being swiped from Recents,
 * which is the entire reason to use a foreground service over a
 * plain local notification in the first place. Root cause is at the
 * manifest/service-declaration level, not this file's call logic (the
 * start-once/update-in-place JS sequence below was already correct):
 * a foreground service tied to an Activity stops when its task is
 * removed UNLESS the manifest explicitly declares
 * android:stopWithTask="false" on the service. See
 * ANDROID_PERMISSIONS.md for the exact manifest entry required — that
 * XML change is the actual fix; this file's JS logic did not need to
 * change to fix the survive-task-removal behavior itself.
 *
 * Switched to @capawesome-team/capacitor-android-foreground-service,
 * which is the current, actively maintained plugin (the
 * @capacitor-community/foreground-service package this was built
 * against previously is effectively unmaintained) and is also the one
 * that correctly exposes a serviceType parameter, which newer Android
 * versions (29+/34+) increasingly require declared explicitly rather
 * than inferred — see ANDROID_PERMISSIONS.md for the manifest-level
 * serviceType declaration this also needs.
 */

import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

// Fixed ID so each new check UPDATES the same ongoing notification
// instead of stacking a new one per call — same behavior/intent as
// the previous one-shot version's fixed STATUS_NOTIFICATION_ID.
const FOREGROUND_NOTIFICATION_ID = 4001;
const FOREGROUND_CHANNEL_ID = 'lsa_status_channel';

// dataSync is the correct type for "this service periodically fetches
// and displays data" (temperature checks), as opposed to location,
// mediaPlayback, camera, etc. — Android 34 requires declaring this
// explicitly, both here at call time AND in the manifest (see
// ANDROID_PERMISSIONS.md); one without the other is not sufficient on
// recent Android versions.
const SERVICE_TYPE = 'dataSync';

let serviceStarted = false;
let permissionRequested = false;

export async function ensureNotificationPermission() {
  if (permissionRequested) return;
  permissionRequested = true;
  // foreground-service still relies on the standard Android
  // notification permission (POST_NOTIFICATIONS on API 33+) to show
  // its notification at all — request it the same way the previous
  // LocalNotifications-based version did.
  try {
    const perm = await ForegroundService.checkPermissions();
    if (perm?.display !== 'granted') {
      await ForegroundService.requestPermissions();
    }
  } catch (e) {
    // Some plugin versions expose permission checks differently, or
    // the OS version predates runtime notification permissions
    // entirely (pre-Android 13) — never let a permission-check
    // failure block the rest of the app from working.
    console.warn("[L'SA] notification permission check failed:", e.message || e);
  }
}

function fmtAgo(fetchedAtSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - fetchedAtSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function buildContent(checkResult, tierUsed) {
  const { data, cached, cost, tokens_charged } = checkResult;
  const tierLabel = cached ? 'cached' : (cost?.tier || tierUsed);
  const body = cached
    ? `${data.temp_f}°F · cached · ${tokens_charged} tokens · ${fmtAgo(data.fetched_at)}`
    : `${data.temp_f}°F · ${tierLabel} tier · ${tokens_charged} tokens · ${fmtAgo(data.fetched_at)}`;
  return {
    title: `L'SA — ${data.risk_level.toUpperCase()} risk in ${data.location}`,
    body,
  };
}

/**
 * Call this right after every smartTemperatureCheck() result, mirroring
 * exactly what the call-strip UI element renders (tier, cached, tokens,
 * time since last call) — see loadReading() in the wrapped frontend.
 *
 * Starts the foreground service on the first call, then updates the
 * same ongoing notification on every subsequent call rather than
 * restarting the service each time (restarting would cause a visible
 * flicker and is unnecessary — the service just needs its notification
 * content refreshed).
 */
export async function updateStatusNotification(checkResult, tierUsed) {
  if (!checkResult || !checkResult.data) return;
  const { title, body } = buildContent(checkResult, tierUsed);

  if (!serviceStarted) {
    await ForegroundService.startForegroundService({
      id: FOREGROUND_NOTIFICATION_ID,
      title,
      body,
      smallIcon: 'ic_launcher_foreground', // using default icon to ensure startup success
      notificationChannelId: FOREGROUND_CHANNEL_ID,
      serviceType: SERVICE_TYPE, // required at call time on Android 34+, must
                                  // match the manifest declaration — see
                                  // ANDROID_PERMISSIONS.md
      silent: true, // this is a status display, not an alert — TTS (tts.js) already
                     // covers the "genuinely important, make noise" case for high/extreme
                     // risk; the ongoing notification itself should stay quiet on updates
                     // so it doesn't ping on every routine cached check.
    });
    serviceStarted = true;
    return;
  }

  // Update in place — same service, refreshed content, no restart.
  await ForegroundService.updateForegroundService({
    id: FOREGROUND_NOTIFICATION_ID,
    title,
    body,
  });
}

/**
 * Explicit stop — not wired to any UI action yet (the spec didn't ask
 * for a "stop tracking" button), but exposed so one can be added
 * without another round of plumbing. Also useful for a future
 * "pause alerts" toggle.
 */
export async function clearStatusNotification() {
  if (!serviceStarted) return;
  try {
    await ForegroundService.stopForegroundService();
  } finally {
    serviceStarted = false;
  }
}
