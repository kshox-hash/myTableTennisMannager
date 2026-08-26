import type { Request, Response } from "express";
import { BracketsService } from "./brackets_service";
import { BRACKETS_ERRORS } from "./dto/brackets_dto";
import type { TournamentPhaseService } from "../tournament/phases/tournament_phase_service";

export class BracketsController {
  constructor(
    private service: BracketsService,
    private phaseService?: TournamentPhaseService
  ) {}

  // ─── GRUPOS ──────────────────────────────────────────────

  // POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/generate
  generateGroups = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.generateGroups(tournamentId, categoryId, req.body);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.GROUPS_ALREADY_EXIST) {
        return res.status(409).json({
          ok: false,
          message: "Los grupos de esta categoría ya fueron generados",
        });
      }
      if (result.error === BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS) {
        return res.status(422).json({
          ok: false,
          message: "Se requieren al menos 2 jugadores inscritos (qualification_type = 'group') para generar grupos",
        });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.status(201).json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/regenerate-groups
  regenerateGroups = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.regenerateGroups(tournamentId, categoryId, req.body);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.GROUP_NOT_FOUND) {
        return res.status(404).json({
          ok: false,
          message: "Esta categoría todavía no tiene grupos generados",
        });
      }
      if (result.error === BRACKETS_ERRORS.MATCHES_ALREADY_PLAYED) {
        return res.status(409).json({
          ok: false,
          message: "Ya hay partidos con resultado cargado en esta categoría: no se pueden rearmar los grupos",
        });
      }
      if (result.error === BRACKETS_ERRORS.NOT_ENOUGH_PLAYERS) {
        return res.status(422).json({
          ok: false,
          message: "Se requieren al menos 2 jugadores inscritos (qualification_type = 'group') para rearmar los grupos",
        });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/set-groups-manual
  setGroupsManual = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.setGroupsManual(tournamentId, categoryId, {
      groups: req.body.groups,
      bestOfSets: req.body.best_of_sets,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.GROUP_NOT_FOUND]: "Esta categoría todavía no tiene grupos generados",
        [BRACKETS_ERRORS.MATCHES_ALREADY_PLAYED]:
          "Ya hay partidos con resultado cargado en esta categoría: no se pueden rearmar los grupos",
        [BRACKETS_ERRORS.INVALID_GROUP_SIZE]: "Cada grupo debe tener entre 2 y 4 jugadores",
        [BRACKETS_ERRORS.DUPLICATE_PLAYER]: "Un jugador no puede estar en más de un grupo",
        [BRACKETS_ERRORS.INVALID_PLAYER]:
          "Alguno de los jugadores no está inscrito activamente (fase de grupos) en esta categoría",
        [BRACKETS_ERRORS.PLAYERS_MISSING]:
          "Faltan jugadores por asignar, o sobran ids que no corresponden a esta categoría",
      };

      const status =
        result.error === BRACKETS_ERRORS.GROUP_NOT_FOUND ? 404 :
        result.error === BRACKETS_ERRORS.MATCHES_ALREADY_PLAYED ? 409 :
        400;

      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category
  getGroups = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.getGroups(tournamentId, categoryId);

    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // PATCH /api/v1/bracket/groups/:id_group/qualifiers
  updateGroupQualifiers = async (req: Request, res: Response) => {
    const groupId = req.params.id_group?.trim();
    const result = await this.service.updateGroupQualifiers(groupId, req.body.qualifiers_per_group);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.GROUP_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Grupo no encontrado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // PATCH /api/v1/bracket/matches/:id_match/referee
  setGroupMatchReferee = async (req: Request, res: Response) => {
    const matchId = req.params.id_match?.trim();
    const result = await this.service.setGroupMatchReferee(matchId, req.body.referee_id ?? null);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.MATCH_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Partido no encontrado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // PATCH /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/move-player
  moveGroupMember = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId = req.params.id_category?.trim();
    const { id_user, id_group_to } = req.body;

    const result = await this.service.moveGroupMember({
      tournamentId,
      categoryId,
      userId: id_user,
      toGroupId: id_group_to,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.GROUPS_LOCKED]:
          "La categoría ya no está en fase de grupos: no se pueden mover jugadores",
        [BRACKETS_ERRORS.PLAYER_NOT_IN_GROUP]: "El jugador no pertenece a ningún grupo de esta categoría",
        [BRACKETS_ERRORS.GROUP_NOT_FOUND]: "El grupo destino no existe en esta categoría",
        [BRACKETS_ERRORS.SAME_GROUP]: "El jugador ya está en ese grupo",
        [BRACKETS_ERRORS.PLAYER_ALREADY_PLAYED]:
          "El jugador ya jugó un partido en su grupo actual: no se puede mover",
        [BRACKETS_ERRORS.SOURCE_GROUP_TOO_SMALL]: "El grupo de origen quedaría con menos de 2 jugadores",
        [BRACKETS_ERRORS.TARGET_GROUP_FULL]: "El grupo destino ya tiene el máximo de 4 jugadores",
      };

      const status =
        result.error === BRACKETS_ERRORS.GROUP_NOT_FOUND ||
        result.error === BRACKETS_ERRORS.PLAYER_NOT_IN_GROUP
          ? 404
          : 409;

      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/groups/:id_group/members
  addPlayerToGroup = async (req: Request, res: Response) => {
    const groupId = req.params.id_group?.trim();
    const userId = req.body?.id_user as string;

    const result = await this.service.addPlayerToGroup(groupId, userId);

    if (!result.ok) {
      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.GROUP_NOT_FOUND]: "Grupo no encontrado",
        [BRACKETS_ERRORS.GROUPS_LOCKED]: "La categoría ya no está en fase de grupos",
        [BRACKETS_ERRORS.PLAYER_NOT_ENROLLED]: "El jugador no está inscrito activamente en esta categoría",
        [BRACKETS_ERRORS.ALREADY_IN_A_GROUP]: "El jugador ya está en un grupo de esta categoría",
        [BRACKETS_ERRORS.TARGET_GROUP_FULL]: "El grupo ya tiene el máximo de 4 jugadores",
      };

      const status = result.error === BRACKETS_ERRORS.GROUP_NOT_FOUND ? 404 : 409;
      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    return res.status(201).json({ ok: true, data: result.data });
  };

  // PATCH /api/v1/bracket/bracket-matches/:id_match/referee
  setBracketMatchReferee = async (req: Request, res: Response) => {
    const matchId = req.params.id_match?.trim();
    const result = await this.service.setBracketMatchReferee(matchId, req.body.referee_id ?? null);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.MATCH_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Partido no encontrado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/matches/:id_match/result
  recordResult = async (req: Request, res: Response) => {
    const matchId = req.params.id_match?.trim();
    const result  = await this.service.recordResult(matchId, req.body);

    if (!result.ok) {
      const status =
        result.error === BRACKETS_ERRORS.MATCH_NOT_FOUND        ? 404 :
        result.error === BRACKETS_ERRORS.MATCH_ALREADY_PLAYED   ? 409 :
        400;

      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.MATCH_NOT_FOUND]:      "Partido no encontrado",
        [BRACKETS_ERRORS.MATCH_ALREADY_PLAYED]: "Este partido ya tiene resultado registrado",
        [BRACKETS_ERRORS.INVALID_WINNER]:       "winner_id no corresponde a ningún jugador de este partido",
        [BRACKETS_ERRORS.INVALID_SET_COUNT]:    "Marcador de sets inválido para el formato del partido",
      };

      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    if (this.phaseService) {
      await this.phaseService.checkGroupAutoAdvance(result.data.categoryId, result.data.tournamentId);
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/matches/:id_match/undo
  undoResult = async (req: Request, res: Response) => {
    const matchId = req.params.id_match?.trim();
    const result = await this.service.undoGroupMatchResult(matchId, req.user!.id_user);

    if (!result.ok) {
      const status =
        result.error === BRACKETS_ERRORS.MATCH_NOT_FOUND ? 404 :
        409;

      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.MATCH_NOT_FOUND]: "Partido no encontrado",
        [BRACKETS_ERRORS.MATCH_NOT_PLAYED]: "Este partido todavía no tiene resultado cargado",
        [BRACKETS_ERRORS.CATEGORY_ALREADY_ADVANCED]:
          "La categoría ya avanzó a la fase de cuadro eliminatorio: no se puede deshacer un resultado de grupos",
      };

      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // ─── CUADRO ELIMINATORIO ─────────────────────────────────

  // POST /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/generate-bracket
  generateBracket = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.generateBracket(tournamentId, categoryId, req.body, undefined, req.user!.id_user);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.BRACKET_ALREADY_EXISTS) {
        return res.status(409).json({
          ok: false,
          message: "El cuadro eliminatorio de esta categoría ya fue generado",
        });
      }
      if (result.error === BRACKETS_ERRORS.NOT_ENOUGH_QUALIFIERS) {
        return res.status(422).json({
          ok: false,
          message: "No hay suficientes clasificados para generar el cuadro (mínimo 2)",
        });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.status(201).json({ ok: true, data: result.data });
  };

  // GET /api/v1/bracket/tournaments/:id_tournament/categories/:id_category/bracket
  getBracket = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();

    const result = await this.service.getBracket(tournamentId, categoryId);

    if (!result.ok) {
      if (result.error === BRACKETS_ERRORS.BRACKET_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Cuadro eliminatorio no encontrado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /api/v1/bracket/bracket-matches/:id_match/result
  recordBracketResult = async (req: Request, res: Response) => {
    const matchId = req.params.id_match?.trim();
    const result  = await this.service.recordBracketResult(matchId, req.body);

    if (!result.ok) {
      const status =
        result.error === BRACKETS_ERRORS.MATCH_NOT_FOUND ? 404 :
        result.error === BRACKETS_ERRORS.MATCH_NOT_READY ? 409 :
        400;

      const messages: Record<string, string> = {
        [BRACKETS_ERRORS.MATCH_NOT_FOUND]:      "Partido de llave no encontrado",
        [BRACKETS_ERRORS.MATCH_NOT_READY]:      "El partido aún no está listo (faltan jugadores definidos)",
        [BRACKETS_ERRORS.INVALID_WINNER]:       "winner_id no corresponde a ningún jugador de este partido",
        [BRACKETS_ERRORS.INVALID_SET_COUNT]:    "Marcador de sets inválido para el formato del partido",
      };

      return res.status(status).json({ ok: false, message: messages[result.error] ?? result.error });
    }

    if (this.phaseService) {
      await this.phaseService.checkBracketAutoFinish(result.data.categoryId);
    }

    return res.json({ ok: true, data: result.data });
  };
}
