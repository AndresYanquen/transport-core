const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

// Exercise the dependency Express actually resolves, including nested installations.
const expressRequire = createRequire(require.resolve("express"));
const proxyaddr = expressRequire("proxy-addr");
function request(remoteAddress, forwardedFor = "203.0.113.45") {
  return { socket: { remoteAddress }, headers: { "x-forwarded-for": forwardedFor } };
}

test("short IPv4-mapped IPv6 proxy subnets cannot trust an unrelated IPv4 peer", () => {
  const trust = proxyaddr.compile("::ffff:10.0.0.0/8");
  assert.equal(trust("198.51.100.23"), false);
  assert.equal(proxyaddr(request("198.51.100.23"), trust), "198.51.100.23");
});

test("broad native IPv6 subnets cannot grant proxy trust to IPv4 peers", () => {
  const trust = proxyaddr.compile("::/1");
  assert.equal(trust("198.51.100.23"), false);
  assert.equal(proxyaddr(request("198.51.100.23"), trust), "198.51.100.23");
});

test("valid IPv4 and mapped IPv6 proxy ranges still resolve the client address", () => {
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(proxyaddr(request("10.1.2.3"), trust), "203.0.113.45");
    assert.equal(proxyaddr(request("198.51.100.23"), trust), "198.51.100.23");
  }
});
