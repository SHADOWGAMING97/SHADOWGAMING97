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

// Android's ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC constant is 1.
// The installed Capacitor plugin expects an integer here, not the string
// "dataSync". The manifest declares the matching dataSync type.
const SERVICE_TYPE = 1;

let serviceStarted = false;
let serviceStartPromise = null;
let permissionRequested = false;
let channelReady = false;

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
  await ensureNotificationChannel();
}

async function ensureNotificationChannel() {
  if (channelReady) return;
  try {
    await ForegroundService.createNotificationChannel({
      id: FOREGROUND_CHANNEL_ID,
      name: "L'SA status",
      description: 'Ongoing heat monitoring status',
      importance: 2,
    });
    channelReady = true;
  } catch (e) {
    console.warn("[L'SA] notification channel setup failed:", e.message || e);
  }
}

function fmtAgo(fetchedAtSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - fetchedAtSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function buildContent(checkResult, tierUsed) {
  const { data, cached, cost, tokens_charged, reason, error } = checkResult;
  
  // Failure case: No fresh or cached data was returned.
  if (!data) {
    let failMsg = error || 'connection failed';
    if (reason === 'no_qualifying_trigger') failMsg = 'waiting for next check';
    return {
      title: "L'SA: Monitoring Active",
      body: `⚠️ Last attempt failed: ${failMsg}\nUpdated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
  }

  // Success case: We have a valid reading (either live or from cache).
  const risk = data.risk_level.toUpperCase();
  const loc = data.location.includes(',') ? 'Current location' : data.location;
  const time = new Date(data.fetched_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Format as a richer summary. Android 12+ often truncates long bodies,
  // so we keep the most critical info (Temp/Risk) in the title.
  const title = `L'SA: ${data.temp_f}°F — ${risk} RISK`;
  const body = `📍 ${loc}\nStatus: ${cached ? 'Cached data' : 'Live API result'}\nLast updated: ${time}`;
  
  return { title, body };
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
  if (!checkResult) return;
  await ensureNotificationPermission();
  const { title, body } = buildContent(checkResult, tierUsed);

  if (!serviceStarted) {
    await startForegroundNotification(title, body);
    return;
  }

  // Update in place — same service, refreshed content, no restart.
  await ForegroundService.updateForegroundService({
    id: FOREGROUND_NOTIFICATION_ID,
    title,
    body,
  });
}

async function startForegroundNotification(title, body) {
  if (serviceStarted) return;
  if (serviceStartPromise) return serviceStartPromise;
  serviceStartPromise = (async () => {
    await ensureNotificationPermission();
    await ensureNotificationChannel();
    await ForegroundService.startForegroundService({
      id: FOREGROUND_NOTIFICATION_ID,
      title,
      body,
      smallIcon: 'ic_stat_lsa',
      notificationChannelId: FOREGROUND_CHANNEL_ID,
      serviceType: SERVICE_TYPE,
      silent: true,
    });
    serviceStarted = true;
  })();
  try {
    await serviceStartPromise;
  } finally {
    serviceStartPromise = null;
  }
}

export async function startIdleNotification() {
  await startForegroundNotification(
    "L'SA — monitoring active",
    'Waiting for the current heat reading…',
  );
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
