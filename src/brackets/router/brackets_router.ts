import { Router } from "express";
import { z } from "zod";
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
  setMatchesBestOfSchema,
  moveGroupMemberSchema,
  swapGroupMembersSchema,
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
const phaseService = new TournamentPhaseService(phaseRepo, service, repo);
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

// Corregir el formato (mejor de 3, 5 o 7) de los partidos sin jugar
// PATCH /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/best-of
router.patch(
  "/tournaments/:id_tournament/categories/:id_category/best-of",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(setMatchesBestOfSchema),
  asyncHandler(controller.setMatchesBestOf)
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
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/swap-players
// Intercambia a dos jugadores de grupos distintos (antes de que jueguen).
router.post(
  "/tournaments/:id_tournament/categories/:id_category/swap-players",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(swapGroupMembersSchema),
  asyncHandler(controller.swapGroupMembers)
);

// PATCH /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/move-player
router.patch(
  "/tournaments/:id_tournament/categories/:id_category/move-player",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(moveGroupMemberSchema),
  asyncHandler(controller.moveGroupMember)
);

// Sacar/retirar a un inscrito de una categoría ya empezada (ver
// BracketsService.withdrawPlayer). Después revisa si el grupo o la llave
// quedaron terminados con los W.O., igual que al cargar un resultado.
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/withdraw-player
const withdrawPlayerSchema = z
  .object({
    id_user: z.string().uuid(),
    reason: z.enum(["retired", "injury", "no_show", "disqualified"]).optional(),
  })
  .strict();
router.post(
  "/tournaments/:id_tournament/categories/:id_category/withdraw-player",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(withdrawPlayerSchema),
  asyncHandler(async (req, res) => {
    const tournamentId = String(req.params.id_tournament);
    const categoryId = String(req.params.id_category);
    const { id_user, reason } = req.body as z.infer<typeof withdrawPlayerSchema>;
    const r = await service.withdrawPlayer(tournamentId, categoryId, id_user, reason);
    if (!r.ok) return res.status(400).json({ ok: false, message: "Ese jugador no está jugando esta categoría" });
    await phaseService.checkGroupAutoAdvance(categoryId, tournamentId);
    await phaseService.checkBracketAutoFinish(categoryId);
    return res.json({ ok: true, data: r.data });
  })
);

// Reemplazar a un jugador que no vino por otro inscrito (fase de grupos).
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/replace-player
const replacePlayerSchema = z.object({ out_user_id: z.string().uuid(), in_user_id: z.string().uuid() }).strict();
router.post(
  "/tournaments/:id_tournament/categories/:id_category/replace-player",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(replacePlayerSchema),
  asyncHandler(async (req, res) => {
    const { out_user_id, in_user_id } = req.body as z.infer<typeof replacePlayerSchema>;
    const r = await repo.replaceGroupMember({
      tournamentId: String(req.params.id_tournament),
      categoryId: String(req.params.id_category),
      outUser: out_user_id,
      inUser: in_user_id,
    });
    if (!r.replaced) {
      const msg: Record<string, string> = {
        GROUPS_LOCKED: "La categoría ya no está en fase de grupos",
        PLAYER_NOT_IN_GROUP: "Ese jugador no está en ningún grupo",
        ALREADY_IN_A_GROUP: "El jugador nuevo ya está en un grupo",
        PLAYER_NOT_ENROLLED: "El jugador nuevo no está inscrito en la categoría",
        PLAYER_ALREADY_PLAYED: "Ese jugador ya jugó un partido: no se puede reemplazar (usa \"Sacar o retirar\")",
        PLAYER_ON_TABLE: "Ese jugador tiene un partido en mesa ahora",
        DUPLICATE_PLAYER: "Elegiste al mismo jugador",
      };
      return res.status(409).json({ ok: false, message: msg[r.error] ?? r.error });
    }
    const names = await repo.getUserNames([out_user_id, in_user_id]);
    const nm = (id: string) => [names.get(id)?.first_name, names.get(id)?.last_name].filter(Boolean).join(" ");
    await repo.activityLog.record(
      String(req.params.id_tournament),
      req.user!.id_user,
      "player_replaced",
      `${nm(in_user_id)} en lugar de ${nm(out_user_id)}`
    );
    return res.json({ ok: true, data: { replaced: true, id_group: r.groupId } });
  })
);

const BRACKET_POSITION_REF = /^(slot:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d+)?$/i;

// Llave adelantada: la mesa acepta cómo entraron a la llave los clasificados
// de un grupo que terminó (sus partidos recién ahí quedan listos para mesa).
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/confirm-entry
const confirmEntrySchema = z.object({ group_id: z.string().uuid() }).strict();
router.post(
  "/tournaments/:id_tournament/categories/:id_category/confirm-entry",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(confirmEntrySchema),
  asyncHandler(async (req, res) => {
    const tournamentId = String(req.params.id_tournament);
    const { group_id } = req.body as z.infer<typeof confirmEntrySchema>;
    const n = await repo.confirmGroupEntry(tournamentId, String(req.params.id_category), group_id);
    if (n > 0) {
      const g = await repo.groupNames([group_id]);
      await repo.activityLog.record(tournamentId, req.user!.id_user, "bracket_entry_confirmed", g.get(group_id) ?? null);
    }
    return res.json({ ok: true, data: { confirmed: n } });
  })
);

// Recomendaciones para la mesa de control: cruces del mismo club que todavía
// se pueden cambiar, con el cambio que no rompe reglas. No cambia nada.
// GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/suggestions
router.get(
  "/tournaments/:id_tournament/categories/:id_category/suggestions",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  asyncHandler(async (req, res) => {
    const data = await service.clubSuggestions(String(req.params.id_tournament), String(req.params.id_category));
    return res.json({ ok: true, data });
  })
);

// Intercambiar de lugar a dos jugadores de la llave (misma ronda, sin jugar).
// POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/swap-bracket-players
const swapBracketSchema = z
  .object({
    // Un jugador (uuid) o un cupo sin llenar de la llave adelantada ("slot:<grupo>:<puesto>").
    user_a: z.string().regex(BRACKET_POSITION_REF),
    user_b: z.string().regex(BRACKET_POSITION_REF),
    confirm: z.boolean().optional(),
  })
  .strict();
router.post(
  "/tournaments/:id_tournament/categories/:id_category/swap-bracket-players",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(),
  validateBody(swapBracketSchema),
  asyncHandler(async (req, res) => {
    const { user_a, user_b, confirm } = req.body as z.infer<typeof swapBracketSchema>;
    const r = await repo.swapBracketPlayers({
      tournamentId: String(req.params.id_tournament),
      categoryId: String(req.params.id_category),
      userA: user_a,
      userB: user_b,
      confirm: confirm === true,
      requestedBy: req.user!.id_user,
    });
    if (!r.swapped && r.error === "NEEDS_CONFIRM") {
      // Sin cambios todavía: la web muestra los avisos y vuelve a llamar con confirm.
      return res.json({ ok: true, data: { swapped: false, needs_confirm: true, warnings: r.warnings } });
    }
    if (!r.swapped) {
      const msg: Record<string, string> = {
        SAME_PLAYER: "Elegiste al mismo jugador",
        NOT_IN_BRACKET: "Alguno de los dos ya jugó su partido o no está en la llave",
        DIFFERENT_ROUND: "Solo se pueden cambiar jugadores de la misma ronda",
        MATCH_LIVE: "Uno de los partidos ya tiene marcador en vivo",
      };
      return res.status(409).json({ ok: false, message: msg[r.error] ?? r.error });
    }
    return res.json({ ok: true, data: { swapped: true } });
  })
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
// Cambiar el formato de UN partido de llave pendiente (p. ej. la final al
// mejor de 5 o 7 sin tocar el resto).
// PATCH /api/v1/bracket/bracket-matches/:id_match/best-of
router.patch(
  "/bracket-matches/:id_match/best-of",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  validateBody(setMatchesBestOfSchema),
  asyncHandler(async (req, res) => {
    const { best_of_sets } = req.body as { best_of_sets: 3 | 5 | 7 };
    const r = await DB.getPool().query(
      `UPDATE bracket_matches SET best_of_sets = $2, points_per_set = 11
        WHERE id_match = $1 AND status NOT IN ('played', 'walkover', 'bye')
        RETURNING best_of_sets`,
      [String(req.params.id_match), best_of_sets]
    );
    if (!r.rowCount) return res.status(409).json({ ok: false, message: "Ese partido ya se jugó o no existe" });
    return res.json({ ok: true, data: { best_of_sets: r.rows[0].best_of_sets } });
  })
);

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

// "Cambiar ganador" de un partido de GRUPO cargado al revés: corrige el grupo
// y lleva el cambio a la llave de Oro y a la de Plata si ya están armadas.
// POST /api/v1/bracket/matches/:id_match/fix-winner
router.post(
  "/matches/:id_match/fix-winner",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromGroupMatch),
  asyncHandler(async (req, res) => {
    const r = await service.fixGroupWinner(String(req.params.id_match), req.user!.id_user);
    if (!r.ok) {
      const msg = r.error === "MATCH_NOT_FOUND" ? "Partido no encontrado" : "Este partido todavía no tiene resultado cargado";
      return res.status(r.error === "MATCH_NOT_FOUND" ? 404 : 409).json({ ok: false, message: msg });
    }
    return res.json({ ok: true, data: r.data });
  })
);

// "Cambiar ganador" de un partido de llave cargado al revés: el otro pasa a
// ganador y toma su lugar (con sus resultados) en los partidos siguientes.
// POST /api/v1/bracket/bracket-matches/:id_match/fix-winner
router.post(
  "/bracket-matches/:id_match/fix-winner",
  authRequired,
  requireRole("admin"),
  requireTournamentOwnership(resolveTournamentFromBracketMatch),
  asyncHandler(async (req, res) => {
    const r = await repo.fixBracketWinner(String(req.params.id_match), req.user!.id_user);
    if (!r.fixed) {
      const msg = r.error === "MATCH_NOT_FOUND" ? "Partido no encontrado" : "Este partido todavía no tiene resultado cargado";
      return res.status(r.error === "MATCH_NOT_FOUND" ? 404 : 409).json({ ok: false, message: msg });
    }
    return res.json({ ok: true, data: { new_winner_id: r.newWinnerId } });
  })
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
