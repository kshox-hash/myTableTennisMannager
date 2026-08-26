import { Router } from "express";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { TournamentOrganizersRepository } from "./tournament_organizers_repository";

const router = Router();
const repo = new TournamentOrganizersRepository();

function errorResponse(res: import("express").Response, error: string) {
  if (error === "NOT_TOURNAMENT_OWNER") {
    return res.status(403).json({ ok: false, message: "Solo el organizador dueño del torneo puede hacer esto" });
  }
  if (error === "USER_NOT_FOUND") {
    return res.status(404).json({ ok: false, message: "No hay ninguna cuenta con ese email" });
  }
  if (error === "USER_NOT_ADMIN") {
    return res.status(400).json({ ok: false, message: "Esa cuenta no es de administrador" });
  }
  return res.status(400).json({ ok: false, message: error });
}

// GET /api/v1/tournament/admin/tournaments/:id_tournament/organizers
router.get(
  "/admin/tournaments/:id_tournament/organizers",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = await repo.list(req.params.id_tournament);
    return res.json({ ok: true, data });
  })
);

// POST /api/v1/tournament/admin/tournaments/:id_tournament/organizers  body: { email }
router.post(
  "/admin/tournaments/:id_tournament/organizers",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const email = (req.body?.email as string | undefined)?.trim();
    if (!email) {
      return res.status(400).json({ ok: false, message: "Falta email" });
    }
    const result = await repo.invite(req.params.id_tournament, req.user!.id_user, email);
    if (!result.ok) return errorResponse(res, result.error);
    return res.status(201).json({ ok: true, data: result.data });
  })
);

// DELETE /api/v1/tournament/admin/tournaments/:id_tournament/organizers/:id_user
router.delete(
  "/admin/tournaments/:id_tournament/organizers/:id_user",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const result = await repo.remove(req.params.id_tournament, req.user!.id_user, req.params.id_user);
    if (!result.ok) return errorResponse(res, result.error);
    return res.json({ ok: true });
  })
);

export default router;
