import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { requireRole } from "../../middlewares/require_role_middleware";
import { TablesRepository } from "./tables_repository";

const router = Router();
const repo   = new TablesRepository();

// GET /api/v1/tournament/:id_tournament/tables
// Devuelve num_tables, qué mesa tiene qué partido, y lista de partidos listos
router.get(
  "/:id_tournament/tables",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const [numTables, active, readyAndBlocked] = await Promise.all([
      repo.getNumTables(id_tournament),
      repo.getActiveTables(id_tournament),
      repo.getReadyAndBlocked(id_tournament),
    ]);
    const { ready, blocked } = readyAndBlocked;

    // Construir grid de mesas
    const activeByTable = new Map(active.map(m => [m.table_number, m]));
    const tables = Array.from({ length: numTables }, (_, i) => ({
      table_number: i + 1,
      match: activeByTable.get(i + 1) ?? null,
    }));

    return res.json({
      ok: true,
      data: { num_tables: numTables, tables, ready_matches: ready, blocked_matches: blocked },
    });
  })
);

// GET /api/v1/tournament/:id_tournament/tables/queue
// Versión para jugadores (sin rol admin): mesas en juego ahora + los
// próximos partidos de la cola real de despacho, sin controles de
// asignación. Da visibilidad de "qué se viene" sin exponer el panel admin.
router.get(
  "/:id_tournament/tables/queue",
  authRequired,
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const limit = Math.min(Number(req.query.limit) || 8, 20);
    const [numTables, active, queue] = await Promise.all([
      repo.getNumTables(id_tournament),
      repo.getActiveTables(id_tournament),
      repo.getDispatchQueue(id_tournament),
    ]);

    const activeByTable = new Map(active.map(m => [m.table_number, m]));
    const tables = Array.from({ length: numTables }, (_, i) => ({
      table_number: i + 1,
      match: activeByTable.get(i + 1) ?? null,
    }));

    return res.json({
      ok: true,
      data: { num_tables: numTables, tables, next_matches: queue.slice(0, limit) },
    });
  })
);

// PUT /api/v1/tournament/:id_tournament/tables/config
router.put(
  "/:id_tournament/tables/config",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const num_tables = Number(req.body.num_tables);
    if (!num_tables || num_tables < 1 || num_tables > 50) {
      return res.status(400).json({ ok: false, message: "num_tables debe ser entre 1 y 50" });
    }
    await repo.setNumTables(req.params.id_tournament, num_tables);
    return res.json({ ok: true });
  })
);

// PATCH /api/v1/tournament/tables/assign
// body: { id_match, match_type: "group"|"bracket", table_number }
router.patch(
  "/tables/assign",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { id_match, match_type, table_number } = req.body as {
      id_match?: string;
      match_type?: string;
      table_number?: number;
    };
    if (!id_match || !match_type || !table_number) {
      return res.status(400).json({ ok: false, message: "id_match, match_type y table_number son obligatorios" });
    }
    // Antes solo era un type assertion de TS (sin chequeo real en runtime) —
    // no era explotable porque assignTable solo produce dos literales fijos
    // a partir de esto, pero conviene validar de verdad en vez de confiar
    // en el tipo declarado del body.
    if (match_type !== "group" && match_type !== "bracket") {
      return res.status(400).json({ ok: false, message: "match_type debe ser 'group' o 'bracket'" });
    }
    try {
      await repo.assignTable(id_match, match_type, Number(table_number), req.user!.id_user);
    } catch (err) {
      if (err instanceof Error && err.message === "TABLE_ALREADY_OCCUPIED") {
        return res.status(409).json({ ok: false, message: "Esa mesa ya está ocupada por otro partido" });
      }
      if (err instanceof Error && err.message === "PLAYER_ALREADY_PLAYING") {
        return res.status(409).json({ ok: false, message: "Uno de los dos jugadores ya está jugando en otra mesa" });
      }
      if (err instanceof Error && err.message === "MATCH_NOT_FOUND") {
        return res.status(404).json({ ok: false, message: "Partido no encontrado" });
      }
      throw err;
    }
    return res.json({ ok: true });
  })
);

// PATCH /api/v1/tournament/tables/release
// body: { id_match, match_type }
router.patch(
  "/tables/release",
  authRequired,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { id_match, match_type } = req.body as {
      id_match: string;
      match_type: "group" | "bracket";
    };
    if (!id_match || !match_type) {
      return res.status(400).json({ ok: false, message: "id_match y match_type son obligatorios" });
    }
    await repo.releaseTable(id_match, match_type, req.user!.id_user);
    return res.json({ ok: true });
  })
);

export default router;
