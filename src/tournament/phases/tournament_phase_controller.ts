import type { Request, Response } from "express";
import { TournamentPhaseService, PHASE_ERRORS } from "./tournament_phase_service";
import type { BracketSlotAssignmentInput, GroupOrderInput } from "../../brackets/dto/brackets_dto";

function parseBestOfSets(value: unknown, fallback: 1 | 3 | 5 | 7): 1 | 3 | 5 | 7 {
  const n = parseInt(String(value ?? ""), 10);
  return n === 1 || n === 3 || n === 5 || n === 7 ? n : fallback;
}

// "1 set a 21 puntos": el otro valor posible además del estándar de 11.
function parsePointsPerSet(value: unknown, fallback: 11 | 21): 11 | 21 {
  const n = parseInt(String(value ?? ""), 10);
  return n === 21 ? 21 : fallback;
}

// Validación mínima del sorteo que se manda a confirmar: un arreglo de
// {player_id, seed}, player_id string o null (BYE), seed número entero.
// No valida que coincida con los clasificados actuales — eso lo hace el
// service (SEEDING_OUT_OF_DATE) porque necesita consultar la base.
function parseSlotAssignment(value: unknown): BracketSlotAssignmentInput | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: BracketSlotAssignmentInput = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const { player_id, seed } = item as Record<string, unknown>;
    if (player_id !== null && typeof player_id !== "string") return undefined;
    if (typeof seed !== "number" || !Number.isInteger(seed)) return undefined;
    parsed.push({ player_id, seed });
  }
  return parsed.length > 0 ? parsed : undefined;
}

// Validación mínima del orden de grupos que se manda a confirmar: un
// arreglo de strings no vacíos (nombres de grupo, "A", "B", ...). No valida
// que coincida con los grupos actuales — eso lo hace el service
// (GROUPS_OUT_OF_DATE) porque necesita volver a correr el algoritmo.
function parseGroupOrder(value: unknown): GroupOrderInput | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) return undefined;
    parsed.push(item);
  }
  return parsed.length > 0 ? parsed : undefined;
}

// Mismo shape que parseGroupOrder (array de strings no vacíos) — acá son
// los id_user que el admin vio en la previsualización de Sembrado, para
// poder detectar si el roster cambió entre previsualizar y confirmar (ver
// GROUPS_OUT_OF_DATE en el service, que ahora compara esto en vez de solo
// los nombres de grupo resultantes).
function parsePlayerIds(value: unknown): string[] | undefined {
  return parseGroupOrder(value);
}

// Índices de grupos de 4 a dividir en dos de 2 (body: [0, 2] · query: "0,2").
function parseSplitFours(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n < 64);
}

// Cómo armar los grupos (body o query): "fours" fuerza grupos de 4; cualquier
// otro valor (o ausente) deja el comportamiento normal (prioriza grupos de
// 3). Las categorías Oro siempre arman de a 4 e ignoran esto (ver isGoldCategory).
function parseGroupSizeMode(value: unknown): "normal" | "fours" {
  return value === "fours" ? "fours" : "normal";
}

export class TournamentPhaseController {
  constructor(private service: TournamentPhaseService) {}

  // GET /api/v1/tournament/:id_tournament/phases
  getPhases = async (req: Request, res: Response) => {
    const result = await this.service.getTournamentPhases(req.params.id_tournament);
    return res.json(result);
  };

  // POST /api/v1/tournament/categories/:id_category/config
  saveConfig = async (req: Request, res: Response) => {
    const { id_category } = req.params;
    const {
      groups_start_mode,
      scheduled_groups_at,
      bracket_start_mode,
      scheduled_bracket_at,
    } = req.body;

    const result = await this.service.saveConfig(id_category, {
      groups_start_mode:    groups_start_mode    ?? "manual",
      scheduled_groups_at:  scheduled_groups_at  ?? null,
      bracket_start_mode:   bracket_start_mode   ?? "manual",
      scheduled_bracket_at: scheduled_bracket_at ?? null,
    });

    if (!result.ok) return res.status(404).json({ ok: false, message: result.error });
    return res.json({ ok: true });
  };

