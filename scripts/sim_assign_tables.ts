// Complemento de simulate_production.ts: asigna mesa a 1-2 partidos de cada
// categoría en curso (genera los avisos "¡Tu mesa está lista!").
import DB from "../src/db/db_configuration";
import { signToken } from "../src/jwt/jwt";

(async () => {
  if (!(process.env.PGDATABASE ?? "").endsWith("_local")) throw new Error("Solo base local");
  const pool = DB.getPool();
  const cats = (
    await pool.query(
      `SELECT c.id_category, c.phase, t.created_by FROM tournament_categories c
       JOIN tournaments t ON t.id_tournament = c.id_tournament
       WHERE c.phase IN ('groups', 'bracket') AND t.status = 'active'`
    )
  ).rows;
  let ok = 0, fail = 0;
  for (const c of cats) {
    const tok = signToken({ id_user: c.created_by, role: "admin" });
    const isGroup = c.phase === "groups";
    const ms = (
      await pool.query(
        isGroup
          ? `SELECT gm.id_match FROM group_matches gm JOIN category_groups g ON g.id_group = gm.id_group
             WHERE g.id_category = $1 AND gm.status = 'scheduled' AND gm.player1_id IS NOT NULL AND gm.player2_id IS NOT NULL
             AND gm.table_number IS NULL LIMIT 2`
          : `SELECT id_match FROM bracket_matches WHERE id_category = $1 AND status = 'ready'
             AND player1_id IS NOT NULL AND player2_id IS NOT NULL AND table_number IS NULL LIMIT 2`,
        [c.id_category]
      )
    ).rows;
    let n = 1;
    for (const m of ms) {
      const r = await fetch("http://localhost:4310/api/v1/tournament/tables/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ id_match: m.id_match, match_type: isGroup ? "group" : "bracket", table_number: n++ }),
      });
      if (r.ok) ok++;
      else {
        fail++;
        if (fail < 4) console.log(r.status, await r.text());
      }
    }
  }
  console.log({ categoriasEnCurso: cats.length, mesasAsignadas: ok, fallidas: fail });
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
