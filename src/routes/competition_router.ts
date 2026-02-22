// src/routes/competition_routes.ts
import { Router } from "express";
import { CompetitionController } from "../competitions/competition_controller";
import { CompetitionGroupsController } from "../competitions/competition_groups_controller";

const router = Router();
const competitionController = new CompetitionController();
const competitionGroupController = new CompetitionGroupsController();

/**
 * ✅ Generar grupos + partidos (fase de grupos) para una categoría
 * POST /api/tournaments/:tournamentId/categories/:categoryId/generate-groups
 *
 * Body opcional (solo si quieres validar admin por DB mientras no tengas auth):
 * { "created_by": "UUID_ADMIN" }
 */
router.post(
  "/tournaments/:tournamentId/categories/:categoryId/generate-groups",
  competitionController.generateGroupsAndMatches
);

router.get("/tournaments/:tournamentId/categories/:categoryId/groups", competitionGroupController.getGroups);

export default router;
