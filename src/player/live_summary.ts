import DB from "../db/db_configuration";

// "En vivo" del Inicio de la app: en la categoría que el jugador está
// jugando, dos listas de nombres que se actualizan con cada resultado:
//  - clasificados: los que pasaron su grupo (al terminar el grupo) y todavía
//    no perdieron en la llave;
//  - eliminados: los que no pasaron su grupo y los que perdieron en la
//    llave (lo más reciente primero), con dónde quedaron ("Grupo 3",
//    "Cuartos de final"). El 3° de una categoría Oro figura "Pasó a Plata".
// Quien entra directo a la llave (Plata no tiene grupos) cuenta como
// clasificado mientras no pierda.
// En la llave dice además qué ronda se está jugando.
// Nunca devuelve categorías terminadas: para eso está la celebración.

type Person = { id_user: string; name: string; is_me: boolean };

export type LiveSummary = {
  id_tournament: string;
  tournament_name: string;
  id_category: string;
  category_label: string;
  phase: "groups" | "bracket";
  current_round: string | null; // llave: "Cuartos de final"
  classified: Person[];
  eliminated: (Person & { stage: string })[];
};

const pool = () => DB.getPool();

const name = (alias: string) =>
  `COALESCE(NULLIF(TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, '')), ''), ${alias}.email)`;

/** "Final", "Semifinal", "Cuartos de final", "Octavos de final" o "Ronda de 32". */
export function roundLabel(playersInRound: number): string {
  if (playersInRound <= 2) return "Final";
  if (playersInRound <= 4) return "Semifinal";
  if (playersInRound <= 8) return "Cuartos de final";
  if (playersInRound <= 16) return "Octavos de final";
  return `Ronda de ${playersInRound}`;
}

