import type {
  TournamentCreateDTO,
  ITournament,
  AdminTournamentRow,
  EnrollmentRow,
  AdminCategoryRow,
  AdminCategoryPlayerRow,
} from "../dto/tournament_dto";

import { AdminTournamentRepository } from "./admin_tournament_repository";
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

  // LIST TOURNAMENTS
  async listTournaments(filters?: {
    q?: string;
    region?: string;
  }): Promise<Result<ITournament[], AdminTournamentError>> {
    const data = await this.repo.findAll(filters);
    return ok(data);
  }

  // TOURNAMENTS BY CREATOR
  async listTournamentsByCreator(
    createdBy?: string
  ): Promise<Result<AdminTournamentRow[], AdminTournamentError>> {
    if (!createdBy) {
      return fail(ADMIN_TOURNAMENT_ERRORS.MISSING_CREATED_BY);
    }

    const data = await this.repo.findByCreator(createdBy);
    return ok(data);
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
      return fail(ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND);
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
      return fail(ADMIN_TOURNAMENT_ERRORS.ENROLLMENT_NOT_FOUND);
    }

    return ok({ cancelled: true });
  }
}