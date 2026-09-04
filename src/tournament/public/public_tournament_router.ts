import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { PublicTournamentRepository } from "./public_tournament_repository";

const router = Router();
const repo = new PublicTournamentRepository();

// pg devuelve las columnas DATE como objetos Date, no strings — hay que
// normalizar antes de comparar o de mandarlas al cliente.
function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.toString().slice(0, 10);
}

// played_at es TIMESTAMPTZ — a diferencia de formatDate (para columnas DATE)
// acá sí importa la hora, así que se manda el ISO completo.
function formatTimestamp(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

// "No ha empezado" / "En curso" / "Finalizado" / "Cancelado" — la tabla
// solo guarda active/cancelled, así que el resto se deriva de la fecha
// del evento. Es una vitrina pública, no hace falta más precisión que esa.
function displayStatus(status: string, eventDate: string | Date | null): string {
  if (status === "cancelled") return "cancelled";
  const date = formatDate(eventDate);
  if (!date) return "upcoming";
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) return "upcoming";
  if (date === today) return "ongoing";
  return "finished";
}

// GET /api/v1/tournament/public/tournaments?page=&limit=&q=&region=
// Listado público, sin autenticación — vitrina para el landing y una
// página propia de "Torneos" que cualquier visitante puede navegar.
router.get(
  "/public/tournaments",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const q = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const region = typeof req.query.region === "string" ? req.query.region.trim() || undefined : undefined;
    const statusParam = typeof req.query.status === "string" ? req.query.status.trim() : undefined;
    const status =
      statusParam && ["upcoming", "ongoing", "finished", "cancelled"].includes(statusParam) ? statusParam : undefined;
    const categoryType =
      typeof req.query.category_type === "string" ? req.query.category_type.trim() || undefined : undefined;
    const categoryRange =
      typeof req.query.category_range === "string" ? req.query.category_range.trim() || undefined : undefined;
    const genderParam = typeof req.query.gender === "string" ? req.query.gender.trim() : undefined;
    const gender = genderParam && ["male", "female", "mixed"].includes(genderParam) ? genderParam : undefined;

    const { rows, total } = await repo.list({ q, region, status, categoryType, categoryRange, gender }, { page, limit });

    return res.json({
      ok: true,
      data: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        tournaments: rows.map((t) => ({
          id_tournament: t.id_tournament,
          tournament_name: t.tournament_name,
          address: t.address,
          region: t.region,
          event_date: formatDate(t.event_date),
          event_time: t.event_time,
          status: displayStatus(t.status, t.event_date),
          category_count: t.category_count,
          enrolled_count: t.enrolled_count,
        })),
      },
    });
  })
);

// GET /api/v1/tournament/public/category-filters — valores reales (no una
// lista fija) para poblar los selects de "tipo de categoría" y "rango" del
// filtro de /torneos.
router.get(
  "/public/category-filters",
  asyncHandler(async (_req, res) => {
    const filters = await repo.getCategoryFilters();
    return res.json({
      ok: true,
      data: { category_types: filters.categoryTypes, category_ranges: filters.categoryRanges },
    });
  })
);

// GET /api/v1/tournament/public/stats — números reales para el landing.
router.get(
  "/public/stats",
  asyncHandler(async (_req, res) => {
    const stats = await repo.getStats();
    return res.json({ ok: true, data: stats });
  })
);

