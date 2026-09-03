import { Router } from "express";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import type { Request } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
import DB from "../../db/db_configuration";

import { TournamentPhaseRepository } from "./tournament_phase_repository";
import { TournamentPhaseService } from "./tournament_phase_service";
import { TournamentPhaseController } from "./tournament_phase_controller";
import { BracketsRepository } from "../../brackets/brackets_repository";
import { BracketsService } from "../../brackets/brackets_service";

const router = Router();

// /categories/:id_category/config y /finish no traen id_tournament en la
// URL — hay que buscarlo desde la categoría antes de poder validar organizador.
async function resolveTournamentFromCategory(req: Request): Promise<string | null> {
  const idCategory = req.params.id_category;
  if (!idCategory) return null;
  const res = await DB.getPool().query<{ id_tournament: string }>(
    `SELECT id_tournament FROM tournament_categories WHERE id_category = $1`,
    [idCategory]
  );
  return res.rows[0]?.id_tournament ?? null;
}

const bracketsRepo    = new BracketsRepository();
const bracketsService = new BracketsService(bracketsRepo);
const phaseRepo       = new TournamentPhaseRepository();
const phaseService    = new TournamentPhaseService(phaseRepo, bracketsService);
const controller      = new TournamentPhaseController(phaseService);

// GET estado de fases de todas las categorías de un torneo
router.get(
  "/:id_tournament/phases",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.getPhases)
);

// POST guardar configuración de inicio
router.post(
  "/categories/:id_category/config",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromCategory),
  asyncHandler(controller.saveConfig)
);

// POST iniciar fase de grupos (genera grupos)
router.post(
  "/:id_tournament/categories/:id_category/start-groups",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.startGroups)
);

// GET previsualizar el fixture (composición de grupos, sin persistir nada)
router.get(
  "/:id_tournament/categories/:id_category/preview-groups",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.previewGroups)
);

// POST iniciar llaves (genera cuadro)
router.post(
  "/:id_tournament/categories/:id_category/start-bracket",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.startBracket)
);

// GET previsualizar el sorteo del cuadro (sin persistir nada)
router.get(
  "/:id_tournament/categories/:id_category/preview-bracket",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(controller.previewBracket)
);

// POST finalizar categoría
router.post(
  "/categories/:id_category/finish",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromCategory),
  asyncHandler(controller.finishCategory)
);

export default router;
