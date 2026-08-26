import type { Request, Response } from "express";
import { AdminTournamentService } from "./admin_tournament_service";
import {
  ADMIN_TOURNAMENT_ERRORS,
  type TournamentCreateDTO,
  type TournamentUpdateDTO,
} from "../dto/tournament_dto";

export class AdminTournamentController {
  constructor(private service: AdminTournamentService) {}

  // POST /admin/tournaments
  adminCreateTournament = async (req: Request, res: Response) => {
    // created_by viene del token, no del body (seguridad)
    const payload: TournamentCreateDTO = { ...req.body, created_by: req.user!.id_user };
    const tournamentCreated = await this.service.createTournamentService(payload);

    if (!tournamentCreated.ok) {
      if (
        tournamentCreated.error ===
        ADMIN_TOURNAMENT_ERRORS.MISSING_CREATE_FIELDS
      ) {
        return res.status(400).json({
          ok: false,
          message: "Faltan campos obligatorios para crear el torneo",
        });
      }

      return res.status(400).json({
        ok: false,
        message: tournamentCreated.error,
      });
    }

    return res.status(201).json({
      ok: true,
      data: tournamentCreated.data,
    });
  };

  // PATCH /admin/tournaments/:id_tournament (solo el organizador)
  adminUpdateTournament = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    if (!tournamentId) {
      return res.status(400).json({ ok: false, message: "Falta param: id_tournament" });
    }

