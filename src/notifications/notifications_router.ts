import { pushSelfTest } from "./push";
import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { NotificationsRepository, parseAudience } from "./notifications_repository";

const router = Router();
const repo = new NotificationsRepository();

// GET /api/v1/notifications
router.get(
  "/",
  authRequired,
  asyncHandler(async (req, res) => {
    const [items, unreadCount] = await Promise.all([
      repo.listForUser(req.user!.id_user, 50, parseAudience(req.query.audience)),
      repo.countUnread(req.user!.id_user, parseAudience(req.query.audience)),
    ]);
    return res.json({ ok: true, data: { items, unread_count: unreadCount } });
  })
);

// POST /api/v1/notifications/device-token  { token, platform }
// DELETE /api/v1/notifications/device-token { token }  (al cerrar sesión)
router.post(
  "/device-token",
  authRequired,
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const platform = ["android", "ios", "web"].includes(req.body?.platform) ? req.body.platform : "android";
    if (!token || token.length > 4096) return res.status(400).json({ ok: false, message: "Token inválido" });
    await repo.saveDeviceToken(req.user!.id_user, token, platform);
    return res.json({ ok: true });
  })
);
router.delete(
  "/device-token",
  authRequired,
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (token) await repo.deleteDeviceToken(req.user!.id_user, token);
    return res.json({ ok: true });
  })
);

// POST /api/v1/notifications/push-test — aviso de prueba a los celulares
// del usuario + diagnóstico de cada paso (ver pushSelfTest).
router.post(
  "/push-test",
  authRequired,
  asyncHandler(async (req, res) => {
    const delaySec = Math.min(15, Math.max(0, Number(req.query.delay) || 0));
    const result = await pushSelfTest(req.user!.id_user, delaySec * 1000);
    return res.json({ ok: true, data: result });
  })
);

// GET /api/v1/notifications/unread-count
router.get(
  "/unread-count",
  authRequired,
  asyncHandler(async (req, res) => {
    const unreadCount = await repo.countUnread(req.user!.id_user, parseAudience(req.query.audience));
    return res.json({ ok: true, data: { unread_count: unreadCount } });
  })
);

// PATCH /api/v1/notifications/:id_notification/read
router.patch(
  "/:id_notification/read",
  authRequired,
  asyncHandler(async (req, res) => {
    const updated = await repo.markRead(req.params.id_notification, req.user!.id_user);
    if (!updated) return res.status(404).json({ ok: false, message: "Notificación no encontrada" });
    return res.json({ ok: true });
  })
);

// POST /api/v1/notifications/read-all
router.post(
  "/read-all",
  authRequired,
  asyncHandler(async (req, res) => {
    await repo.markAllRead(req.user!.id_user, parseAudience(req.query.audience));
    return res.json({ ok: true });
  })
);

export default router;
