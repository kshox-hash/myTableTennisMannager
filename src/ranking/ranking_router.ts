import { Router } from "express";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { RankingRepository } from "./ranking_repository";

const router = Router();
const repo = new RankingRepository();

// GET /api/v1/ranking — ranking global (todos los torneos, todas las categorías)
router.get(
  "/",
  authRequired,
  requireRole(["admin", "player"]),
  asyncHandler(async (_req, res) => {
    const data = await repo.getGlobalRanking();
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/ranking/public — mismo ranking, sin login. Vitrina pública,
// igual que /tournament/public/*: reusa el mismo repositorio/criterio de
// orden que la versión autenticada, no duplica la lógica.
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 100;
    const data = await repo.getGlobalRanking(limit);
    return res.json({ ok: true, data });
  })
);

export default router;
