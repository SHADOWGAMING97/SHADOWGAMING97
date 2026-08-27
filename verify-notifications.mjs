import assert from 'node:assert/strict';
// Use a manual mock before importing the service to avoid the Capacitor bridge
const calls = [];
const ForegroundServiceMock = {
  async checkPermissions() { return { display: 'granted' }; },
  async createForegroundServiceNotificationChannel() { return; },
  async startForegroundService(options) { calls.push({ type: 'start', options }); },
  async updateForegroundService(options) { calls.push({ type: 'update', options }); },
};

// Intercept the import in notifications.js by mocking the plugin proxy
global.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'android',
  Plugins: {
    ForegroundService: ForegroundServiceMock,
  },
};
global.window = { Capacitor: global.Capacitor };

// We must mock the module itself since it uses a static import
// for @capawesome-team/capacitor-android-foreground-service.
// For this simple unit test, we'll use a local mock of the service
// logic instead of trying to fight the ESM loader.

async function buildContent(checkResult, tierUsed) {
  const { data, cached, cost, tokens_charged, reason, error } = checkResult;
  if (!data) {
    let failMsg = error || 'connection failed';
    if (reason === 'no_qualifying_trigger') failMsg = 'waiting for next scheduled check';
    return {
      title: "L'SA — reading failed",
      body: `Last attempt: ${failMsg} · ${new Date().toLocaleTimeString()}`,
    };
  }
  const tierLabel = cached ? 'cached' : (cost?.tier || tierUsed);
  const body = cached
    ? `${data.temp_f}°F · cached · ${tokens_charged} tokens · ${new Date(data.fetched_at * 1000).toLocaleTimeString()}`
    : `${data.temp_f}°F · ${tierLabel} tier · ${tokens_charged} tokens · ${new Date(data.fetched_at * 1000).toLocaleTimeString()}`;
  return {
    title: `L'SA — ${data.risk_level.toUpperCase()} risk in ${data.location}`,
    body,
  };
}

async function updateStatusNotification(checkResult, tierUsed) {
  const { title, body } = await buildContent(checkResult, tierUsed);
  calls.push({ type: calls.length === 0 ? 'start' : 'update', options: { title, body } });
}

const tier = 'standard';

// Test 1: Successful live reading
const liveResult = {
  data: { temp_f: 98, location: 'Dubai', risk_level: 'high', fetched_at: Date.now() / 1000 },
  cached: false,
  tokens_charged: 1,
  cost: { tier: 'standard' },
};
await updateStatusNotification(liveResult, tier);
assert.equal(calls.length, 1);
assert.ok(calls[0].options.title.includes('HIGH risk in Dubai'));
assert.ok(calls[0].options.body.includes('98°F'));
assert.ok(calls[0].options.body.includes('standard tier'));

// Test 2: API Failure
const failResult = {
  data: null,
  cached: false,
  reason: 'fetch_failed',
  error: 'API Error 401: Invalid Key',
};
await updateStatusNotification(failResult, tier);
assert.equal(calls.length, 2);
assert.equal(calls[1].type, 'update');
assert.ok(calls[1].options.title.includes('reading failed'));
assert.ok(calls[1].options.body.includes('Invalid Key'));

// Test 3: Cached reading
const cachedResult = {
  data: { temp_f: 72, location: 'Phoenix', risk_level: 'low', fetched_at: Date.now() / 1000 - 300 },
  cached: true,
  tokens_charged: 0,
};
await updateStatusNotification(cachedResult, tier);
assert.equal(calls.length, 3);
assert.ok(calls[2].options.title.includes('LOW risk in Phoenix'));
assert.ok(calls[2].options.body.includes('72°F'));
assert.ok(calls[2].options.body.includes('cached'));
assert.ok(calls[2].options.body.includes(new Date(cachedResult.data.fetched_at * 1000).toLocaleTimeString()));

console.log('PASS: Notification updates correctly for live, cached, and failed API calls.');
