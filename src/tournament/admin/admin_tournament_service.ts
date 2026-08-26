import type {
  TournamentCreateDTO,
  TournamentUpdateDTO,
  ITournament,
  AdminTournamentRow,
  EnrollmentRow,
  AdminCategoryRow,
  AdminCategoryPlayerRow,
  AdminAddPlayerInput,
  AdminAddPlayerResult,
  QualificationType,
  PaginatedTournamentResult,
} from "../dto/tournament_dto";

import { AdminTournamentRepository } from "./admin_tournament_repository";
import type { ActivityLogRow } from "../../activity/activity_log_repository";
import { Result, ok, fail } from "../../core/constants/result";
import {
  ADMIN_TOURNAMENT_ERRORS,
  type AdminTournamentError,
} from "../dto/tournament_dto";

export class AdminTournamentService {
  constructor(private repo: AdminTournamentRepository) {}

  // CREATE TOURNAMENT
  async createTournamentService(
    payload: TournamentCreateDTO
  ): Promise<Result<ITournament, AdminTournamentError>> {
    const data = await this.repo.createTournament(payload);
    return ok(data);
  }

  // UPDATE TOURNAMENT (solo el organizador; categorías con inscritos son inmutables)
  async updateTournamentService(
    tournamentId: string,
    requestedBy: string,
    payload: TournamentUpdateDTO
  ): Promise<Result<ITournament, AdminTournamentError>> {
    const result = await this.repo.updateTournament(tournamentId, requestedBy, payload);

    if (!result.tournament) {
      if (result.error === "TOURNAMENT_NOT_FOUND") return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND);
      if (result.error === "NOT_TOURNAMENT_OWNER") return fail(ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER);
      return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED);
    }

    return ok(result.tournament);
  }

  // LIST TOURNAMENTS (paginado)
  async listTournaments(
    filters?: { q?: string; region?: string },
    pagination?: { page: number; limit: number },
    userId?: string
  ): Promise<Result<PaginatedTournamentResult, AdminTournamentError>> {
    const data = await this.repo.findAll(filters, pagination, userId);
    return ok(data);
  }

  // UN TORNEO PUNTUAL (ej. el jugador toca un evento del calendario)
  async getTournamentById(
    tournamentId: string,
    userId?: string
  ): Promise<Result<ITournament, AdminTournamentError>> {
    const tournament = await this.repo.findById(tournamentId, userId);
    if (!tournament) return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND);
    return ok(tournament);
  }

  // TOURNAMENTS BY CREATOR (id viene del token, nunca es undefined)
  async listTournamentsByCreator(
    createdBy: string
  ): Promise<Result<AdminTournamentRow[], AdminTournamentError>> {
    const data = await this.repo.findByCreator(createdBy);
    return ok(data);
  }

  async getActivity(
    tournamentId: string,
    requestedBy: string,
    limit?: number
  ): Promise<Result<ActivityLogRow[], AdminTournamentError>> {
    const result = await this.repo.getActivity(tournamentId, requestedBy, limit);
    if (result.error === "TOURNAMENT_NOT_FOUND") return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND);
    if (result.error === "NOT_TOURNAMENT_OWNER") return fail(ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER);
    return ok(result.data);
  }

  // ENROLLMENTS
  async listTournamentEnrollments(
    tournamentId?: string
  ): Promise<Result<EnrollmentRow[], AdminTournamentError>> {
    if (!tournamentId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_TOURNAMENT_ID);
    }

    const data = await this.repo.findEnrollmentsByTournament(tournamentId);
    return ok(data);
  }

  // REMOVE ENROLLMENT
  async removeEnrollment(params: {
    tournamentId?: string;
    userId?: string;
    categoryId?: string;
  }): Promise<Result<{ cancelled: boolean }, AdminTournamentError>> {
    if (!params.tournamentId || !params.userId || !params.categoryId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_REMOVE_ENROLLMENT_FIELDS);
    }

    const result = await this.repo.cancelEnrollment({
      tournamentId: params.tournamentId,
      userId: params.userId,
      categoryId: params.categoryId,
    });

    if (!result.cancelled) {
      if (result.error === "CATEGORY_ALREADY_STARTED") {
        return fail(ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED);
      }
      return fail(ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND);
    }

    return ok({ cancelled: true });
  }

  // SET CHECK-IN
  async setCheckIn(params: {
    tournamentId?: string;
    userId?: string;
    categoryId?: string;
    checkedIn?: boolean;
  }): Promise<Result<{ ok: true }, AdminTournamentError>> {
    if (!params.tournamentId || !params.userId || !params.categoryId || params.checkedIn === undefined) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_CHECKIN_FIELDS);
    }

    const result = await this.repo.setCheckIn({
      tournamentId: params.tournamentId,
      userId: params.userId,
      categoryId: params.categoryId,
      checkedIn: params.checkedIn,
    });

    if (!result.ok) {
      if (result.error === "CATEGORY_ALREADY_STARTED") {
        return fail(ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED);
      }
      return fail(ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND);
    }

    return ok({ ok: true });
  }

  // CANCEL TOURNAMENT
  async cancelTournament(
    tournamentId: string,
    requestedBy: string
  ): Promise<Result<{ cancelled: true }, AdminTournamentError>> {
    const result = await this.repo.cancelTournament(tournamentId, requestedBy);

    if (!result.cancelled) {
      if (result.error === "TOURNAMENT_NOT_FOUND") return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_NOT_FOUND);
      if (result.error === "NOT_TOURNAMENT_OWNER") return fail(ADMIN_TOURNAMENT_ERRORS.NOT_TOURNAMENT_OWNER);
      return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED);
    }

    return ok({ cancelled: true });
  }

  // CATEGORIES WITH COUNT
  async listTournamentCategories(
    tournamentId?: string
  ): Promise<Result<AdminCategoryRow[], AdminTournamentError>> {
    if (!tournamentId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_TOURNAMENT_ID);
    }

    const data = await this.repo.findCategoriesWithCount(tournamentId);
    return ok(data);
  }

  // PLAYERS BY CATEGORY
  async listCategoryPlayers(
    tournamentId?: string,
    categoryId?: string
  ): Promise<Result<AdminCategoryPlayerRow[], AdminTournamentError>> {
    if (!tournamentId || !categoryId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_CATEGORY_PARAMS);
    }

    const data = await this.repo.findPlayersByCategory(tournamentId, categoryId);
    return ok(data);
  }

  // ADMIN ADD PLAYER
  async adminAddPlayer(params: {
    tournamentId?: string;
    categoryId?: string;
    userId?: string;
    qualificationType?: QualificationType;
  }): Promise<Result<AdminAddPlayerResult, AdminTournamentError>> {
    if (!params.tournamentId || !params.categoryId || !params.userId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_CATEGORY_PARAMS);
    }

    try {
      const data = await this.repo.adminAddPlayer({
        tournamentId: params.tournamentId,
        categoryId: params.categoryId,
        userId: params.userId,
        qualificationType: params.qualificationType ?? "group",
      });
      return ok(data);
    } catch (error: any) {
      if (error?.message === "PLAYER_ALREADY_ENROLLED") {
        return fail(ADMIN_TOURNAMENT_ERRORS.PLAYER_ALREADY_ENROLLED);
      }
      if (error?.message === "INVALID_IDS") {
        return fail(ADMIN_TOURNAMENT_ERRORS.INVALID_IDS);
      }
      if (error?.message === "TOURNAMENT_ALREADY_CANCELLED") {
        return fail(ADMIN_TOURNAMENT_ERRORS.TOURNAMENT_ALREADY_CANCELLED);
      }
      throw error;
    }
  }

  // REMOVE PLAYER FROM CATEGORY
  async removePlayerFromCategory(params: {
    tournamentId?: string;
    userId?: string;
    categoryId?: string;
  }): Promise<Result<{ cancelled: boolean }, AdminTournamentError>> {
    if (!params.tournamentId || !params.categoryId || !params.userId) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_REMOVE_PLAYER_PARAMS);
    }

    const result = await this.repo.cancelEnrollment({
      tournamentId: params.tournamentId,
      userId: params.userId,
      categoryId: params.categoryId,
    });

    if (!result.cancelled) {
      if (result.error === "CATEGORY_ALREADY_STARTED") {
        return fail(ADMIN_TOURNAMENT_ERRORS.CATEGORY_ALREADY_STARTED);
      }
      return fail(ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND);
    }

    return ok({ cancelled: true });
  }
}