import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
import { SeedingRepository } from "./seeding_repository";

const router = Router();
const repo   = new SeedingRepository();

// GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/seeds
router.get(
  "/tournaments/:id_tournament/categories/:id_category/seeds",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const rows = await repo.getSeeds(req.params.id_tournament, req.params.id_category);
    return res.json({ ok: true, data: rows });
  })
);

// PUT /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/seeds
// body: [{ id_enrollment, seed }]
router.put(
  "/tournaments/:id_tournament/categories/:id_category/seeds",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const seeds = req.body as { id_enrollment: string; seed: number }[];
    if (!Array.isArray(seeds) || seeds.some(s => !s.id_enrollment || s.seed == null)) {
      return res.status(400).json({ ok: false, message: "body debe ser array de { id_enrollment, seed }" });
    }
    await repo.saveSeeds(seeds);
    return res.json({ ok: true });
  })
);

// DELETE /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/seeds
router.delete(
  "/tournaments/:id_tournament/categories/:id_category/seeds",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    await repo.clearSeeds(req.params.id_tournament, req.params.id_category);
    return res.json({ ok: true });
  })
);

export default router;
