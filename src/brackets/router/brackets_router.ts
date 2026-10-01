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
import { claimRefereeToken, createRefereeToken, myRefereeMatches, requireMatchReferee } from "../referee";

import {
  generateGroupsSchema,
  matchResultSchema,
  generateBracketSchema,
  updateGroupQualifiersSchema,
  setMatchRefereeSchema,
  moveGroupMemberSchema,
  setGroupsManualSchema,
  addPlayerToGroupSchema,
  createManualGroupSchema,
  createBracketPreRoundMatchSchema,
  addPlayerToBracketMatchSchema,
  liveScoreSchema,
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

// Crear un grupo NUEVO manual (aparte de los que ya existen) — para sumar
// gente que llegó después del sorteo sin tocar los grupos que ya juegan
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/groups
router.post(
  "/tournaments/:id_tournament/categories/:id_category/groups",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(createManualGroupSchema),
  asyncHandler(controller.createManualGroup)
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

// "Crear una llave": postergar a un jugador de ronda 1 (todavía no jugó) a
// una pre-llave nueva, liberando su cupo para alguien que llegó tarde
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/pre-round-matches
router.post(
  "/tournaments/:id_tournament/categories/:id_category/pre-round-matches",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(createBracketPreRoundMatchSchema),
  asyncHandler(controller.createBracketPreRoundMatch)
);

// "Agregar un jugador" al cupo vacío de esa pre-llave
// POST /api/v1/bracket/bracket-matches/:id_match/players
router.post(
  "/bracket-matches/:id_match/players",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  validateBody(addPlayerToBracketMatchSchema),
  asyncHandler(controller.addPlayerToBracketMatch)
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

// Deshacer un resultado de partido de LLAVE ya cargado (ej: error de
// digitación) — mismo espíritu que el undo de grupos, ver undoBracketMatchResult.
// POST /api/v1/bracket/bracket-matches/:id_match/undo
router.post(
  "/bracket-matches/:id_match/undo",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  asyncHandler(controller.undoBracketResult)
);

// ─── MARCADOR EN VIVO ────────────────────────────────────────────────────────
// Guarda los sets jugados hasta ahora para que jugadores y público vean el
// partido "en vivo". No cambia el estado ni el ganador: el resultado final
// se sigue cargando con /result. Si el partido ya terminó, no se toca.
function liveScoreHandler(table: "group_matches" | "bracket_matches") {
  return asyncHandler(async (req, res) => {
    const sets = (req.body.set_scores as Array<{ p1: number; p2: number }>).filter((x) => x.p1 !== 0 || x.p2 !== 0);
    const updated = await DB.getPool().query(
      `UPDATE ${table}
          SET set_scores = $1::jsonb
        WHERE id_match = $2 AND status NOT IN ('played', 'walkover', 'bye') AND player1_id IS NOT NULL AND player2_id IS NOT NULL
        RETURNING id_match`,
      [JSON.stringify(sets), req.params.id_match]
    );
    if ((updated.rowCount ?? 0) === 0) {
      return res.status(409).json({ ok: false, message: "El partido ya tiene resultado final o no existe." });
    }
    return res.json({ ok: true, data: { set_scores: sets } });
  });
}

// PATCH /api/v1/bracket/matches/:id_match/live-score
router.patch(
  "/matches/:id_match/live-score",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  validateBody(liveScoreSchema),
  liveScoreHandler("group_matches")
);

// PATCH /api/v1/bracket/bracket-matches/:id_match/live-score
router.patch(
  "/bracket-matches/:id_match/live-score",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  validateBody(liveScoreSchema),
  liveScoreHandler("bracket_matches")
);

// ─── ÁRBITRO DESDE LA APP ────────────────────────────────────────────────────
// Cualquier usuario con sesión, pero solo puede anotar el partido del que es
// árbitro (referee_id): asignado por el organizador o por QR de un solo uso.
// Reutiliza el marcador en vivo y la carga de resultado del panel.

// GET /api/v1/bracket/referee/my-matches — partidos sin terminar que me toca arbitrar
router.get(
  "/referee/my-matches",
  authRequired,
  asyncHandler(async (req, res) => {
    const data = await myRefereeMatches(req.user!.id_user);
    return res.json({ ok: true, data });
  })
);

// POST /api/v1/bracket/referee/claim { token } — escaneó el QR del organizador
router.post(
  "/referee/claim",
  authRequired,
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const r = await claimRefereeToken(token, req.user!.id_user);
    if (!r.ok) return res.status(r.status).json({ ok: false, message: r.message });
    return res.json({ ok: true, data: { match_type: r.match_type, id_match: r.id_match } });
  })
);

router.patch(
  "/referee/matches/:id_match/live-score",
  authRequired,
  requireMatchReferee("group_matches"),
  validateBody(liveScoreSchema),
  liveScoreHandler("group_matches")
);
router.patch(
  "/referee/bracket-matches/:id_match/live-score",
  authRequired,
  requireMatchReferee("bracket_matches"),
  validateBody(liveScoreSchema),
  liveScoreHandler("bracket_matches")
);
router.post(
  "/referee/matches/:id_match/result",
  authRequired,
  requireMatchReferee("group_matches"),
  validateBody(matchResultSchema),
  asyncHandler(controller.recordResult)
);
router.post(
  "/referee/bracket-matches/:id_match/result",
  authRequired,
  requireMatchReferee("bracket_matches"),
  validateBody(matchResultSchema),
  asyncHandler(controller.recordBracketResult)
);

// QR de árbitro (organizador): un solo uso, 2 minutos.
// POST /api/v1/bracket/matches/:id_match/referee-token
router.post(
  "/matches/:id_match/referee-token",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  asyncHandler(async (req, res) => {
    const data = await createRefereeToken("group", String(req.params.id_match), req.user!.id_user);
    return res.json({ ok: true, data });
  })
);
// POST /api/v1/bracket/bracket-matches/:id_match/referee-token
router.post(
  "/bracket-matches/:id_match/referee-token",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  asyncHandler(async (req, res) => {
    const data = await createRefereeToken("bracket", String(req.params.id_match), req.user!.id_user);
    return res.json({ ok: true, data });
  })
);

export default router;
