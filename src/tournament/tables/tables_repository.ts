import type { Pool } from "pg";
import DB from "../../db/db_configuration";
import { NotificationsRepository } from "../../notifications/notifications_repository";
import { ActivityLogRepository } from "../../activity/activity_log_repository";

export type TableMatch = {
  id_match:      string;
  match_type:    "group" | "bracket";
  id_category:   string;
  category_type: string;
  category_range:string;
  group_name:    string | null;
  round:         number | null;
  round_label:   string | null;
  match_number:  number;
  player1_name:  string | null;
  player2_name:  string | null;
  table_number:  number;
};

export type TableStatus = {
  table_number: number;
  match: TableMatch | null;
};

export type ReadyMatch = {
  id_match:      string;
  match_type:    "group" | "bracket";
  id_category:   string;
  category_type: string;
  category_range:string;
  group_name:    string | null;
  round:         number | null;
  match_number:  number;
  player1_id:    string;
  player2_id:    string;
  player1_name:  string | null;
  player2_name:  string | null;
};

export class TablesRepository {
  private pool: Pool;
  private notifications: NotificationsRepository;
  private activityLog: ActivityLogRepository;
  constructor(pool?: Pool) {
    this.pool = pool ?? DB.getPool();
    this.notifications = new NotificationsRepository(this.pool);
    this.activityLog = new ActivityLogRepository(this.pool);
  }

  // Avisa a los dos jugadores que ya tienen mesa asignada — es el aviso más
  // urgente de todos (hay que ir a jugar YA), así que el frontend lo muestra
  // como modal bloqueante con vibración, no como notificación pasiva.
  private async notifyPlayersTableAssigned(params: {
    player1Id: string | null;
    player2Id: string | null;
    tableNumber: number;
    idTournament: string;
    idCategory: string | null;
    categoryLabel: string;
  }): Promise<void> {
    const { player1Id, player2Id, tableNumber, idTournament, idCategory, categoryLabel } = params;
    const userIds = [player1Id, player2Id].filter((id): id is string => !!id);
    if (userIds.length === 0) return;

    await this.notifications.createForMany(userIds, {
      type: "match_on_table",
      title: "¡Tu mesa está lista!",
      message: `Tu partido de ${categoryLabel} ya tiene mesa: Mesa ${tableNumber}. Andá para allá.`,
      idTournament,
      idCategory,
    });
  }

  async getNumTables(id_tournament: string): Promise<number> {
    const res = await this.pool.query<{ num_tables: number }>(
      `SELECT COALESCE(num_tables, 4) AS num_tables
       FROM tournaments WHERE id_tournament = $1`,
      [id_tournament]
    );
    return Number(res.rows[0]?.num_tables ?? 4);
  }

  async setNumTables(id_tournament: string, num_tables: number): Promise<void> {
    await this.pool.query(
      `UPDATE tournaments SET num_tables = $1 WHERE id_tournament = $2`,
      [num_tables, id_tournament]
    );
  }

  // Partidos actualmente en alguna mesa (en curso)
  async getActiveTables(id_tournament: string): Promise<TableMatch[]> {
    const [groupRes, bracketRes] = await Promise.all([
      this.pool.query<TableMatch>(
        `SELECT
           gm.id_match, 'group' AS match_type,
           tc.id_category, tc.category_type, tc.category_range,
           cg.group_name,
           NULL::int  AS round,
           NULL::text AS round_label,
           gm.match_number,
           gm.table_number,
           COALESCE(NULLIF(TRIM(u1.last_name || ' ' || u1.first_name), ''), u1.email) AS player1_name,
           COALESCE(NULLIF(TRIM(u2.last_name || ' ' || u2.first_name), ''), u2.email) AS player2_name
         FROM group_matches gm
         JOIN category_groups cg  ON cg.id_group    = gm.id_group
         JOIN tournament_categories tc ON tc.id_category = cg.id_category
         LEFT JOIN users u1 ON u1.id_user = gm.player1_id
         LEFT JOIN users u2 ON u2.id_user = gm.player2_id
         WHERE cg.id_tournament = $1
           AND gm.table_number IS NOT NULL`,
        [id_tournament]
      ),
      this.pool.query<TableMatch>(
        `SELECT
           bm.id_match, 'bracket' AS match_type,
           tc.id_category, tc.category_type, tc.category_range,
           NULL::text AS group_name,
           bm.round,
           NULL::text AS round_label,
           bm.match_number,
           bm.table_number,
           COALESCE(NULLIF(TRIM(u1.last_name || ' ' || u1.first_name), ''), u1.email) AS player1_name,
           COALESCE(NULLIF(TRIM(u2.last_name || ' ' || u2.first_name), ''), u2.email) AS player2_name
         FROM bracket_matches bm
         JOIN tournament_categories tc ON tc.id_category = bm.id_category
         LEFT JOIN users u1 ON u1.id_user = bm.player1_id
         LEFT JOIN users u2 ON u2.id_user = bm.player2_id
         WHERE bm.id_tournament = $1
           AND bm.table_number IS NOT NULL`,
        [id_tournament]
      ),
    ]);
    return [...groupRes.rows, ...bracketRes.rows];
  }

