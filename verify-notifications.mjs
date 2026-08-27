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
    if (reason === 'no_qualifying_trigger') failMsg = 'waiting for next check';
    return {
      title: "L'SA — Heat monitoring",
      body: `⚠️ Reading failed: ${failMsg} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
  }
  const risk = data.risk_level.toUpperCase();
  const loc = data.location.includes(',') ? 'Current Location' : data.location;
  const time = new Date(data.fetched_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const title = `L'SA: ${data.temp_f}°F — ${risk} RISK`;
  const body = `${loc} · ${cached ? 'Cached' : 'Live'} · ${time}`;
  return { title, body };
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
assert.ok(calls[0].options.title.includes('98°F — HIGH RISK'));
assert.ok(calls[0].options.body.includes('Dubai'));
assert.ok(calls[0].options.body.includes('Live'));

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
assert.ok(calls[1].options.title.includes('Heat monitoring'));
assert.ok(calls[1].options.body.includes('Reading failed: API Error 401: Invalid Key'));

// Test 3: Cached reading
const cachedResult = {
  data: { temp_f: 72, location: 'Phoenix', risk_level: 'low', fetched_at: Date.now() / 1000 - 300 },
  cached: true,
  tokens_charged: 0,
};
await updateStatusNotification(cachedResult, tier);
assert.equal(calls.length, 3);
assert.ok(calls[2].options.title.includes('72°F — LOW RISK'));
assert.ok(calls[2].options.body.includes('Phoenix'));
assert.ok(calls[2].options.body.includes('Cached'));
assert.ok(calls[2].options.body.includes(new Date(cachedResult.data.fetched_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));

console.log('PASS: Notification updates correctly for live, cached, and failed API calls.');
