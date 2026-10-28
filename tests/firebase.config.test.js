const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
function run(source, overrides = {}) {
  const result = spawnSync(process.execPath, ["-e", source], { cwd: require("node:path").resolve(__dirname, ".."),
    encoding: "utf8", env: { ...process.env, PUSH_ENABLED: "false", FIREBASE_PROJECT_ID: "gottaxi-191c2",
      FIREBASE_SERVICE_ACCOUNT_JSON: "", GOOGLE_APPLICATION_CREDENTIALS: "", ...overrides } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test("disabled Firebase does not initialize an SDK app", () => {
  run(`const assert=require('node:assert/strict'); const f=require('./src/config/firebase');
    assert.equal(f.initializeFirebase(),null); assert.equal(require('firebase-admin/app').getApps().length,0);`);
});
test("malformed configuration is isolated and never logs the supplied secret", () => {
  const output = run(`const assert=require('node:assert/strict'); const f=require('./src/config/firebase');
    assert.equal(f.initializeFirebase(),null); assert.equal(f.getMessaging(),null);`,
  { PUSH_ENABLED: "true", FIREBASE_SERVICE_ACCOUNT_JSON: "SECRET_MALFORMED_JSON_FOR_TEST" });
  assert.ok(output.includes("push_unavailable"));
  assert.equal(output.includes("SECRET_MALFORMED_JSON_FOR_TEST"), false);
});
test("service account project mismatch is rejected locally", () => {
  const output = run(`const assert=require('node:assert/strict');
    assert.equal(require('./src/config/firebase').initializeFirebase(),null);`,
  { PUSH_ENABLED: "true", FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", project_id: "other", client_email: "secret@example.test", private_key: "secret" }) });
  assert.ok(output.includes("configuration_invalid"));
  assert.equal(output.includes("secret@example.test"), false);
});
test("valid account initializes exactly one named SDK app without making FCM calls", () => {
  run(`const assert=require('node:assert/strict'); const crypto=require('node:crypto');
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',project_id:'gottaxi-191c2',
      client_email:'push@gottaxi-191c2.iam.gserviceaccount.com', private_key:crypto.generateKeyPairSync('rsa',
        {modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey});
    const f=require('./src/config/firebase'); const one=f.initializeFirebase(); assert.ok(one);
    assert.equal(f.initializeFirebase(),one); assert.equal(require('firebase-admin/app').getApps().length,1);`, { PUSH_ENABLED: "true" });
});