  // Jugadores que en este momento ya están jugando en alguna mesa (de
  // cualquier categoría del torneo). Un partido "listo" cuyo jugador esté
  // acá no puede recibir mesa: nadie juega dos partidos a la vez.
  private async getBusyPlayerIds(id_tournament: string): Promise<Set<string>> {
    const [groupRes, bracketRes] = await Promise.all([
      this.pool.query<{ player1_id: string; player2_id: string }>(
        `SELECT gm.player1_id, gm.player2_id
         FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE cg.id_tournament = $1 AND gm.table_number IS NOT NULL`,
        [id_tournament]
      ),
      this.pool.query<{ player1_id: string | null; player2_id: string | null }>(
        `SELECT bm.player1_id, bm.player2_id
         FROM bracket_matches bm
         WHERE bm.id_tournament = $1 AND bm.table_number IS NOT NULL`,
        [id_tournament]
      ),
    ]);

    const busy = new Set<string>();
    for (const r of groupRes.rows) {
      busy.add(r.player1_id);
      busy.add(r.player2_id);
    }
    for (const r of bracketRes.rows) {
      if (r.player1_id) busy.add(r.player1_id);
      if (r.player2_id) busy.add(r.player2_id);
    }
    return busy;
  }

  // Partidos sin mesa asignada, ambos jugadores definidos y sin resultado
  // todavía (sin filtrar por si algún jugador está ocupado en otra mesa —
  // eso se hace después, por separado, para poder mostrar ambos grupos).
  private async loadCandidateMatches(
    id_tournament: string
  ): Promise<{ combined: ReadyMatch[]; busyPlayers: Set<string> }> {
    const [groupRes, bracketRes, busyPlayers] = await Promise.all([
      this.pool.query<ReadyMatch>(
        `SELECT
           gm.id_match, 'group' AS match_type,
           tc.id_category, tc.category_type, tc.category_range,
           cg.group_name, NULL::int AS round, gm.match_number,
           gm.player1_id, gm.player2_id,
           COALESCE(NULLIF(TRIM(u1.last_name || ' ' || u1.first_name), ''), u1.email) AS player1_name,
           COALESCE(NULLIF(TRIM(u2.last_name || ' ' || u2.first_name), ''), u2.email) AS player2_name
         FROM group_matches gm
         JOIN category_groups cg  ON cg.id_group    = gm.id_group
         JOIN tournament_categories tc ON tc.id_category = cg.id_category
         LEFT JOIN users u1 ON u1.id_user = gm.player1_id
         LEFT JOIN users u2 ON u2.id_user = gm.player2_id
         WHERE cg.id_tournament = $1
           AND gm.table_number IS NULL
           AND gm.status = 'scheduled'
           AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
         ORDER BY tc.category_type, cg.sort_order, gm.match_number`,
        [id_tournament]
      ),
      this.pool.query<ReadyMatch>(
        `SELECT
           bm.id_match, 'bracket' AS match_type,
           tc.id_category, tc.category_type, tc.category_range,
           NULL::text AS group_name, bm.round, bm.match_number,
           bm.player1_id, bm.player2_id,
           COALESCE(NULLIF(TRIM(u1.last_name || ' ' || u1.first_name), ''), u1.email) AS player1_name,
           COALESCE(NULLIF(TRIM(u2.last_name || ' ' || u2.first_name), ''), u2.email) AS player2_name
         FROM bracket_matches bm
         JOIN tournament_categories tc ON tc.id_category = bm.id_category
         LEFT JOIN users u1 ON u1.id_user = bm.player1_id
         LEFT JOIN users u2 ON u2.id_user = bm.player2_id
         WHERE bm.id_tournament = $1
           AND bm.table_number IS NULL
           AND bm.status IN ('pending','ready')
           AND bm.player1_id IS NOT NULL AND bm.player2_id IS NOT NULL
         ORDER BY tc.category_type, bm.round, bm.match_number`,
        [id_tournament]
      ),
      this.getBusyPlayerIds(id_tournament),
    ]);

    return { combined: [...groupRes.rows, ...bracketRes.rows], busyPlayers };
  }