    if (Object.keys(req.body ?? {}).length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Debes enviar al menos un campo para actualizar",
      });
    }

    const payload: TournamentUpdateDTO = req.body;
    const result = await this.service.updateTournamentService(
      tournamentId,
      req.user!.id_user,
      payload
    );

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
      }
      if (result.error === ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER) {
        return res.status(403).json({ ok: false, message: "No sos el organizador de este campeonato" });
      }
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED) {
        return res.status(409).json({ ok: false, message: "No se puede editar un campeonato cancelado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments?q=&region=&page=1&limit=20
  adminListTournaments = async (req: Request, res: Response) => {
    const q      = typeof req.query.q      === "string" ? req.query.q      : undefined;
    const region = typeof req.query.region === "string" ? req.query.region : undefined;
    const page   = parseInt(req.query.page  as string ?? "1",  10) || 1;
    const limit  = parseInt(req.query.limit as string ?? "20", 10) || 20;

    const result = await this.service.listTournaments({ q, region }, { page, limit }, req.user?.id_user);

    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.error });
    }

    const { data, total, total_pages } = result.data;
    return res.json({
      ok: true,
      data,
      pagination: { total, page: result.data.page, limit: result.data.limit, total_pages },
    });
  };

  // GET /player/tournaments/:id_tournament — un torneo puntual con sus
  // categorías (ej. el jugador toca un evento del calendario).
  getTournamentById = async (req: Request, res: Response) => {
    const result = await this.service.getTournamentById(
      req.params.id_tournament,
      req.user?.id_user
    );

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/get/tournaments/my  (usa id del token, no query param)
  adminGetMyTournaments = async (req: Request, res: Response) => {
    const result = await this.service.listTournamentsByCreator(req.user!.id_user);

    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments/:id_tournament/activity?limit=
  adminGetActivity = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    if (!tournamentId) {
      return res.status(400).json({ ok: false, message: "Falta param: id_tournament" });
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const result = await this.service.getActivity(tournamentId, req.user!.id_user, limit);

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
      }
      if (result.error === ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER) {
        return res.status(403).json({ ok: false, message: "No sos organizador de este campeonato" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments/:id_tournament/enrollments
  adminGetTournamentEnrollments = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();

    const result = await this.service.listTournamentEnrollments(tournamentId);

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_TOURNAMENT_ID) {
        return res.status(400).json({
          ok: false,
          message: "Falta param: id_tournament",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /admin/tournaments/:id_tournament/enrollments/remove
  adminRemoveEnrollment = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const userId = (req.body?.id_user as string | undefined)?.trim();
    const categoryId = (req.body?.id_category as string | undefined)?.trim();

    const result = await this.service.removeEnrollment({
      tournamentId,
      userId,
      categoryId,
    });

    if (!result.ok) {
      if (
        result.error ===
        ADMIN_TOURNAMENT_ERRORS.MISSING_REMOVE_ENROLLMENT_FIELDS
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Faltan campos: id_tournament(param), id_user(body), id_category(body)",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND) {
        return res.status(404).json({
          ok: false,
          message: "No se encontró inscripción activa para cancelar",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED) {
        return res.status(409).json({
          ok: false,
          message: "La categoría ya inició (grupos generados): no se pueden sacar inscritos",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /admin/tournaments/:id_tournament/enrollments/check-in
  adminSetCheckIn = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const userId = (req.body?.id_user as string | undefined)?.trim();
    const categoryId = (req.body?.id_category as string | undefined)?.trim();
    const checkedIn = req.body?.checked_in as boolean | undefined;

    const result = await this.service.setCheckIn({
      tournamentId,
      userId,
      categoryId,
      checkedIn,
    });

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_CHECKIN_FIELDS) {
        return res.status(400).json({
          ok: false,
          message:
            "Faltan campos: id_tournament(param), id_user(body), id_category(body), checked_in(body)",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND) {
        return res.status(404).json({
          ok: false,
          message: "No se encontró inscripción activa",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED) {
        return res.status(409).json({
          ok: false,
          message: "La categoría ya inició (grupos generados): el check-in ya no tiene efecto",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /admin/tournaments/:id_tournament/cancel
  adminCancelTournament = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    if (!tournamentId) {
      return res.status(400).json({ ok: false, message: "Falta param: id_tournament" });
    }

    const result = await this.service.cancelTournament(tournamentId, req.user!.id_user);

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND) {
        return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
      }
      if (result.error === ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER) {
        return res.status(403).json({ ok: false, message: "No sos el organizador de este campeonato" });
      }
      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED) {
        return res.status(409).json({ ok: false, message: "Este campeonato ya estaba cancelado" });
      }
      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments/:id_tournament/categories
  adminGetTournamentCategories = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();

    const result = await this.service.listTournamentCategories(tournamentId);

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_TOURNAMENT_ID) {
        return res.status(400).json({
          ok: false,
          message: "Falta param: id_tournament",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments/:id_tournament/category/:id_category/players
  adminGetCategoryPlayers = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId = req.params.id_category?.trim();

    const result = await this.service.listCategoryPlayers(
      tournamentId,
      categoryId
    );

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_CATEGORY_PARAMS) {
        return res.status(400).json({
          ok: false,
          message: "Faltan params: id_tournament, id_category",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // POST /admin/tournaments/:id_tournament/category/:id_category/players
  adminAddPlayer = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId   = req.params.id_category?.trim();
    const userId       = (req.body?.id_user as string | undefined)?.trim();
    const qualificationType = (req.body?.qualification_type as string | undefined) ?? "group";

    const result = await this.service.adminAddPlayer({
      tournamentId,
      categoryId,
      userId,
      qualificationType: qualificationType as "group" | "direct_advance" | "late_entry",
    });

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.PLAYER_ALREADY_ENROLLED) {
        return res.status(409).json({
          ok: false,
          message: "El jugador ya está inscrito en esta categoría",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.INVALID_IDS) {
        return res.status(400).json({
          ok: false,
          message: "id_user, id_tournament o id_category no existen",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_CATEGORY_PARAMS) {
        return res.status(400).json({
          ok: false,
          message: "Faltan campos: id_tournament(param), id_category(param), id_user(body)",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED) {
        return res.status(409).json({
          ok: false,
          message: "No se puede inscribir jugadores en un campeonato cancelado",
        });
      }

      return res.status(400).json({ ok: false, message: result.error });
    }

    return res.status(201).json({ ok: true, data: result.data });
  };

  // DELETE /admin/tournaments/:id_tournament/category/:id_category/player/:id_user
  adminRemovePlayerFromCategory = async (req: Request, res: Response) => {
    const tournamentId = req.params.id_tournament?.trim();
    const categoryId = req.params.id_category?.trim();
    const userId = req.params.id_user?.trim();

    const result = await this.service.removePlayerFromCategory({
      tournamentId,
      categoryId,
      userId,
    });

    if (!result.ok) {
      if (
        result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_REMOVE_PLAYER_PARAMS
      ) {
        return res.status(400).json({
          ok: false,
          message: "Faltan params: id_tournament, id_category, id_user",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND) {
        return res.status(404).json({
          ok: false,
          message: "No encontrado o ya cancelado",
        });
      }

      if (result.error === ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED) {
        return res.status(409).json({
          ok: false,
          message: "La categoría ya inició (grupos generados): no se pueden sacar inscritos",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };
}