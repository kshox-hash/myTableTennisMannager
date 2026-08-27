import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import type { ScheduleMatchInput } from "./schedule_logic";

export type DueScheduledMatch = {
  id_match: string;
  id_tournament: string;
  scheduled_table_number: number;
  created_by: string;
};

export class ScheduleRepository {
  private pool: Pool;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
  }

  async getNumTables(id_tournament: string): Promise<number> {
    const res = await this.pool.query<{ num_tables: number }>(
      `SELECT COALESCE(num_tables, 4) AS num_tables FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    return Number(res.rows[0]?.num_tables ?? 4);
  }

  // event_date/event_time: hace falta la fecha real del torneo para
  // convertir los "minutos desde el inicio" de simulateSchedule en un
  // TIMESTAMPTZ absoluto al confirmar el horario.
  async getTournamentDate(id_tournament: string): Promise<{ event_date: string | null }> {
    const res = await this.pool.query<{ event_date: string | null }>(
      `SELECT event_date::text AS event_date FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    return { event_date: res.rows[0]?.event_date ?? null };
  }

  // Graba el horario confirmado — la corrida de simulateSchedule que el
  // admin decidió aceptar, ahora sí persistida (antes solo vivía en la
  // respuesta del GET, se perdía al refrescar). match_duration_minutes
  // queda guardado como conveniencia para prellenar el formulario la
  // próxima vez.
  async persistSchedule(
    id_tournament: string,
    matchDurationMinutes: number,
    scheduled: Array<{ id_match: string; table_number: number; start_at: string }>
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE tournaments SET match_duration_minutes = $1 WHERE id_tournament = $2`,
        [matchDurationMinutes, id_tournament]
      );
      for (const m of scheduled) {
        await client.query(
          `UPDATE group_matches
           SET scheduled_table_number = $1, scheduled_start_at = $2
           WHERE id_match = $3`,
          [m.table_number, m.start_at, m.id_match]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Partidos con horario confirmado cuya hora ya llegó y que todavía no
  // tienen mesa EN VIVO asignada — lo que el scheduler de activación
  // procesa cada 30s. Cruza todos los torneos, no uno puntual: es un job
  // de fondo, igual que processScheduled() en tournament_phase_service.
  async getDueScheduledMatches(): Promise<DueScheduledMatch[]> {
    const res = await this.pool.query<DueScheduledMatch>(
      `SELECT gm.id_match, cg.id_tournament, gm.scheduled_table_number, t.created_by
       FROM group_matches gm
       JOIN category_groups cg ON cg.id_group = gm.id_group
       JOIN tournaments t ON t.id_tournament = cg.id_tournament
       WHERE gm.scheduled_start_at IS NOT NULL
         AND gm.scheduled_start_at <= NOW()
         AND gm.table_number IS NULL
         AND gm.status = 'scheduled'
       ORDER BY gm.scheduled_start_at ASC`
    );
    return res.rows;
  }

  // Todos los partidos de grupo sin resultado todavía, de cualquier
  // categoría del torneo que ya esté en fase de grupos — es lo que la
  // "programación" tiene sentido de proyectar (partidos de llave no entran:
  // sus emparejamientos dependen de resultados que todavía no existen).
  async getPendingGroupMatches(id_tournament: string): Promise<ScheduleMatchInput[]> {
    const res = await this.pool.query<ScheduleMatchInput>(
      `SELECT
         gm.id_match, 'group' AS match_type,
         tc.id_category, tc.category_type, tc.category_range,
         cg.group_name, NULL::int AS round, gm.match_number,
         gm.player1_id, gm.player2_id
       FROM group_matches gm
       JOIN category_groups cg ON cg.id_group = gm.id_group
       JOIN tournament_categories tc ON tc.id_category = cg.id_category
       WHERE cg.id_tournament = $1
         AND gm.status = 'scheduled'
         AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
       ORDER BY tc.category_type, cg.sort_order, gm.match_number`,
      [id_tournament]
    );
    return res.rows;
  }
}
