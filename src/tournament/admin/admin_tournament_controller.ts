import type { Request, Response } from "express";
import { AdminTournamentService } from "./admin_tournament_service";
import { ADMIN_TOURNAMENT_ERRORS } from "../dto/tournament_dto";

export class AdminTournamentController {
  constructor(private service: AdminTournamentService) {}

  // POST /admin/tournaments
  adminCreateTournament = async (req: Request, res: Response) => {
    const tournamentCreated = await this.service.createTournamentService(req.body);

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

  // GET /admin/tournaments?q=&region=
  adminListTournaments = async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const region =
      typeof req.query.region === "string" ? req.query.region : undefined;

    const result = await this.service.listTournaments({ q, region });

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };

  // GET /admin/tournaments/my?created_by=uuid
  adminGetMyTournaments = async (req: Request, res: Response) => {
    const createdBy = (req.query.created_by as string | undefined)?.trim();

    const result = await this.service.listTournamentsByCreator(createdBy);

    if (!result.ok) {
      if (result.error === ADMIN_TOURNAMENT_ERRORS.MISSING_CREATED_BY) {
        return res.status(400).json({
          ok: false,
          message: "Falta query param: created_by",
        });
      }

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
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

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
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

      return res.status(400).json({
        ok: false,
        message: result.error,
      });
    }

    return res.json({ ok: true, data: result.data });
  };
}