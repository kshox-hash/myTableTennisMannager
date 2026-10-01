import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";
import { ActivityLogRepository } from "../../activity/activity_log_repository";

// "Finalizar campeonato" en cualquier momento (sin tener que jugar todo):
//  - las categorías que no habían terminado pasan a 'finished' con
//    finished_early (cortadas a medias → sin podio ni medallas);
//  - los partidos pendientes se borran (si no, seguían apareciendo como
//    "por jugar" / "próximo partido" y en la cola de mesas);
//  - lo ya jugado se conserva (historial y estadísticas de cada jugador);
//  - las categorías que ya estaban terminadas no se tocan (mantienen podio);
//  - se avisa a los inscritos.
// A diferencia de "cancelar", el campeonato sigue visible como Finalizado.
export type FinishResult =
  | { ok: true; categories: number; cancelledMatches: number }
  | { ok: false; status: number; message: string };

export async function finishTournament(idTournament: string, requestedBy: string): Promise<FinishResult> {
  const pool = DB.getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = (
      await client.query<{ status: string; tournament_name: string }>(
        `SELECT status, tournament_name FROM tournaments WHERE id_tournament = $1 FOR UPDATE`,
        [idTournament]
      )
    ).rows[0];
    if (!t) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Campeonato no encontrado" };
    }
    if (t.status === "cancelled") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Este campeonato está cancelado" };
    }
    const open = (
      await client.query<{ id_category: string }>(
        `SELECT id_category FROM tournament_categories WHERE id_tournament = $1 AND phase <> 'finished'`,
        [idTournament]
      )
    ).rows.map((r) => r.id_category);
    if (open.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Este campeonato ya estaba finalizado" };
    }

    const g = await client.query(
      `DELETE FROM group_matches gm USING category_groups cg
        WHERE gm.id_group = cg.id_group AND cg.id_category = ANY($1::uuid[])
          AND gm.winner_id IS NULL AND gm.status NOT IN ('played', 'walkover')`,
      [open]
    );
    const b = await client.query(
      `DELETE FROM bracket_matches
        WHERE id_category = ANY($1::uuid[]) AND winner_id IS NULL AND status IN ('pending', 'ready')`,
      [open]
    );
    await client.query(
      `UPDATE tournament_categories SET phase = 'finished', finished_early = true WHERE id_category = ANY($1::uuid[])`,
      [open]
    );

    const users = (
      await client.query<{ id_user: string }>(
        `SELECT DISTINCT id_user FROM enrollments WHERE id_tournament = $1 AND status = 'active'`,
        [idTournament]
      )
    ).rows.map((r) => r.id_user);
    if (users.length > 0) {
      await new NotificationsRepository(pool).createForMany(
        users,
        {
          type: "tournament_finished",
          title: "Campeonato finalizado",
          message: `El organizador finalizó "${t.tournament_name}". Los partidos pendientes se cancelaron; lo ya jugado queda en tu historial.`,
          idTournament,
        },
        client
      );
    }
    await new ActivityLogRepository(pool).record(idTournament, requestedBy, "tournament_finished", null, client);
    await client.query("COMMIT");
    return { ok: true, categories: open.length, cancelledMatches: (g.rowCount ?? 0) + (b.rowCount ?? 0) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
