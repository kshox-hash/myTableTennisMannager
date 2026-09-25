// Mide tiempos de los endpoints más usados contra el backend LOCAL con la
// base simulada (ver simulate_production.ts). Firma tokens directo con el
// JWT_SECRET local para no chocar con el rate limit del login.
//
//   set -a && . ./.env && set +a && npx ts-node -T scripts/bench_endpoints.ts

import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = process.env.SIM_API ?? "http://localhost:4310/api/v1";

async function time(label: string, token: string | null, path: string, runs = 5) {
  const ms: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const res = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await res.text();
    ms.push(performance.now() - t);
    bytes = body.length;
    status = res.status;
  }
  ms.sort((a, b) => a - b);
  return { endpoint: label, status, "p50 ms": Math.round(ms[Math.floor(runs / 2)]), "max ms": Math.round(ms[runs - 1]), KB: Math.round(bytes / 1024) };
}

async function main() {
  const pool = DB.getPool();
  const q = async (sql: string) => (await pool.query(sql)).rows[0];

  // El organizador con más torneos, un jugador con muchos partidos, un torneo grande.
  const org = await q(`SELECT created_by AS id FROM tournaments GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`);
  const player = await q(`SELECT id_user AS id FROM player_stats ORDER BY matches_played DESC LIMIT 1`);
  const big = await q(`SELECT e.id_tournament AS t, e.id_category AS c FROM enrollments e GROUP BY 1,2 ORDER BY COUNT(*) DESC LIMIT 1`);
  const club = await q(`SELECT id_club AS id, created_by AS owner FROM clubs c WHERE created_by IS NOT NULL ORDER BY (SELECT COUNT(*) FROM users u WHERE u.id_club = c.id_club) DESC LIMIT 1`);

  const orgTok = signToken({ id_user: org.id, role: "admin" });
  const plTok = signToken({ id_user: player.id, role: "player" });
  const clubTok = signToken({ id_user: club.owner, role: "admin" });

  const rows = [];
  rows.push(await time("Torneos públicos (listado)", null, "/tournament/public/tournaments?page=1&limit=12"));
  rows.push(await time("Detalle torneo público", null, `/tournament/public/tournaments/${big.t}`));
  rows.push(await time("Ranking público", null, "/ranking/public?limit=50"));
  rows.push(await time("Comunidad (organizadores)", null, "/tournament/public/organizers"));
  rows.push(await time("Ficha pública organizador", null, `/tournament/public/organizers/${org.id}`));
  rows.push(await time("Stats home público", null, "/tournament/public/stats"));
  rows.push(await time("Jugador: /users/me", plTok, "/users/me"));
  rows.push(await time("Jugador: dashboard", plTok, "/player/dashboard"));
  rows.push(await time("Jugador: historial partidos", plTok, `/player/user/${player.id}/matches`));
  rows.push(await time("Jugador: ficha pública", plTok, `/users/${player.id}/profile`));
  rows.push(await time("Jugador: notificaciones", plTok, "/notifications"));
  rows.push(await time("Admin: mis torneos (pág 1)", orgTok, `/tournament/admin/get/tournaments/my?created_by=${org.id}&page=1&limit=12`));
  rows.push(await time("Admin: stats perfil", orgTok, "/tournament/admin/get/tournaments/my/stats"));
  rows.push(await time("Admin: grupos de categoría", orgTok, `/bracket/tournaments/${big.t}/categories/${big.c}/groups`));
  rows.push(await time("Admin: todos los partidos", orgTok, `/bracket/tournaments/${big.t}/categories/${big.c}/all-matches`));
  rows.push(await time("Admin: buscar jugador 'gonz'", orgTok, "/users/admin/search?q=gonz"));
  rows.push(await time("Club: detalle (dueño)", clubTok, `/clubs/${club.id}`));
  rows.push(await time("Club: morosidad", clubTok, `/clubs/${club.id}/arrears`));
  rows.push(await time("Club: caja", clubTok, `/clubs/${club.id}/cash`));
  rows.push(await time("Clubes (listado jugador)", plTok, "/clubs"));
  console.table(rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