// GET /api/v1/tournament/public/tournaments/:id_tournament
router.get(
  "/public/tournaments/:id_tournament",
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const tournament = await repo.getById(id_tournament);
    if (!tournament) {
      return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
    }
    const categories = await repo.getCategories(id_tournament);

    return res.json({
      ok: true,
      data: {
        id_tournament: tournament.id_tournament,
        tournament_name: tournament.tournament_name,
        description: tournament.description,
        address: tournament.address,
        region: tournament.region,
        event_date: formatDate(tournament.event_date),
        event_time: tournament.event_time,
        status: displayStatus(tournament.status, tournament.event_date),
        organizer_club_name: tournament.organizer_club_name ?? tournament.organizer_user_name,
        categories: categories.map((c) => ({
          id_category: c.id_category,
          category_type: c.category_type,
          category_range: c.category_range,
          gender: c.gender,
          status: c.status,
          enrolled_count: c.enrolled_count,
          has_bracket: c.has_bracket,
          is_finished: c.is_finished,
          phase: c.phase,
        })),
      },
    });
  })
);

// GET /api/v1/tournament/public/tournaments/:id_tournament/matches?page=&limit=
// Grilla combinada de partidos (grupos + llave) de TODAS las categorías del
// torneo — la pestaña "Matches" a nivel torneo. Paginado: antes de esto
// traía el torneo entero de una sola pasada, sin límite, para tráfico
// anónimo (el de mayor volumen del sitio).
router.get(
  "/public/tournaments/:id_tournament/matches",
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const { rows, total } = await repo.getAllMatches(id_tournament, { page, limit });
    return res.json({
      ok: true,
      data: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        matches: rows.map((m) => ({
          id_match: m.id_match,
          stage: m.stage,
          category_type: m.category_type,
          category_range: m.category_range,
          gender: m.gender,
          round: m.round,
          player1_id: m.player1_id,
          player1_name: m.player1_id ? `${m.player1_first ?? ""} ${m.player1_last ?? ""}`.trim() : null,
          player1_club: m.player1_club,
          player2_id: m.player2_id,
          player2_name: m.player2_id ? `${m.player2_first ?? ""} ${m.player2_last ?? ""}`.trim() : null,
          player2_club: m.player2_club,
          winner_id: m.winner_id,
          sets_player1: m.sets_player1,
          sets_player2: m.sets_player2,
          status: m.status,
          best_of_sets: m.best_of_sets,
          played_at: formatTimestamp(m.played_at),
          set_scores: m.set_scores ?? null,
        })),
      },
    });
  })
);

// GET /api/v1/tournament/public/matches/:match_type/:id_match
// Ficha de un partido puntual — el drill-down "Ver juego" desde cualquier
// lista/tarjeta de partido (Partidos, Grupos, Llaves).
router.get(
  "/public/matches/:match_type/:id_match",
  asyncHandler(async (req, res) => {
    const matchType = req.params.match_type;
    if (matchType !== "group" && matchType !== "bracket") {
      return res.status(400).json({ ok: false, message: "match_type inválido" });
    }
    const data = await repo.getMatchDetail(matchType, req.params.id_match);
    if (!data) {
      return res.status(404).json({ ok: false, message: "Partido no encontrado" });
    }
    return res.json({ ok: true, data });
  })
);

// GET /api/v1/tournament/public/tournaments/:id_tournament/categories/:id_category
// Ficha pública de una categoría — grupos con standings y resultados, cuadro
// eliminatorio si ya se generó, y la lista de jugadores inscritos.
router.get(
  "/public/tournaments/:id_tournament/categories/:id_category",
  asyncHandler(async (req, res) => {
    const { id_category } = req.params;
    const detail = await repo.getCategoryDetail(id_category);
    if (!detail.category) {
      return res.status(404).json({ ok: false, message: "Categoría no encontrada" });
    }
    return res.json({
      ok: true,
      data: {
        id_category: detail.category.id_category,
        category_type: detail.category.category_type,
        category_range: detail.category.category_range,
        gender: detail.category.gender,
        players: detail.players.map((p) => ({
          id_user: p.id_user,
          first_name: p.first_name,
          last_name: p.last_name,
          club_name: p.club_name,
        })),
        groups: detail.groups,
        bracket_matches: detail.bracketMatches.map((m) => ({
          ...m,
          set_scores: m.set_scores ?? null,
        })),
      },
    });
  })
);

export default router;
