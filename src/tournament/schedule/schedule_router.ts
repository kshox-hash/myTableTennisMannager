import { Router } from "express";
import { asyncHandler } from "../../middlewares/wrap_async_middleware";
import { authRequired } from "../../middlewares/auth_required_middleware";
import { ScheduleRepository } from "./schedule_repository";
import { simulateSchedule } from "./schedule_logic";

const router = Router();
const repo = new ScheduleRepository();

// GET /api/v1/tournament/:id_tournament/schedule?avg_minutes=15&start=09:00
// Cronograma ESTIMADO (no un horario fijo) — reparte los partidos de grupo
// pendientes entre las mesas del torneo asumiendo una duración promedio por
// partido. Se recalcula cada vez que se pide, no se guarda.
router.get(
  "/:id_tournament/schedule",
  authRequired,
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const avgMinutes = Math.min(Math.max(Number(req.query.avg_minutes) || 15, 5), 60);
    // Default 5 min — mismo margen que la ITTF permite reclamar entre dos
    // partidos sucesivos de un jugador (Reglamento de Competencias
    // Internacionales), en vez de simular partidos pegados sin descanso.
    // ?? no sirve acá: Number(undefined) es NaN, no null/undefined, así que
    // "min_rest=0" (descanso cero, un valor válido) no puede perderse frente
    // al default solo por venir ausente del query.
    const minRestRaw = req.query.min_rest !== undefined ? Number(req.query.min_rest) : 5;
    const minRest = Math.min(Math.max(Number.isFinite(minRestRaw) ? minRestRaw : 5, 0), 30);
    const startParam = typeof req.query.start === "string" ? req.query.start : "09:00";
    const [startH, startM] = startParam.split(":").map((n) => Number(n) || 0);

    const [numTables, matches] = await Promise.all([
      repo.getNumTables(id_tournament),
      repo.getPendingGroupMatches(id_tournament),
    ]);

    if (matches.length === 0) {
      return res.json({
        ok: true,
        data: { num_tables: numTables, avg_minutes: avgMinutes, min_rest: minRest, matches: [] },
      });
    }

    const scheduled = simulateSchedule(matches, {
      numTables,
      avgMatchMinutes: avgMinutes,
      minRestMinutes: minRest,
    });

    const toClock = (minutesFromStart: number) => {
      const total = startH * 60 + startM + minutesFromStart;
      const h = Math.floor(total / 60) % 24;
      const m = total % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const data = scheduled.map((m) => ({
      id_match: m.id_match,
      id_category: m.id_category,
      category_type: m.category_type,
      category_range: m.category_range,
      group_name: m.group_name,
      match_number: m.match_number,
      table_number: m.table_number,
      start_time: toClock(m.start_minute),
      end_time: toClock(m.end_minute),
    }));

    return res.json({ ok: true, data: { num_tables: numTables, avg_minutes: avgMinutes, matches: data } });
  })
);

export default router;
