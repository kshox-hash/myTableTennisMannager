import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { SuperadminRepository } from "./superadmin_repository";

const router = Router();
const repo = new SuperadminRepository();

// Estricto: "superadmin" nada más — a diferencia de casi todas las otras
// rutas de este backend, acá NO se quiere que un admin común entre (el
// bypass de requireRole es al revés: superadmin pasa cualquier gate de
// "admin", pero un admin normal no puede pasar este de "superadmin").
router.use(authRequired, requireRole("superadmin"));

const roleSchema = z.object({
  role: z.enum(["admin", "player"]),
});

// GET /api/v1/superadmin/admins
router.get(
  "/admins",
  asyncHandler(async (_req, res) => {
    const rows = await repo.listAdmins();
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/superadmin/users/search?q=
router.get(
  "/users/search",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.status(400).json({ ok: false, message: "La búsqueda debe tener al menos 2 caracteres" });
    const rows = await repo.searchUsers(q);
    return res.json({ ok: true, data: rows });
  })
);

// POST /api/v1/superadmin/users/:id_user/role   body: { role: "admin" | "player" }
router.post(
  "/users/:id_user/role",
  asyncHandler(async (req, res) => {
    const p = roleSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    const updated = await repo.setUserRole(req.params.id_user, p.data.role);
    if (!updated) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });
    return res.json({ ok: true, data: updated });
  })
);

export default router;
