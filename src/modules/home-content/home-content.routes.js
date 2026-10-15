const { Router } = require('express');
const multer = require('multer');
const { authorizeRoles } = require('../auth/middleware/authentication.middleware');
const service = require('./home-content.service');
const storage = require('./storage.service');
const { fail } = require('./validation');
const admin = Router();
const mobile = Router();
const handle = (fn) => async (req, res, next) => {
  try {
    if (['POST', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) fail('Cuerpo de solicitud inválido.');
    await fn(req, res);
  } catch (error) { next(error); }
};
admin.use(authorizeRoles('admin'));
admin.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
admin.get('/', handle(async (_req, res) => res.json(await service.listAdmin())));
admin.post('/items', handle(async (req, res) => res.status(201).json({ item: await service.saveItem(req.user.id, null, req.body) })));
admin.patch('/items/:id', handle(async (req, res) => res.json({ item: await service.saveItem(req.user.id, req.params.id, req.body) })));
admin.post('/items/:id/publish', handle(async (req, res) => res.json({ item: await service.changeStatus(req.user.id, req.params.id, req.body, true) })));
admin.post('/items/:id/archive', handle(async (req, res) => res.json({ item: await service.changeStatus(req.user.id, req.params.id, req.body, false) })));
admin.patch('/sections/:key', handle(async (req, res) => res.json({ section: await service.updateSection(req.user.id, req.params.key, req.body) })));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: storage.MAX_BYTES, files: 1, fields: 1 } });
admin.post('/assets', upload.single('image'), handle(async (req, res) => res.status(201).json({ asset: await storage.upload(req.user.id, req.body.sectionKey, req.file) })));
admin.delete('/assets/:id', handle(async (req, res) => { await service.deleteAsset(req.params.id); res.status(204).end(); }));
admin.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ message: 'Carga inválida: una imagen de máximo 5 MB.' });
  return next(error);
});
mobile.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
mobile.get('/', handle(async (_req, res) => res.json(await service.getHomeContent())));
mobile.get('/items/:id', handle(async (req, res) => res.json(await service.getHomeContent(req.params.id))));
module.exports = { admin, mobile };
