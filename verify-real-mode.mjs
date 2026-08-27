import assert from 'node:assert/strict';
import { Cache, InMemoryStorageAdapter } from './src/www/services/cache.js';
import { smartTemperatureCheck } from './src/www/services/smartTemperature.js';
import { TieredRequestManager } from './src/www/services/tieredRequest.js';
import { TokenSystem } from './src/www/services/tokenSystem.js';

const storage = new InMemoryStorageAdapter();
const cache = new Cache(storage, 'temperature');
const tieredManager = new TieredRequestManager();
const tokenSystem = new TokenSystem();

await cache.save('phoenix', {
  location: 'phoenix',
  temp_f: 40,
  risk_level: 'moderate',
  source: 'mock',
  fetched_at: Date.now() / 1000,
});

let realCalls = 0;
const realClient = {
  async getTemperature(location) {
    realCalls += 1;
    return {
      location,
      temp_f: 101,
      risk_level: 'high',
      source: 'live_api',
      fetched_at: Date.now() / 1000,
    };
  },
};

const liveResult = await smartTemperatureCheck(
  'phoenix',
  'manual_refresh',
  'standard',
  'lucky',
  realClient,
  {
    temperatureCache: cache,
    tieredManager,
    tokenSystem,
    cacheTtlSeconds: 1800,
    skipMockCache: true,
  },
);

assert.equal(realCalls, 1, 'real client must be called when only a mock cache entry exists');
assert.equal(liveResult.cached, false);
assert.equal(liveResult.data.source, 'live_api');
assert.equal(liveResult.data.temp_f, 101);

const cachedLiveResult = await smartTemperatureCheck(
  'phoenix',
  'manual_refresh',
  'standard',
  'lucky',
  realClient,
  {
    temperatureCache: cache,
    tieredManager,
    tokenSystem,
    cacheTtlSeconds: 1800,
    skipMockCache: true,
  },
);

assert.equal(realCalls, 1, 'fresh live data may be served from the normal cache');
assert.equal(cachedLiveResult.cached, true);
assert.equal(cachedLiveResult.data.source, 'live_api');

console.log('PASS: real mode bypasses a fresh mock cache and calls the real client once.');
console.log('PASS: fresh live data is then reused by the normal cache.');
