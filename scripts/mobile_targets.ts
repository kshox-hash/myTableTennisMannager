// Genera targets.json para la auditoría móvil (scratchpad/mobile/audit.mjs):
// sesiones firmadas localmente + rutas con IDs reales de la base simulada.
import fs from "fs";
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const one = async (sql: string) => (await pool.query(sql)).rows[0];

  const player = await one(`SELECT u.id_user, u.email FROM users u JOIN player_stats s USING (id_user)
                            WHERE u.email LIKE '%sim.myttm.cl'
                              AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.id_user = u.id_user AND n.type = 'match_on_table' AND NOT n.is_read)
                            ORDER BY s.matches_played DESC LIMIT 1`);
  const org = await one(`SELECT u.id_user, u.email FROM users u JOIN clubs c ON c.created_by = u.id_user
                         WHERE u.email LIKE 'organizador%' ORDER BY (SELECT COUNT(*) FROM tournaments t WHERE t.created_by = u.id_user) DESC LIMIT 1`);
  const club = await one(`SELECT id_club FROM clubs WHERE created_by = '${org.id_user}'`);
  const t = await one(`SELECT c.id_tournament AS t, c.id_category AS c FROM tournament_categories c
                       JOIN tournaments tt USING (id_tournament) JOIN category_groups g ON g.id_category = c.id_category
                       WHERE c.phase = 'finished' AND tt.status = 'active' GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 1`);
  const orgT = await one(`SELECT c.id_tournament AS t FROM tournament_categories c JOIN tournaments tt USING (id_tournament)
                          WHERE tt.created_by = '${org.id_user}' AND c.phase IN ('groups', 'bracket') LIMIT 1`);
  const pe = await one(`SELECT id_tournament AS t, id_category AS c FROM enrollments WHERE id_user = '${player.id_user}' LIMIT 1`);
  const bm = await one(`SELECT id_match FROM bracket_matches WHERE status = 'played' LIMIT 1`);

  const sessions = {
    publico: null,
    jugador: { token: signToken({ id_user: player.id_user, role: "player" }), role: "player", userId: player.id_user, email: player.email },
    admin: { token: signToken({ id_user: org.id_user, role: "admin" }), role: "admin", userId: org.id_user, email: org.email },
  };
  const routes = {
    publico: [
      ["landing", "/"],
      ["torneos", "/torneos"],
      ["torneo", `/torneos/${t.t}`],
      ["categoria", `/torneos/${t.t}/categorias/${t.c}`],
      ["partido", `/torneos/partidos/bracket/${bm.id_match}`],
      ["comunidad", "/comunidad"],
      ["organizador", `/comunidad/${org.id_user}`],
      ["jugador_publico", `/jugadores/${player.id_user}`],
      ["login", "/login"],
      ["registro", "/register"],
    ],
    jugador: [
      ["inicio", "/home"],
      ["campeonatos", "/tournaments"],
      ["campeonato", `/tournaments/${pe.t}`],
      ["mi_categoria", `/tournaments/${pe.t}/categories/${pe.c}/my-category`],
      ["llave", `/tournaments/${t.t}/categories/${t.c}/bracket`],
      ["partidos_torneo", `/tournaments/${pe.t}/matches`],
      ["partido", `/matches/bracket/${bm.id_match}`],
      ["calendario", "/calendar"],
      ["historial", "/history"],
      ["estadisticas", "/stats"],
      ["notificaciones", "/notifications"],
      ["mi_perfil", "/profile"],
      ["ficha_jugador", `/players/${player.id_user}`],
    ],
    admin: [
      ["mi_perfil", "/admin/profile"],
      ["panel", "/admin"],
      ["crear_torneo", "/admin/tournaments/new"],
      ["workspace", `/admin/tournaments/${orgT.t}`],
      ["mi_club_lista", "/admin/clubs"],
      ["mi_club", `/admin/clubs/${club.id_club}`],
      ["mi_ranking", "/admin/ranking"],
      ["notificaciones", "/admin/notifications"],
    ],
  };
  const out = process.argv[2];
  fs.writeFileSync(out, JSON.stringify({ sessions, routes }, null, 2));
  console.log("ok", Object.values(routes).flat().length, "rutas");
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
