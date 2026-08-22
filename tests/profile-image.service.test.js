const test = require("node:test");
const assert = require("node:assert/strict");

const ProfileImageService = require("../src/modules/users/services/profile-image.service");

function file({ mimetype, buffer, size = buffer.length }) {
  return { mimetype, buffer, size };
}

test("profile image validation accepts jpeg png and webp signatures", () => {
  assert.doesNotThrow(() =>
    ProfileImageService.__private.validateImageFile(file({
      mimetype: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    }))
  );
  assert.doesNotThrow(() =>
    ProfileImageService.__private.validateImageFile(file({
      mimetype: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
    }))
  );
  assert.doesNotThrow(() =>
    ProfileImageService.__private.validateImageFile(file({
      mimetype: "image/webp",
      buffer: Buffer.from("RIFFxxxxWEBP", "ascii"),
    }))
  );
});

test("profile image validation rejects unsupported mime types", () => {
  assert.throws(
    () => ProfileImageService.__private.validateImageFile(file({
      mimetype: "image/gif",
      buffer: Buffer.from("GIF89a", "ascii"),
    })),
    (error) => error.status === 400 && /JPEG, PNG, or WEBP/.test(error.message)
  );
});

test("profile image validation rejects mismatched content", () => {
  assert.throws(
    () => ProfileImageService.__private.validateImageFile(file({
      mimetype: "image/png",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    })),
    (error) => error.status === 400 && /does not match/.test(error.message)
  );
});
