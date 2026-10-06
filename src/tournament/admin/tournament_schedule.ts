import DB from "../../db/db_configuration";

// Días del campeonato: cada categoría puede tener su día (play_date) y hora
// de inicio (start_time). La web sugiere un reparto automático (según
// inscritos, mesas y sets) y el organizador lo ajusta a mano; acá solo se
// guarda. La fecha de término (end_date) sale del último día usado.
export type ScheduleItem = { id_category: string; play_date: string | null; start_time: string | null };

export type ScheduleResult = { ok: true; end_date: string | null } | { ok: false; status: number; message: string };

export async function saveTournamentSchedule(
  idTournament: string,
  dayHours: number | undefined,
  items: ScheduleItem[]
): Promise<ScheduleResult> {
  const client = await DB.getPool().connect();
  try {
    await client.query("BEGIN");
    const t = (
      await client.query<{ event_date: string | null }>(
        `SELECT event_date::text FROM tournaments WHERE id_tournament = $1 FOR UPDATE`,
        [idTournament]
      )
    ).rows[0];
    if (!t) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Campeonato no encontrado" };
    }
    for (const it of items) {
      if (it.play_date && t.event_date && it.play_date < t.event_date) {
        await client.query("ROLLBACK");
        return { ok: false, status: 400, message: "Una categoría no puede jugarse antes de la fecha de inicio del campeonato." };
      }
      await client.query(
        `UPDATE tournament_categories SET play_date = $1::date, start_time = $2::time
          WHERE id_category = $3 AND id_tournament = $4`,
        [it.play_date, it.start_time, it.id_category, idTournament]
      );
    }
    if (dayHours !== undefined) {
      await client.query(`UPDATE tournaments SET day_hours = $1 WHERE id_tournament = $2`, [dayHours, idTournament]);
    }
    // Término = último día con categorías, si es posterior al inicio.
    const end = await client.query<{ end_date: string | null }>(
      `UPDATE tournaments t
          SET end_date = (
            SELECT CASE WHEN MAX(tc.play_date) > t.event_date THEN MAX(tc.play_date) END
            FROM tournament_categories tc WHERE tc.id_tournament = t.id_tournament
          )
        WHERE t.id_tournament = $1
        RETURNING end_date::text`,
      [idTournament]
    );
    await client.query("COMMIT");
    return { ok: true, end_date: end.rows[0]?.end_date ?? null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