  // POST /api/v1/tournament/:id_tournament/categories/:id_category/start-groups
  startGroups = async (req: Request, res: Response) => {
    const { id_tournament, id_category } = req.params;
    const bestOfSets = parseBestOfSets(req.body.best_of_sets, 5);
    const pointsPerSet = parsePointsPerSet(req.body.points_per_set, 11);
    const groupOrder = parseGroupOrder(req.body.group_order);
    const playerIds = parsePlayerIds(req.body.player_ids);
    const splitFours = parseSplitFours(req.body.split_fours);
    const groupSizeMode = parseGroupSizeMode(req.body.group_size_mode);

    const result = await this.service.advanceToGroups(
      id_category,
      id_tournament,
      bestOfSets,
      groupOrder,
      playerIds,
      splitFours,
      pointsPerSet,
      groupSizeMode
    );

    if (!result.ok) {
      if (result.error === PHASE_ERRORS.CATEGORY_NOT_FOUND)
        return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
      if (result.error === PHASE_ERRORS.WRONG_PHASE)
        return res.status(409).json({ ok: false, message: "La categoría no está en fase de inscripción" });
      if (result.error === "GROUPS_OUT_OF_DATE")
        return res.status(409).json({
          ok: false,
          message: "El fixture que estás confirmando ya no coincide con los inscritos actuales — vuelve a previsualizar",
          code: "GROUPS_OUT_OF_DATE",
        });
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/tournament/:id_tournament/categories/:id_category/preview-groups
  previewGroups = async (req: Request, res: Response) => {
    const { id_tournament, id_category } = req.params;

    const result = await this.service.previewGroups(
      id_category,
      id_tournament,
      parseSplitFours(req.query.split_fours),
      parseGroupSizeMode(req.query.group_size_mode)
    );

    if (!result.ok) {
      if (result.error === PHASE_ERRORS.CATEGORY_NOT_FOUND)
        return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
      if (result.error === PHASE_ERRORS.WRONG_PHASE)
        return res.status(409).json({ ok: false, message: "La categoría no está en fase de inscripción" });
      if (result.error === "NOT_ENOUGH_PLAYERS")
        return res.status(400).json({ ok: false, message: "No hay suficientes inscritos para armar grupos" });
      if (result.error === "GROUPS_ALREADY_EXIST")
        return res.status(409).json({ ok: false, message: "Esta categoría ya tiene grupos generados" });
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/tournament/:id_tournament/categories/:id_category/start-bracket
  startBracket = async (req: Request, res: Response) => {
    const { id_tournament, id_category } = req.params;
    const bestOfSets = parseBestOfSets(req.body.best_of_sets, 5);
    const pointsPerSet = parsePointsPerSet(req.body.points_per_set, 11);
    const force      = req.body.force === true;
    const slotAssignment = parseSlotAssignment(req.body.slot_assignment);

    const result = await this.service.advanceToBracket(id_category, id_tournament, {
      bestOfSets,
      pointsPerSet,
      force,
      slotAssignment,
    });

    if (!result.ok) {
      if (result.error === PHASE_ERRORS.CATEGORY_NOT_FOUND)
        return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
      if (result.error === PHASE_ERRORS.WRONG_PHASE)
        return res.status(409).json({ ok: false, message: "La categoría no está en fase de grupos" });
      if (result.error === PHASE_ERRORS.GROUPS_NOT_FINISHED)
        return res.status(409).json({ ok: false, message: "Aún hay partidos de grupo sin resultado", code: "GROUPS_NOT_FINISHED" });
      if (result.error === "SEEDING_OUT_OF_DATE")
        return res.status(409).json({
          ok: false,
          message: "El sorteo que estás confirmando ya no coincide con los clasificados actuales — vuelve a previsualizar",
          code: "SEEDING_OUT_OF_DATE",
        });
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/tournament/:id_tournament/categories/:id_category/preview-bracket?force=true
  previewBracket = async (req: Request, res: Response) => {
    const { id_tournament, id_category } = req.params;
    const force = req.query.force === "true";

    const result = await this.service.previewBracket(id_category, id_tournament, force);

    if (!result.ok) {
      if (result.error === PHASE_ERRORS.CATEGORY_NOT_FOUND)
        return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
      if (result.error === PHASE_ERRORS.WRONG_PHASE)
        return res.status(409).json({ ok: false, message: "La categoría no está en fase de grupos" });
      if (result.error === PHASE_ERRORS.GROUPS_NOT_FINISHED)
        return res.status(409).json({ ok: false, message: "Aún hay partidos de grupo sin resultado", code: "GROUPS_NOT_FINISHED" });
      if (result.error === "NOT_ENOUGH_QUALIFIERS")
        return res.status(400).json({ ok: false, message: "No hay suficientes clasificados para armar un cuadro" });
      if (result.error === "BRACKET_ALREADY_EXISTS")
        return res.status(409).json({ ok: false, message: "Esta categoría ya tiene un cuadro eliminatorio generado" });
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/tournament/categories/:id_category/finish
  finishCategory = async (req: Request, res: Response) => {
    const result = await this.service.finishCategory(req.params.id_category);
    if (!result.ok) return res.status(409).json({ ok: false, message: result.error });
    return res.json({ ok: true });
  };
}