  // Partidos listos para jugar (sin mesa asignada, ambos jugadores definidos
  // y ninguno de los dos jugando ya en otra mesa). El orden final reparte de
  // forma justa entre categorías (ver applyFairOrder): ninguna categoría
  // puede acaparar todas las mesas mientras otra espera.
  async getReadyMatches(id_tournament: string): Promise<ReadyMatch[]> {
    const { combined, busyPlayers } = await this.loadCandidateMatches(id_tournament);
    const ready = combined.filter(
      (m) => !busyPlayers.has(m.player1_id) && !busyPlayers.has(m.player2_id)
    );
    return this.applyFairOrder(ready);
  }

  // Partidos que YA tienen a los dos jugadores definidos pero no se pueden
  // jugar todavía porque uno de los dos está en curso en otra mesa (de
  // cualquier categoría). Se muestran aparte para que la cola no "desaparezca"
  // cuando todas las mesas están ocupadas — solo cambia de sección.
  async getBlockedMatches(id_tournament: string): Promise<ReadyMatch[]> {
    const { combined, busyPlayers } = await this.loadCandidateMatches(id_tournament);
    const blocked = combined.filter(
      (m) => busyPlayers.has(m.player1_id) || busyPlayers.has(m.player2_id)
    );
    return this.applyFairOrder(blocked);
  }

  // La cola real de despacho: getReadyMatches ya excluye jugadores ocupados
  // en OTRA mesa existente, pero acá además hay que evitar que dos partidos
  // de la MISMA tanda (ninguno tenía mesa todavía) le den dos mesas al mismo
  // jugador — se van marcando "ocupados" a medida que se toman y se saltan
  // los partidos siguientes que los involucren. Este es el mismo orden que
  // usa el panel de Mesas para sugerir a qué mesa asignar cada partido, así
  // que refleja la cola real (aunque la asignación final la hace el admin
  // a mano, mesa por mesa, no automática).
  async getDispatchQueue(id_tournament: string): Promise<ReadyMatch[]> {
    const ready = await this.getReadyMatches(id_tournament);
    const busyThisBatch = new Set<string>();
    const queue: ReadyMatch[] = [];
    for (const m of ready) {
      if (busyThisBatch.has(m.player1_id) || busyThisBatch.has(m.player2_id)) continue;
      queue.push(m);
      busyThisBatch.add(m.player1_id);
      busyThisBatch.add(m.player2_id);
    }
    return queue;
  }

  // Reparto justo entre categorías: agrupa los partidos listos por categoría
  // (cada grupo ya viene ordenado internamente) y los va tomando en rondas,
  // categoría por categoría, en vez de vaciar una categoría entera antes de
  // pasar a la siguiente. Ninguna categoría activa se queda sin turno.
  private applyFairOrder(matches: ReadyMatch[]): ReadyMatch[] {
    const byCategory = new Map<string, ReadyMatch[]>();
    for (const m of matches) {
      const list = byCategory.get(m.id_category);
      if (list) list.push(m);
      else byCategory.set(m.id_category, [m]);
    }

    const categoryIds = [...byCategory.keys()].sort((a, b) => {
      const first = byCategory.get(a)![0];
      const secondFirst = byCategory.get(b)![0];
      return first.category_type.localeCompare(secondFirst.category_type);
    });

    const queues = categoryIds.map((id) => byCategory.get(id)!);
    const result: ReadyMatch[] = [];
    let tookAny = true;
    while (tookAny) {
      tookAny = false;
      for (const queue of queues) {
        const next = queue.shift();
        if (next) {
          result.push(next);
          tookAny = true;
        }
      }
    }
    return result;
  }

