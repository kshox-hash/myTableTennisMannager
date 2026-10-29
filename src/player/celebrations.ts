import DB from "../db/db_configuration";
import { PlayerRepository } from "./player_repository";
import { ittfPointsByCategorySql } from "../ranking/ittf_points";

// Celebración de la posición final: por cada aviso "final_position" que el
// jugador todavía no cerró (celebrated_at NULL), su lugar y el podio de esa
// categoría. La web y la app la muestran como ventana apenas entra; al
// cerrarla en una ya no aparece en la otra.

export type Celebration = {
  id_notification: string;
  id_tournament: string;
  tournament_name: string;
  id_category: string;
  category_label: string;
  position: number;
  // Lo que logró (para las tarjetas sin podio): ronda de la llave a la que
  // llegó (null si quedó en grupos o la categoría no tuvo llave), partidos
  // ganados en la categoría y puntos de ranking que sumó.
  reached_round: number | null;
  total_rounds: number | null;
  matches_won: number;
  ranking_points: number;
  podium: { position: number; id_user: string; name: string; avatar_url: string | null }[];
};

type CelebrationSource = {
  id_notification: string; id_tournament: string; id_category: string;
  tournament_name: string; category_type: string; category_range: string;
};

export async function getPendingCelebrations(idUser: string): Promise<Celebration[]> {
  const pool = DB.getPool();
  const pending = await pool.query<CelebrationSource>(
    `SELECT n.id_notification, n.id_tournament, n.id_category,
            t.tournament_name, tc.category_type, tc.category_range
     FROM notifications n
     JOIN tournaments t ON t.id_tournament = n.id_tournament
     JOIN tournament_categories tc ON tc.id_category = n.id_category
     WHERE n.id_user = $1 AND n.type = 'final_position' AND n.celebrated_at IS NULL
       AND n.created_at > NOW() - INTERVAL '30 days'
     ORDER BY n.created_at ASC
     LIMIT 10`,
    [idUser]
  );
  return buildCelebrations(idUser, pending.rows);
}

/** El resumen de UNA categoría terminada, aunque ya se haya visto (para
 *  volver a abrirlo desde "Logros" o la notificación). null si no jugó ahí
 *  o la categoría no terminó. */
export async function getCelebrationForCategory(idUser: string, idCategory: string): Promise<Celebration | null> {
  const res = await DB.getPool().query<CelebrationSource>(
    `SELECT COALESCE(
              (SELECT n.id_notification::text FROM notifications n
               WHERE n.id_user = $1 AND n.id_category = tc.id_category AND n.type = 'final_position'
               ORDER BY n.created_at DESC LIMIT 1), '') AS id_notification,
            tc.id_tournament, tc.id_category, t.tournament_name, tc.category_type, tc.category_range
     FROM tournament_categories tc
     JOIN tournaments t ON t.id_tournament = tc.id_tournament
     WHERE tc.id_category = $2 AND tc.phase = 'finished'`,
    [idUser, idCategory]
  );
  const [c] = await buildCelebrations(idUser, res.rows);
  return c ?? null;
}

async function buildCelebrations(idUser: string, sources: CelebrationSource[]): Promise<Celebration[]> {
  const pool = DB.getPool();
  const repo = new PlayerRepository();
  const out: Celebration[] = [];
  for (const p of sources) {
    const { standings } = await repo.getCategoryStandings(p.id_tournament, p.id_category);
    const rows = standings as { position: number; id_user: string; player_name: string }[];
    const mine = rows.find((r) => r.id_user === idUser);
    if (!mine) continue;
    const top = rows.filter((r) => Number(r.position) <= 3).slice(0, 4);
    const avatars = top.length
      ? await pool.query<{ id_user: string; avatar_url: string | null }>(
          `SELECT id_user, avatar_url FROM users WHERE id_user = ANY($1::uuid[])`,
          [top.map((r) => r.id_user)]
        )
      : { rows: [] };
    const avatarOf = new Map(avatars.rows.map((a) => [a.id_user, a.avatar_url]));

    const [rounds, wins, pts] = await Promise.all([
      pool.query<{ my_round: number | null; total: number | null }>(
        `SELECT MAX(round) FILTER (WHERE player1_id = $2 OR player2_id = $2) AS my_round, MAX(round) AS total
         FROM bracket_matches WHERE id_category = $1`,
        [p.id_category, idUser]
      ),
      pool.query<{ n: number }>(
        `SELECT (
           (SELECT COUNT(*) FROM group_matches WHERE id_category = $1 AND winner_id = $2) +
           (SELECT COUNT(*) FROM bracket_matches WHERE id_category = $1 AND winner_id = $2
              AND player1_id IS NOT NULL AND player2_id IS NOT NULL)
         )::int AS n`,
        [p.id_category, idUser]
      ),
      pool.query<{ points: number }>(
        `SELECT points FROM (${ittfPointsByCategorySql("t.id_tournament = $1", false)}) x
         WHERE x.id_user = $2 AND x.id_category = $3`,
        [p.id_tournament, idUser, p.id_category]
      ),
    ]);
    const r = rounds.rows[0];
    out.push({
      id_notification: p.id_notification,
      id_tournament: p.id_tournament,
      tournament_name: p.tournament_name,
      id_category: p.id_category,
      category_label: [p.category_type, p.category_range === "General" ? "" : p.category_range].filter(Boolean).join(" "),
      position: Number(mine.position),
      reached_round: r?.my_round ?? null,
      total_rounds: r?.total ?? null,
      matches_won: Number(wins.rows[0]?.n ?? 0),
      ranking_points: Number(pts.rows[0]?.points ?? 0),
      podium: top.map((r) => ({
        position: Number(r.position),
        id_user: r.id_user,
        name: r.player_name,
        avatar_url: avatarOf.get(r.id_user) ?? null,
      })),
    });
  }
  return out;
}

export async function dismissCelebration(idUser: string, idNotification: string): Promise<boolean> {
  const res = await DB.getPool().query(
    `UPDATE notifications SET celebrated_at = NOW(), is_read = TRUE
     WHERE id_notification = $1 AND id_user = $2 AND type = 'final_position'`,
    [idNotification, idUser]
  );
  return (res.rowCount ?? 0) > 0;
}
