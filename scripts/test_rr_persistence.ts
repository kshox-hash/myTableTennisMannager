// Prueba local: crear un torneo por la API con una categoría "grupo único"
// y otra normal, leerlas de vuelta (admin y público) y editar el formato.
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

const API = "http://localhost:4310/api/v1";
(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const org = (await pool.query(`SELECT id_user FROM users WHERE email = 'organizador1@sim.myttm.cl'`)).rows[0].id_user;
  const tok = signToken({ id_user: org, role: "admin" });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const created = await call("POST", "/tournament/admin/create/tournament", {
    tournament_name: "Prueba formato",
    event_date: "2026-12-01",
    region: "Metropolitana de Santiago",
    visibility: "public",
    categories: [
      { category_type: "Paralímpico", category_range: "Clase 11", gender: "mixed", inscription_price: 0, quotas: null, competition_format: "round_robin" },
      { category_type: "Todo Competidor", category_range: "General", gender: "mixed", inscription_price: 0, quotas: null },
    ],
  });
  const tid = created.json?.data?.id_tournament ?? created.json?.data?.tournament?.id_tournament;
  const cats = await call("GET", `/tournament/admin/tournaments/${tid}/categories`);
  const list = (cats.json?.data ?? []) as any[];
  const pub = await fetch(`${API}/tournament/public/tournaments/${tid}`).then((r) => r.json());

  // Editar: pasar la normal a grupo único
  const edited = await call("PATCH", `/tournament/admin/tournaments/${tid}`, {
    categories: list.map((c) => ({
      id_category: c.id_category,
      category_type: c.category_type,
      category_range: c.category_range,
      gender: c.gender,
      inscription_price: Number(c.inscription_price),
      quotas: c.quotas,
      competition_format: "round_robin",
    })),
  });
  const after = (await pool.query(`SELECT category_type, competition_format FROM tournament_categories WHERE id_tournament = $1 ORDER BY category_type`, [tid])).rows;

  console.log({
    crear: created.status,
    adminDevuelve: list.map((c) => `${c.category_type}: ${c.competition_format}`),
    publicoDevuelve: (pub.data?.categories ?? []).map((c: any) => `${c.category_type}: ${c.competition_format}`),
    editar: edited.status,
    trasEditar: after.map((r) => `${r.category_type}: ${r.competition_format}`),
  });
  await pool.query(`DELETE FROM tournaments WHERE id_tournament = $1`, [tid]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
