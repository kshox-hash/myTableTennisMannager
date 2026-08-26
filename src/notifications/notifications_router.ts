import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { NotificationsRepository } from "./notifications_repository";

const router = Router();
const repo = new NotificationsRepository();

// GET /api/v1/notifications
router.get(
  "/",
  authRequired,
  asyncHandler(async (req, res) => {
    const [items, unreadCount] = await Promise.all([
      repo.listForUser(req.user!.id_user),
      repo.countUnread(req.user!.id_user),
    ]);
    return res.json({ ok: true, data: { items, unread_count: unreadCount } });
  })
);

// GET /api/v1/notifications/unread-count
router.get(
  "/unread-count",
  authRequired,
  asyncHandler(async (req, res) => {
    const unreadCount = await repo.countUnread(req.user!.id_user);
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
    await repo.markAllRead(req.user!.id_user);
    return res.json({ ok: true });
  })
);

export default router;
