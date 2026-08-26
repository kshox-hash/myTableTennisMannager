import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { TournamentDashboardRepository } from "./tournament_dashboard_repository";

const router = Router();
const repo   = new TournamentDashboardRepository();

// GET /api/v1/tournament/:id_tournament/dashboard
router.get(
  "/:id_tournament/dashboard",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = await repo.getDashboard(req.params.id_tournament);
    if (!data) return res.status(404).json({ ok: false, message: "Torneo no encontrado" });
    return res.json({ ok: true, data });
  })
);

export default router;
