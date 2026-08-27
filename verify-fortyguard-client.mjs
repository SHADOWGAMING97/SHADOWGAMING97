import assert from 'node:assert/strict';
import {
  RealFortyGuardClient,
  temperatureFromHeatmap,
} from './src/www/services/fortyguardClient.js';

const calls = [];
const http = {
  async post(options) {
    calls.push(options);
    return { status: 200, data: { error: false, data: { activity_id: 'heatmap-test-123' } } };
  },
  async get(options) {
    calls.push(options);
    return calls.length === 2
      ? { status: 200, data: { error: false, data: { activity_id: 'heatmap-test-123', status: 'Processing' } } }
      : {
          status: 200,
          data: {
            error: false,
            data: {
              activity_id: 'heatmap-test-123',
              status: 'Completed',
              result: {
                map_data: { type: 'FeatureCollection', features: [] },
                stats_data: { temperature_stats: { mean: 40 } },
              },
            },
          },
        };
  },
};

const client = new RealFortyGuardClient('test-key', 'https://api.fortyguard.com/v1', http, {
  pollDelayMs: 0,
});
const reading = await client.getTemperature('phoenix');
assert.equal(calls.length, 3, 'one submit plus two status checks should be made');
assert.equal(calls[0].url, 'https://api.fortyguard.com/v1/heatmap');
assert.equal(calls[1].url, 'https://api.fortyguard.com/v1/status/heatmap-test-123');
assert.equal(calls[0].headers['api-key'], 'test-key');
assert.equal(reading.temp_f, 104, '40 C should be normalized to 104 F');
assert.equal(reading.source, 'live_api');

const featureReading = temperatureFromHeatmap({
  map_data: {
    features: [{ properties: { temperature: 35 } }, { properties: { temperature: 45 } }],
  },
}, 'phoenix');
assert.equal(featureReading.temp_f, 104, 'feature temperatures should be converted from Celsius to Fahrenheit');

const failedHttp = {
  async post() { return { status: 401, data: { message: 'Invalid API key' } }; },
  async get() { throw new Error('must not poll after failed submit'); },
};
await assert.rejects(
  () => new RealFortyGuardClient('bad-key', 'https://api.fortyguard.com/v1', failedHttp, { pollDelayMs: 0 }).getTemperature('phoenix'),
  /API submission error 401/
);

console.log('PASS: FortyGuard async submit/status flow, authentication header, unit conversion, and error handling.');
