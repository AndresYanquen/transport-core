const crypto = require('node:crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Client } = require('../../config/storage');
const { env } = require('../../config');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { fail, section } = require('./validation');
const MAX_BYTES = 5 * 1024 * 1024;
function dimensions(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  if (mime === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216) {
    let pos = 2;
    while (pos + 4 <= buffer.length) {
      if (buffer[pos++] !== 255) break;
      while (buffer[pos] === 255) pos++;
      const marker = buffer[pos++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (pos + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(pos);
      if (length < 2 || pos + length > buffer.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) return [buffer.readUInt16BE(pos + 5), buffer.readUInt16BE(pos + 3)];
      pos += length;
    }
  }
  if (mime === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8X') return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    if (format === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([157,1,42]))) return [buffer.readUInt16LE(26) & 16383, buffer.readUInt16LE(28) & 16383];
    if (format === 'VP8L' && buffer[20] === 47) {
      const bits = buffer.readUInt32LE(21); return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    }
  }
  fail('Imagen inválida: usa JPEG, PNG o WEBP.');
}
function validateImage(file) {
  if (!file?.buffer || !file.size || file.size > MAX_BYTES || file.buffer.length !== file.size) fail('La imagen es obligatoria y debe pesar máximo 5 MB.');
  const [width, height] = dimensions(file.buffer, file.mimetype);
  if (width < 320 || height < 160 || width > 6000 || height > 6000 || width * height > 20000000) fail('La imagen debe medir entre 320 × 160 y 6000 × 6000, máximo 20 megapíxeles.');
  return { width, height };
}
async function deleteObject(key) {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: env.storage.r2.bucket, Key: key }));
}
async function upload(userId, sectionKey, file) {
  section(sectionKey);
  const { width, height } = validateImage(file);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
  const key = `home/${sectionKey}/${crypto.randomUUID()}.${ext}`;
  try {
    await getR2Client().send(new PutObjectCommand({ Bucket: env.storage.r2.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype, CacheControl: 'public, max-age=31536000, immutable' }));
  } catch (error) { logger.error('home_content_upload_failed', { error }); fail('No se pudo subir la imagen a R2.', 502); }
  try {
    const { rows } = await query(`INSERT INTO home_content_assets (section_key,object_key,url,mime_type,size_bytes,width,height,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [sectionKey,key,`${env.storage.r2.publicBaseUrl}/${key}`,file.mimetype,file.size,width,height,userId]);
    return rows[0];
  } catch (error) {
    try { await deleteObject(key); } catch (cleanupError) { logger.error('home_content_upload_cleanup_failed', { key, error: cleanupError }); }
    throw error;
  }
}
module.exports = { upload, deleteObject, validateImage, MAX_BYTES };
