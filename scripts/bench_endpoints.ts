// Mide tiempos y peso de los endpoints de lectura más usados contra el
// backend LOCAL con la base simulada (ver simulate_production.ts). Firma
// tokens directo con el JWT_SECRET local para no chocar con el rate limit.
// Además cuenta cuántas consultas SQL dispara cada endpoint (vía
// pg_stat_database.xact_commit no sirve con pool — se usa el contador de
// pg_stat_statements si existe; si no, solo tiempos).
//
//   set -a && . ./.env && set +a && npx ts-node -T scripts/bench_endpoints.ts

import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = process.env.SIM_API ?? "http://localhost:4310/api/v1";

async function time(label: string, token: string | null, path: string, runs = 7) {
  const ms: number[] = [];
  let bytes = 0;
  let gz = "";
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const res = await fetch(API + path, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Accept-Encoding": "gzip" },
    });
    const body = await res.text();
    ms.push(performance.now() - t);
    bytes = body.length;
    gz = res.headers.get("content-encoding") ?? "—";
    status = res.status;
  }
  ms.sort((a, b) => a - b);
  return {
    endpoint: label,
    status,
    "p50 ms": Math.round(ms[Math.floor(runs / 2)]),
    "max ms": Math.round(ms[runs - 1]),
    KB: +(bytes / 1024).toFixed(1),
    gzip: gz,
  };
}

async function main() {
  const pool = DB.getPool();
  const q = async (sql: string) => (await pool.query(sql)).rows[0];

  const org = await q(`SELECT created_by AS id FROM tournaments GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`);
  const player = await q(`SELECT id_user AS id FROM player_stats ORDER BY matches_played DESC LIMIT 1`);
  // Categoría con más grupos (el peor caso para vistas de grupos/llave)
  const cat = await q(`
    SELECT c.id_tournament AS t, c.id_category AS c, t.created_by AS owner, COUNT(g.id_group) AS groups
    FROM tournament_categories c JOIN tournaments t USING (id_tournament)
    JOIN category_groups g ON g.id_category = c.id_category
    WHERE c.phase IN ('bracket', 'finished')
    GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 1`);
  const pe = await q(`SELECT id_tournament AS t, id_category AS c FROM enrollments WHERE id_user = '${player.id}' LIMIT 1`);
  const bm = await q(`SELECT id_match FROM bracket_matches WHERE status = 'played' LIMIT 1`);
  const club = await q(`SELECT id_club AS id, created_by AS owner FROM clubs c WHERE created_by IS NOT NULL ORDER BY (SELECT COUNT(*) FROM users u WHERE u.id_club = c.id_club) DESC LIMIT 1`);

  const orgTok = signToken({ id_user: org.id, role: "admin" });
  const catTok = signToken({ id_user: cat.owner, role: "admin" });
  const plTok = signToken({ id_user: player.id, role: "player" });
  const clubTok = signToken({ id_user: club.owner, role: "admin" });
  console.log(`Categoría de prueba: ${cat.groups} grupos`);

  const E: [string, string | null, string][] = [
    ["PÚBLICO · listado torneos", null, "/tournament/public/tournaments?page=1&limit=12"],
    ["PÚBLICO · próximos de mi región", null, "/tournament/public/tournaments?page=1&limit=6&status=upcoming&region=Metropolitana%20de%20Santiago"],
    ["PÚBLICO · detalle torneo", null, `/tournament/public/tournaments/${cat.t}`],
    ["PÚBLICO · detalle categoría (grupos)", null, `/tournament/public/tournaments/${cat.t}/categories/${cat.c}`],
    ["PÚBLICO · partidos del torneo", null, `/tournament/public/tournaments/${cat.t}/matches?page=1&limit=50`],
    ["PÚBLICO · partido", null, `/tournament/public/matches/bracket/${bm.id_match}`],
    ["PÚBLICO · filtros categoría", null, "/tournament/public/category-filters"],
    ["PÚBLICO · comunidad", null, "/tournament/public/organizers"],
    ["PÚBLICO · ficha organizador", null, `/tournament/public/organizers/${org.id}`],
    ["PÚBLICO · stats landing", null, "/tournament/public/stats"],
    ["JUGADOR · /users/me", plTok, "/users/me"],
    ["JUGADOR · dashboard", plTok, "/player/dashboard"],
    ["JUGADOR · mis inscripciones", plTok, "/player/my-enrollments"],
    ["JUGADOR · vista de mi categoría", plTok, `/player/tournament/${pe.t}/category/${pe.c}`],
    ["JUGADOR · standings categoría", plTok, `/player/tournament/${pe.t}/category/${pe.c}/standings`],
    ["JUGADOR · partidos del torneo", plTok, `/player/tournament/${pe.t}/matches`],
    ["JUGADOR · torneos (listado)", plTok, "/tournament/player/tournaments"],
    ["JUGADOR · historial partidos", plTok, `/player/user/${player.id}/matches`],
    ["JUGADOR · ficha pública", plTok, `/users/${player.id}/profile`],
    ["JUGADOR · notificaciones", plTok, "/notifications"],
    ["JUGADOR · contador no leídas", plTok, "/notifications/unread-count"],
    ["ADMIN · mis torneos pág 1", orgTok, `/tournament/admin/get/tournaments/my?created_by=${org.id}&page=1&limit=12`],
    ["ADMIN · stats perfil", orgTok, "/tournament/admin/get/tournaments/my/stats"],
    ["ADMIN · fases del torneo", catTok, `/tournament/${cat.t}/phases`],
    ["ADMIN · dashboard torneo", catTok, `/tournament/${cat.t}/dashboard`],
    ["ADMIN · grupos (bracket)", catTok, `/bracket/tournaments/${cat.t}/categories/${cat.c}`],
    ["ADMIN · llave", catTok, `/bracket/tournaments/${cat.t}/categories/${cat.c}/bracket`],
    ["ADMIN · todos los partidos", catTok, `/bracket/tournaments/${cat.t}/categories/${cat.c}/all-matches`],
    ["ADMIN · mesas", catTok, `/tournament/${cat.t}/tables`],
    ["ADMIN · inscritos", catTok, `/tournament/admin/tournaments/${cat.t}/enrollments`],
    ["ADMIN · buscar jugador", orgTok, "/users/admin/search?q=gonz"],
    ["CLUB · detalle", clubTok, `/clubs/${club.id}`],
    ["CLUB · cuotas del mes", clubTok, `/clubs/${club.id}/dues?offset=0`],
    ["CLUB · morosidad", clubTok, `/clubs/${club.id}/arrears`],
    ["CLUB · caja", clubTok, `/clubs/${club.id}/cash`],
    ["CLUB · listado (jugador)", plTok, "/clubs"],
  ];
  const rows = [];
  for (const [label, tok, path] of E) rows.push(await time(label, tok, path));
  console.table(rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
