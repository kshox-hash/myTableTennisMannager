import { UserRepository } from "./user_repository";
import type { UserProfileDB, PlayerStatsDB, UserSearchRow } from "./dto/user_dto";
import type { UpdateProfileDTO, QuickCreatePlayerDTO } from "./schema/user_schema";
import { type Result, ok, fail } from "../core/constants/result";

export class UserService {
  constructor(private repo: UserRepository) {}

  async getProfile(id_user: string): Promise<Result<UserProfileDB, "USER_NOT_FOUND">> {
    const user = await this.repo.findById(id_user);
    if (!user) return fail("USER_NOT_FOUND");
    return ok(user);
  }

  async updateProfile(
    id_user: string,
    input: UpdateProfileDTO
  ): Promise<Result<UserProfileDB, "USER_NOT_FOUND">> {
    const user = await this.repo.updateProfile(id_user, input);
    if (!user) return fail("USER_NOT_FOUND");
    return ok(user);
  }

  // Ficha pública de un jugador — visible para cualquier usuario logueado
  // (clickeando su nombre en llaves/grupos/inscritos), no solo para sí mismo.
  // No expone el email, a diferencia de getProfile (usado en "mi perfil").
  async getPublicProfile(id_user: string) {
    const user = await this.repo.findById(id_user);
    if (!user) return fail("USER_NOT_FOUND" as const);

    const stats = await this.repo.findStatsById(id_user);
    return ok({
      id_user: user.id_user,
      first_name: user.first_name,
      last_name: user.last_name,
      club_name: user.club_name,
      gender: user.gender,
      stats: stats ?? {
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        sets_won: 0,
        sets_lost: 0,
      },
    });
  }

  // Ficha mínima de un jugador, sin exigir sesión — usada por las páginas
  // públicas del sitio (sin login), a diferencia de getPublicProfile (que sí
  // exige estar logueado y además trae estadísticas de partidos). Expone
  // solo lo pensado para mostrarse en una tarjeta pública: nombre, club,
  // mano dominante, país y fecha de nacimiento (la edad se calcula en el
  // frontend a partir de esta última). Nada de email ni datos sensibles.
  async getPublicCard(id_user: string) {
    const user = await this.repo.findById(id_user);
    if (!user) return fail("USER_NOT_FOUND" as const);

    return ok({
      id_user: user.id_user,
      first_name: user.first_name,
      last_name: user.last_name,
      club_name: user.club_name,
      dominant_hand: user.dominant_hand,
      country: user.country,
      birth_date: user.birth_date,
    });
  }

  // Búsqueda de jugadores (admin) — para inscribirlos manualmente en una categoría.
  async searchPlayers(q: string): Promise<Result<UserSearchRow[], "QUERY_TOO_SHORT">> {
    const trimmed = q.trim();
    if (trimmed.length < 2) return fail("QUERY_TOO_SHORT");

    const data = await this.repo.searchPlayers(trimmed);
    return ok(data);
  }

  // Crea un jugador sin cuenta (walk-in) y lo devuelve listo para inscribir.
  async createQuickPlayer(input: QuickCreatePlayerDTO): Promise<Result<UserSearchRow, never>> {
    const data = await this.repo.createQuickPlayer({
      firstName: input.first_name,
      lastName: input.last_name,
      gender: input.gender,
      clubName: input.club_name,
    });
    return ok(data);
  }

  async getStats(id_user: string): Promise<Result<PlayerStatsDB, never>> {
    const stats = await this.repo.findStatsById(id_user);

    // Si aún no tiene partidos, devolvemos ceros en lugar de 404
    return ok(stats ?? {
      id_user,
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      sets_won: 0,
      sets_lost: 0,
      updated_at: new Date().toISOString(),
    });
  }
}
