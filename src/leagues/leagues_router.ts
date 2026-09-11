import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middlewares/wrap_async_middleware";
import { authRequired } from "../middlewares/auth_required_middleware";
import { requireRole } from "../middlewares/require_role_middleware";
import { requireTournamentOwnership } from "../middlewares/require_tournament_ownership_middleware";
import { LeaguesRepository } from "./leagues_repository";

const router = Router();
const repo = new LeaguesRepository();

// El :id de la liga es un id_tournament — requireTournamentOwnership
// funciona igual (chequea created_by). Se le dice qué param leer.
const ownLeague = requireTournamentOwnership((req) => req.params.id_league ?? null, { allowViewer: true });
const ownLeagueStrict = requireTournamentOwnership((req) => req.params.id_league ?? null);

const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  region: z.string().trim().max(100).nullable().optional(),
  visibility: z.enum(["public", "private", "internal"]).optional(),
  is_ranked: z.boolean().optional(),
  season: z.string().trim().max(60).nullable().optional(),
  scoring: z.enum(["2-1-0", "3-0"]).optional(),
  category_type: z.string().trim().min(1).max(20),
  category_range: z.string().trim().max(100).optional(),
  gender: z.enum(["male", "female", "mixed"]),
  format: z.enum(["singles", "doubles"]).optional(),
  best_of_sets: z.union([z.literal(3), z.literal(5), z.literal(7)]).optional(),
});

const ERR: Record<string, [number, string]> = {
  DIVISION_NOT_FOUND: [404, "División no encontrada"],
  FIXTURE_ALREADY_GENERATED: [409, "El fixture ya se generó — no se pueden cambiar los jugadores"],
  ALREADY_IN_DIVISION: [409, "El jugador ya está en esta división"],
  PLAYER_NOT_FOUND: [404, "Jugador no encontrado"],
  NOT_ENOUGH_PLAYERS: [400, "Se necesitan al menos 3 participantes para generar el fixture"],
  LEAGUE_NOT_FOUND: [404, "Liga no encontrada"],
  LEAGUE_IS_DOUBLES: [400, "Esta liga es de dobles — agrega parejas, no jugadores sueltos"],
  LEAGUE_IS_SINGLES: [400, "Esta liga es individual, no de dobles"],
  SAME_PLAYER: [400, "Una pareja necesita dos jugadores distintos"],
  ALREADY_IN_TEAM: [409, "Uno de los jugadores ya está en otra pareja de esta liga"],
  MIXED_RULE: [400, "En dobles mixtos la pareja tiene que ser un varón y una dama"],
};

// POST /api/v1/leagues
router.post(
  "/",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, message: "Datos inválidos", issues: p.error.issues });
    const id = await repo.createLeague({
      created_by: req.user!.id_user,
      name: p.data.name,
      region: p.data.region ?? null,
      visibility: p.data.visibility ?? "public",
      is_ranked: p.data.is_ranked ?? true,
      season: p.data.season ?? null,
      scoring: p.data.scoring ?? "2-1-0",
      category_type: p.data.category_type,
      category_range: p.data.category_range ?? "General",
      gender: p.data.gender,
      format: p.data.format ?? "singles",
      best_of_sets: p.data.best_of_sets ?? 3,
    });
    return res.status(201).json({ ok: true, data: { id_league: id } });
  })
);

// GET /api/v1/leagues/mine
router.get(
  "/mine",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const rows = await repo.listMine(req.user!.id_user);
    return res.json({ ok: true, data: rows });
  })
);

// GET /api/v1/leagues/:id_league  (admin — detalle completo)
router.get(
  "/:id_league",
  authRequired,
  requireRole("admin"),
  ownLeague,
  asyncHandler(async (req, res) => {
    const d = await repo.getDetail(req.params.id_league);
    if (!d) return res.status(404).json({ ok: false, message: "Liga no encontrada" });
    return res.json({ ok: true, data: d });
  })
);

// GET /api/v1/leagues/public/:id_league  (sin login, solo lectura, sin emails)
router.get(
  "/public/:id_league",
  asyncHandler(async (req, res) => {
    const d = await repo.getDetail(req.params.id_league);
    if (!d || d.visibility !== "public") return res.status(404).json({ ok: false, message: "Liga no encontrada" });
    // getDetail ya arma nombres via COALESCE(..., email); acá se limpia el
    // email de los que no tienen nombre cargado.
    for (const div of d.divisions) {
      const scrub = (n: string) => (n.includes("@") ? "Jugador" : n);
      div.players = div.players.map((p) => ({ ...p, name: scrub(p.name) }));
      div.standings = div.standings.map((s) => ({ ...s, name: scrub(s.name) }));
    }
    return res.json({ ok: true, data: d });
  })
);

// POST /api/v1/leagues/:id_league/divisions
router.post(
  "/:id_league/divisions",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    const name = (req.body?.name as string | undefined)?.trim();
    if (!name) return res.status(400).json({ ok: false, message: "Falta el nombre de la división" });
    await repo.addDivision(req.params.id_league, name);
    return res.status(201).json({ ok: true });
  })
);

// POST /api/v1/leagues/:id_league/divisions/:id_division/players
router.post(
  "/:id_league/divisions/:id_division/players",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    const idUser = (req.body?.id_user as string | undefined)?.trim();
    if (!idUser) return res.status(400).json({ ok: false, message: "Falta id_user" });
    const r = await repo.addPlayer(req.params.id_league, req.params.id_division, idUser);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    return res.status(201).json({ ok: true });
  })
);

// POST .../divisions/:id_division/pairs   body: { player1_id, player2_id }
router.post(
  "/:id_league/divisions/:id_division/pairs",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    const p1 = (req.body?.player1_id as string | undefined)?.trim();
    const p2 = (req.body?.player2_id as string | undefined)?.trim();
    if (!p1 || !p2) return res.status(400).json({ ok: false, message: "Faltan player1_id y player2_id" });
    const r = await repo.addPair(req.params.id_league, req.params.id_division, p1, p2);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    return res.status(201).json({ ok: true });
  })
);

// DELETE .../players/:id_user
router.delete(
  "/:id_league/divisions/:id_division/players/:id_user",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    const r = await repo.removePlayer(req.params.id_league, req.params.id_division, req.params.id_user);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    return res.json({ ok: true });
  })
);

// POST .../divisions/:id_division/generate-fixture
router.post(
  "/:id_league/divisions/:id_division/generate-fixture",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    const r = await repo.generateFixture(req.params.id_league, req.params.id_division);
    if (!r.ok) {
      const [code, msg] = ERR[r.error] ?? [400, r.error];
      return res.status(code).json({ ok: false, message: msg });
    }
    return res.json({ ok: true, data: { jornadas: r.jornadas } });
  })
);

// DELETE /api/v1/leagues/:id_league
router.delete(
  "/:id_league",
  authRequired,
  requireRole("admin"),
  ownLeagueStrict,
  asyncHandler(async (req, res) => {
    await repo.deleteLeague(req.params.id_league);
    return res.json({ ok: true });
  })
);

export default router;