  async assignTable(
    id_match: string,
    match_type: "group" | "bracket",
    table_number: number,
    requestedBy: string
  ): Promise<void> {
    // Nadie puede jugar dos partidos a la vez: si alguno de los dos jugadores
    // ya está en otra mesa del torneo, no se permite esta asignación.
    const table = match_type === "group" ? "group_matches" : "bracket_matches";
    type MatchRow = {
      player1_id: string | null;
      player2_id: string | null;
      id_tournament: string;
      id_category: string;
      category_type: string;
      category_range: string;
    };
    const playersRes =
      match_type === "group"
        ? await this.pool.query<MatchRow>(
            `SELECT gm.player1_id, gm.player2_id, cg.id_tournament, tc.id_category, tc.category_type, tc.category_range
             FROM group_matches gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
             JOIN tournament_categories tc ON tc.id_category = cg.id_category
             WHERE gm.id_match = $1`,
            [id_match]
          )
        : await this.pool.query<MatchRow>(
            `SELECT bm.player1_id, bm.player2_id, bm.id_tournament, tc.id_category, tc.category_type, tc.category_range
             FROM bracket_matches bm
             JOIN tournament_categories tc ON tc.id_category = bm.id_category
             WHERE bm.id_match = $1`,
            [id_match]
          );
    const match = playersRes.rows[0];
    if (!match) throw new Error("MATCH_NOT_FOUND");

    // La mesa solo puede estar "ocupada" dentro del mismo torneo — el número
    // de mesa no es un identificador global, cada torneo numera las suyas.
    const [groupOccupied, bracketOccupied] = await Promise.all([
      this.pool.query(
        `SELECT 1 FROM group_matches gm
         JOIN category_groups cg ON cg.id_group = gm.id_group
         WHERE gm.table_number = $1 AND cg.id_tournament = $2 AND gm.id_match != $3 LIMIT 1`,
        [table_number, match.id_tournament, match_type === "group" ? id_match : "00000000-0000-0000-0000-000000000000"]
      ),
      this.pool.query(
        `SELECT 1 FROM bracket_matches
         WHERE table_number = $1 AND id_tournament = $2 AND id_match != $3 LIMIT 1`,
        [table_number, match.id_tournament, match_type === "bracket" ? id_match : "00000000-0000-0000-0000-000000000000"]
      ),
    ]);
    if ((groupOccupied.rowCount ?? 0) > 0 || (bracketOccupied.rowCount ?? 0) > 0) {
      throw new Error("TABLE_ALREADY_OCCUPIED");
    }

    const busyPlayers = await this.getBusyPlayerIds(match.id_tournament);
    if (
      (match.player1_id && busyPlayers.has(match.player1_id)) ||
      (match.player2_id && busyPlayers.has(match.player2_id))
    ) {
      throw new Error("PLAYER_ALREADY_PLAYING");
    }

    await this.pool.query(
      `UPDATE ${table}
       SET table_number = $1
       WHERE id_match = $2`,
      [table_number, id_match]
    );

    await this.notifyPlayersTableAssigned({
      player1Id: match.player1_id,
      player2Id: match.player2_id,
      tableNumber: table_number,
      idTournament: match.id_tournament,
      idCategory: match.id_category,
      categoryLabel: `${match.category_type} ${match.category_range}`,
    });

    await this.activityLog.record(
      match.id_tournament,
      requestedBy,
      "table_assigned",
      `Mesa ${table_number} → ${match.category_type} ${match.category_range}`
    );
  }

  async releaseTable(
    id_match: string,
    match_type: "group" | "bracket",
    requestedBy: string
  ): Promise<void> {
    const table = match_type === "group" ? "group_matches" : "bracket_matches";

    // group_matches no tiene id_tournament propio (hay que salir por
    // category_groups); bracket_matches sí lo tiene directo — mismo join que
    // ya usa assignTable para lo mismo.
    type TournamentLookup = { id_tournament: string };
    const lookupRes =
      match_type === "group"
        ? await this.pool.query<TournamentLookup>(
            `SELECT cg.id_tournament FROM group_matches gm
             JOIN category_groups cg ON cg.id_group = gm.id_group
             WHERE gm.id_match = $1`,
            [id_match]
          )
        : await this.pool.query<TournamentLookup>(
            `SELECT id_tournament FROM bracket_matches WHERE id_match = $1`,
            [id_match]
          );
    const idTournament = lookupRes.rows[0]?.id_tournament;

    const res = await this.pool.query<{ table_number: number | null }>(
      `UPDATE ${table}
       SET table_number = NULL
       WHERE id_match = $1 AND table_number IS NOT NULL
       RETURNING table_number`,
      [id_match]
    );
    const releasedTable = res.rows[0]?.table_number;

    if (idTournament && releasedTable) {
      await this.activityLog.record(idTournament, requestedBy, "table_released", `Mesa ${releasedTable}`);
    }
  }

}