export async function getLiveSummary(id_user: string): Promise<LiveSummary[]> {
  // Yo y mis parejas de dobles (el equipo juega como un id_user aparte).
  const teams = await pool().query<{ id_user: string }>(
    `SELECT id_user FROM doubles_teams WHERE id_player_1 = $1 OR id_player_2 = $1`,
    [id_user]
  );
  const ids = [id_user, ...teams.rows.map((r) => r.id_user)];
  const me = new Set(ids);
  const person = (id: string, n: string | null): Person => ({ id_user: id, name: n ?? "", is_me: me.has(id) });

  // Categorías en juego donde estoy (en un grupo o en la llave).
  const cats = await pool().query<{
    id_tournament: string; tournament_name: string; id_category: string;
    category_type: string; category_range: string; phase: "groups" | "bracket";
    silver_category_id: string | null;
  }>(
    `SELECT DISTINCT t.id_tournament, t.tournament_name, tc.id_category,
            tc.category_type, tc.category_range, tc.phase, tc.silver_category_id
       FROM tournament_categories tc
       JOIN tournaments t ON t.id_tournament = tc.id_tournament
      WHERE t.status = 'active'
        AND tc.phase IN ('groups', 'bracket')
        AND tc.status <> 'cancelled'
        AND (
          EXISTS (SELECT 1 FROM group_members gm JOIN category_groups cg ON cg.id_group = gm.id_group
                   WHERE cg.id_category = tc.id_category AND gm.id_user = ANY($1::uuid[]))
          OR EXISTS (SELECT 1 FROM bracket_matches bm
                      WHERE bm.id_category = tc.id_category
                        AND (bm.player1_id = ANY($1::uuid[]) OR bm.player2_id = ANY($1::uuid[])))
        )
      ORDER BY t.tournament_name, tc.category_type`,
    [ids]
  );

  const out: LiveSummary[] = [];
  for (const c of cats.rows) {
    const [groups, standings, losers, rounds, bracketPlayers, silverPlayers] = await Promise.all([
      // Grupos con todos sus partidos jugados, el último en terminar primero.
      pool().query<{ id_group: string; group_name: string; qualifiers: number }>(
        `SELECT cg.id_group, cg.group_name, COALESCE(cg.qualifiers_per_group, 2) AS qualifiers
           FROM category_groups cg
           JOIN group_matches gm ON gm.id_group = cg.id_group
          WHERE cg.id_category = $1
          GROUP BY cg.id_group
         HAVING COUNT(*) FILTER (WHERE gm.status NOT IN ('played', 'walkover')) = 0
          ORDER BY MAX(gm.played_at) DESC NULLS LAST`,
        [c.id_category]
      ),
      pool().query<{ id_group: string; id_user: string; name: string; qualified_to_bracket: boolean }>(
        `SELECT gs.id_group, gs.id_user, ${name("u")} AS name, gs.qualified_to_bracket
           FROM group_standings gs
           JOIN category_groups cg ON cg.id_group = gs.id_group
           JOIN users u ON u.id_user = gs.id_user
          WHERE cg.id_category = $1
          ORDER BY gs.position NULLS LAST, gs.won DESC, (gs.sets_for - gs.sets_against) DESC`,
        [c.id_category]
      ),
      // Los que perdieron en la llave, el más reciente primero.
      pool().query<{ id_user: string; name: string; round: number }>(
        `SELECT bm.round, CASE WHEN bm.winner_id = bm.player1_id THEN bm.player2_id ELSE bm.player1_id END AS id_user,
                CASE WHEN bm.winner_id = bm.player1_id THEN ${name("u2")} ELSE ${name("u1")} END AS name
           FROM bracket_matches bm
           JOIN users u1 ON u1.id_user = bm.player1_id
           JOIN users u2 ON u2.id_user = bm.player2_id
          WHERE bm.id_category = $1 AND bm.winner_id IS NOT NULL AND bm.status <> 'bye'
          ORDER BY bm.round DESC, bm.played_at DESC NULLS LAST`,
        [c.id_category]
      ),
      // Rondas de la llave: la última (final) y la primera con un partido
      // real sin ganador (la que se está jugando).
      pool().query<{ max_round: number | null; current: number | null }>(
        `SELECT MAX(round) AS max_round,
                MIN(round) FILTER (WHERE winner_id IS NULL AND status <> 'bye'
                                     AND player1_id IS NOT NULL AND player2_id IS NOT NULL) AS current
           FROM bracket_matches WHERE id_category = $1`,
        [c.id_category]
      ),
      pool().query<{ id_user: string; name: string }>(
        `SELECT DISTINCT p.id_user, ${name("u")} AS name
           FROM (
             SELECT player1_id AS id_user FROM bracket_matches WHERE id_category = $1
             UNION
             SELECT player2_id FROM bracket_matches WHERE id_category = $1
           ) p
           JOIN users u ON u.id_user = p.id_user`,
        [c.id_category]
      ),
      pool().query<{ id_user: string }>(
        `SELECT id_user FROM enrollments WHERE id_category = $1 AND status = 'active'`,
        [c.silver_category_id]
      ),
    ]);
    const maxRound = rounds.rows[0]?.max_round ?? null;
    const label = (round: number) => (maxRound == null ? "" : roundLabel(2 ** (maxRound - round + 1)));
    const current = rounds.rows[0]?.current ?? null;

    const bracketDrawn = standings.rows.some((s) => s.qualified_to_bracket);
    const lostInBracket = new Set(losers.rows.map((l) => l.id_user));
    const inSilver = new Set(silverPlayers.rows.map((p) => p.id_user));
    const classified: Person[] = [];
    const eliminated: (Person & { stage: string })[] = losers.rows.map((l) => ({ ...person(l.id_user, l.name), stage: label(l.round) }));
    for (const g of groups.rows) {
      const rows = standings.rows.filter((s) => s.id_group === g.id_group);
      rows.forEach((s, i) => {
        // Pasan: los marcados al generar la llave; antes, los primeros
        // qualifiers_per_group del grupo terminado.
        const passes = bracketDrawn ? s.qualified_to_bracket : i < g.qualifiers;
        if (!passes) {
          const stage = inSilver.has(s.id_user) ? "Pasó a Plata" : `Grupo ${g.group_name.replace(/^GR-?/i, "")}`;
          eliminated.push({ ...person(s.id_user, s.name), stage });
        } else if (!lostInBracket.has(s.id_user)) classified.push(person(s.id_user, s.name));
      });
    }
    const listed = new Set(classified.map((p) => p.id_user));
    for (const p of bracketPlayers.rows) {
      if (!lostInBracket.has(p.id_user) && !listed.has(p.id_user)) classified.push(person(p.id_user, p.name));
    }

    out.push({
      id_tournament: c.id_tournament,
      tournament_name: c.tournament_name,
      id_category: c.id_category,
      category_label: [c.category_type, c.category_range === "General" ? "" : c.category_range].filter(Boolean).join(" "),
      phase: c.phase,
      current_round: c.phase === "bracket" && current != null ? label(current) : null,
      classified,
      eliminated,
    });
  }
  return out;
}
