import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
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

// GET /api/v1/tournament/:id_tournament/points-summary
// Puntos ganados EN este torneo puntual, jugador por jugador -- para
// mostrar un resumen al terminar el campeonato (o en cualquier momento,
// como progreso parcial). Incluye is_ranked para poder avisar si esos
// puntos suman o no al ranking público.
router.get(
  "/:id_tournament/points-summary",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(undefined, { allowViewer: true }),
  asyncHandler(async (req, res) => {
    const data = await repo.getPointsSummary(req.params.id_tournament);
    if (!data) return res.status(404).json({ ok: false, message: "Torneo no encontrado" });
    return res.json({ ok: true, data });
  })
);

export default router;
