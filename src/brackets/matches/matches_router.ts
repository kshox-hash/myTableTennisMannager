import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { MatchesRepository } from "./matches_repository";

const router      = Router();
const matchesRepo = new MatchesRepository();

// GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/all-matches
router.get(
  "/tournaments/:id_tournament/categories/:id_category/all-matches",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = await matchesRepo.getAllMatches(
      req.params.id_tournament,
      req.params.id_category
    );
    return res.json({ ok: true, data });
  })
);

// Nota: cargar resultados de partido se hace exclusivamente por las rutas
// validadas de brackets_router.ts (POST /matches/:id_match/result y
// POST /bracket-matches/:id_match/result), que verifican que el partido no
// esté ya jugado, que winner_id pertenezca al partido y que el marcador
// cuadre con best_of_sets. Las rutas PATCH duplicadas que existían aquí
// saltaban esas validaciones y se eliminaron para evitar doble conteo de
// estadísticas ante un doble envío.

export default router;
