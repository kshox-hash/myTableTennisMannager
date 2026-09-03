import { Router } from "express";
import { BracketsController } from "../brackets_controller";
import { BracketsService } from "../brackets_service";
import { BracketsRepository } from "../brackets_repository";
import { TournamentPhaseRepository } from "../../tournament/phases/tournament_phase_repository";
import { TournamentPhaseService } from "../../tournament/phases/tournament_phase_service";

import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { validateBody } from "../../middlewares/validate_body_middleware";
import type { Request } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { requireTournamentOwnership } from "../../middlewares/require_tournament_ownership_middleware";
import DB from "../../db/db_configuration";

import {
  generateGroupsSchema,
  matchResultSchema,
  generateBracketSchema,
  updateGroupQualifiersSchema,
  setMatchRefereeSchema,
  moveGroupMemberSchema,
  setGroupsManualSchema,
  addPlayerToGroupSchema,
} from "../schema/brackets_schema";

const repo         = new BracketsRepository();
const service      = new BracketsService(repo);
const phaseRepo    = new TournamentPhaseRepository();
const phaseService = new TournamentPhaseService(phaseRepo, service);
const controller   = new BracketsController(service, phaseService);

const router = Router();

// Varias rutas de esta llave solo traen id_group o id_match, no
// id_tournament directo — hay que resolverlo antes de poder validar
// organizador. Encontrado en la auditoría de seguridad: ninguna de estas
// rutas verificaba antes que quien pide el cambio sea organizador de ESE
// torneo puntual, solo que fuera "algún" admin.
async function resolveTournamentFromGroup(req: Request): Promise<string | null> {
  const idGroup = req.params.id_group;
  if (!idGroup) return null;
  const res = await DB.getPool().query<{ id_tournament: string }>(
    `SELECT id_tournament FROM category_groups WHERE id_group = $1`,
    [idGroup]
  );
  return res.rows[0]?.id_tournament ?? null;
}

async function resolveTournamentFromGroupMatch(req: Request): Promise<string | null> {
  const idMatch = req.params.id_match;
  if (!idMatch) return null;
  const res = await DB.getPool().query<{ id_tournament: string }>(
    `SELECT id_tournament FROM group_matches WHERE id_match = $1`,
    [idMatch]
  );
  return res.rows[0]?.id_tournament ?? null;
}

async function resolveTournamentFromBracketMatch(req: Request): Promise<string | null> {
  const idMatch = req.params.id_match;
  if (!idMatch) return null;
  const res = await DB.getPool().query<{ id_tournament: string }>(
    `SELECT id_tournament FROM bracket_matches WHERE id_match = $1`,
    [idMatch]
  );
  return res.rows[0]?.id_tournament ?? null;
}

// ─── FASE DE GRUPOS ───────────────────────────────────────────────────────────

// Generar grupos para una categoría
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/generate
router.post(
  "/tournaments/:id_tournament/categories/:id_category/generate",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(generateGroupsSchema),
  asyncHandler(controller.generateGroups)
);

// Ver grupos de una categoría
// GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category
router.get(
  "/tournaments/:id_tournament/categories/:id_category",
  authRequired,
  asyncHandler(controller.getGroups)
);

// Rearmar los grupos de cero con todos los inscritos actuales (solo si nadie jugó todavía)
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/regenerate-groups
router.post(
  "/tournaments/:id_tournament/categories/:id_category/regenerate-groups",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(generateGroupsSchema),
  asyncHandler(controller.regenerateGroups)
);

// Rearmar los grupos con la composición exacta que define el admin (solo si nadie jugó todavía)
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/set-groups-manual
router.post(
  "/tournaments/:id_tournament/categories/:id_category/set-groups-manual",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(setGroupsManualSchema),
  asyncHandler(controller.setGroupsManual)
);

// Agregar directamente a un jugador (ya inscrito) a un grupo puntual
// POST /api/v1/bracket/groups/:id_group/members
router.post(
  "/groups/:id_group/members",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroup),
  validateBody(addPlayerToGroupSchema),
  asyncHandler(controller.addPlayerToGroup)
);

// Ajustar manualmente cuántos clasifican de un grupo puntual
// PATCH /api/v1/bracket/groups/:id_group/qualifiers
router.patch(
  "/groups/:id_group/qualifiers",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroup),
  validateBody(updateGroupQualifiersSchema),
  asyncHandler(controller.updateGroupQualifiers)
);

// Mover manualmente a un jugador de su grupo a otro (fix de errores al armar los grupos)
// PATCH /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/move-player
router.patch(
  "/tournaments/:id_tournament/categories/:id_category/move-player",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(moveGroupMemberSchema),
  asyncHandler(controller.moveGroupMember)
);

// Registrar resultado de partido de grupo
// POST /api/v1/bracket/matches/:id_match/result
router.post(
  "/matches/:id_match/result",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  validateBody(matchResultSchema),
  asyncHandler(controller.recordResult)
);

// Deshacer un resultado de partido de grupo ya cargado (ej: error de digitación)
// POST /api/v1/bracket/matches/:id_match/undo
router.post(
  "/matches/:id_match/undo",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  asyncHandler(controller.undoResult)
);

// Anotar/limpiar el árbitro sugerido de un partido de grupo (no es oficial)
// PATCH /api/v1/bracket/matches/:id_match/referee
router.patch(
  "/matches/:id_match/referee",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  validateBody(setMatchRefereeSchema),
  asyncHandler(controller.setGroupMatchReferee)
);

// ─── CUADRO ELIMINATORIO (LLAVES) ─────────────────────────────────────────────

// Generar cuadro eliminatorio desde clasificados + pases directos
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/generate-bracket
router.post(
  "/tournaments/:id_tournament/categories/:id_category/generate-bracket",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(generateBracketSchema),
  asyncHandler(controller.generateBracket)
);

// Ver cuadro eliminatorio
// GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/bracket
router.get(
  "/tournaments/:id_tournament/categories/:id_category/bracket",
  authRequired,
  asyncHandler(controller.getBracket)
);

// Registrar resultado de partido de llave (avanza ganador automáticamente)
// POST /api/v1/bracket/bracket-matches/:id_match/result
router.post(
  "/bracket-matches/:id_match/result",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  validateBody(matchResultSchema),
  asyncHandler(controller.recordBracketResult)
);

// Anotar/limpiar el árbitro sugerido de un partido de llave (no es oficial)
// PATCH /api/v1/bracket/bracket-matches/:id_match/referee
router.patch(
  "/bracket-matches/:id_match/referee",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  validateBody(setMatchRefereeSchema),
  asyncHandler(controller.setBracketMatchReferee)
);

export default router;
