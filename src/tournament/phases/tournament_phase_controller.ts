import type { Request, Response } from "express";
import { TournamentPhaseService, PHASE_ERRORS } from "./tournament_phase_service";
import type { BracketSlotAssignmentInput, GroupOrderInput } from "../../brackets/dto/brackets_dto";

function parseBestOfSets(value: unknown, fallback: 3 | 5 | 7): 3 | 5 | 7 {
  const n = parseInt(String(value ?? ""), 10);
  return n === 3 || n === 5 || n === 7 ? n : fallback;
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
    const groupOrder = parseGroupOrder(req.body.group_order);

    const result = await this.service.advanceToGroups(id_category, id_tournament, bestOfSets, groupOrder);

    if (!result.ok) {
      if (result.error === PHASE_ERRORS.CATEGORY_NOT_FOUND)
        return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
      if (result.error === PHASE_ERRORS.WRONG_PHASE)
        return res.status(409).json({ ok: false, message: "La categoría no está en fase de inscripción" });
      if (result.error === "GROUPS_OUT_OF_DATE")
        return res.status(409).json({
          ok: false,
          message: "El fixture que estás confirmando ya no coincide con los inscritos actuales — volvé a previsualizar",
          code: "GROUPS_OUT_OF_DATE",
        });
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/tournament/:id_tournament/categories/:id_category/preview-groups
  previewGroups = async (req: Request, res: Response) => {
    const { id_tournament, id_category } = req.params;

    const result = await this.service.previewGroups(id_category, id_tournament);

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
    const force      = req.body.force === true;
    const slotAssignment = parseSlotAssignment(req.body.slot_assignment);

    const result = await this.service.advanceToBracket(id_category, id_tournament, {
      bestOfSets,
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
          message: "El sorteo que estás confirmando ya no coincide con los clasificados actuales — volvé a previsualizar",
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
