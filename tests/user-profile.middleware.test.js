const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePatch } = require('../src/modules/users/middleware/user.middleware');
test('profile patch preserves omission and explicit clearing', () => {
  assert.deepEqual(normalizePatch({ firstName: ' Ana ', clientProfile: { homeLocation: null } }, 'client'), { firstName: 'Ana', clientProfile: { homeLocation: null } });
});
test('rejects restricted fields, wrong roles and malformed patches', () => {
  for (const body of [null, [], {}, { role: 'admin' }, { phoneNumber: '+573001234567' }, { profile: { admin: true } }, { driverProfile: { vehiclePlate: 'ABC123' } }, { clientProfile: [] }, { firstName: '' }, { clientProfile: { rating: 5 } }]) {
    assert.throws(() => normalizePatch(body, 'client'), { status: 400 });
  }
});
test('validates geographic bounds and nullable vehicle fields', () => {
  for (const homeLocation of [{ lat: 91, lng: 0 }, { lat: 0, lng: Infinity }, { lat: '4', lng: 0 }, { lat: 0 }]) assert.throws(() => normalizePatch({ clientProfile: { homeLocation } }, 'client'), { status: 400 });
  assert.deepEqual(normalizePatch({ driverProfile: { vehicleYear: null, vehicleColor: null } }, 'driver'), { driverProfile: { vehicleYear: null, vehicleColor: null } });
  assert.throws(() => normalizePatch({ driverProfile: { licenseNumber: null } }, 'driver'), { status: 400 });
});
test('document references have explicit keys and HTTPS URLs', () => {
  for (const documents of [{ arbitrary: 'https://example.test/file' }, { insurance: 'http://example.test/a' }, { licenseFront: 'https://user:password@example.test/a' }, {}]) assert.throws(() => normalizePatch({ driverProfile: { documents } }, 'driver'), { status: 400 });
  assert.deepEqual(normalizePatch({ driverProfile: { documents: { insurance: null } } }, 'driver').driverProfile.documents, { insurance: null });
});
