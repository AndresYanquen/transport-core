const RadioService = require("../services/radio.service");
const { env } = require("../../../config");

async function createRequest(req, res, next) {
  try { res.status(201).json(await RadioService.createDriverRequest(req.user.id, req.body)); }
  catch (error) { next(error); }
}
async function myRequest(req, res, next) {
  try { res.json(await RadioService.getMyRequest(req.user.id)); } catch (error) { next(error); }
}
async function cancelRequest(req, res, next) {
  try { res.json(await RadioService.cancelRequest(req.params.requestId, req.user.id)); } catch (error) { next(error); }
}
async function listRequests(req, res, next) {
  try { res.json({ requests: await RadioService.listRequests(req.query) }); } catch (error) { next(error); }
}
async function acceptRequest(req, res, next) {
  try { res.json(await RadioService.acceptRequest(req.params.requestId, req.user.id)); } catch (error) { next(error); }
}
async function rejectRequest(req, res, next) {
  try { res.json(await RadioService.rejectRequest(req.params.requestId, req.user.id, req.body.reason)); } catch (error) { next(error); }
}
async function createSession(req, res, next) {
  try { res.status(201).json(await RadioService.createDirectSession(req.user.id, req.body)); } catch (error) { next(error); }
}
async function getSession(req, res, next) {
  try { res.json({ session: await RadioService.getSessionForParticipant(req.params.sessionId, req.user) }); } catch (error) { next(error); }
}
async function liveKitToken(req, res, next) {
  try { res.json(await RadioService.createLiveKitTokenForSession(req.params.sessionId, req.user)); } catch (error) { next(error); }
}
async function liveKitTokenTest(req, res, next) {
  try { res.json(await RadioService.createLiveKitTestToken(req.user)); } catch (error) { next(error); }
}
function iceConfig(_req, res) {
  res.json({ iceServers: env.radio.iceServers });
}

module.exports = {
  createRequest, myRequest, cancelRequest, listRequests, acceptRequest,
  rejectRequest, createSession, getSession, liveKitToken, liveKitTokenTest, iceConfig,
};
