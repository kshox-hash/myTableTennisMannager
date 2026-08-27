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

// POST /api/v1/tournament/:id_tournament/schedule/confirm
// Corre la misma simulación que el GET, pero esta vez la graba: cada
// partido de grupo pendiente queda con mesa y hora programada
// (scheduled_table_number / scheduled_start_at). El scheduler de
// activación (table_schedule_scheduler.ts) las va copiando al estado en
// vivo de a una, a medida que llega la hora de cada partido — no cambia
// nada del panel de Mesas en vivo, solo lo alimenta con antelación en vez
// de depender de que alguien lo dispare a mano.
router.post(
  "/:id_tournament/schedule/confirm",
  authRequired,
  asyncHandler(async (req, res) => {
    const { id_tournament } = req.params;
    const avgMinutes = Math.min(Math.max(Number(req.body.avg_minutes) || 15, 5), 60);
    const minRestRaw = req.body.min_rest !== undefined ? Number(req.body.min_rest) : 5;
    const minRest = Math.min(Math.max(Number.isFinite(minRestRaw) ? minRestRaw : 5, 0), 30);
    const startParam: string = typeof req.body.start === "string" ? req.body.start : "09:00";
    const [startH, startM] = startParam.split(":").map((n: string) => Number(n) || 0);

    const [numTables, matches, tournament] = await Promise.all([
      repo.getNumTables(id_tournament),
      repo.getPendingGroupMatches(id_tournament),
      repo.getTournamentDate(id_tournament),
    ]);

    if (!tournament.event_date) {
      return res.status(400).json({
        ok: false,
        message: "El torneo no tiene fecha de evento configurada — no se puede confirmar un horario sin fecha.",
      });
    }
    if (matches.length === 0) {
      return res.json({ ok: true, data: { confirmed: 0 } });
    }

    const scheduled = simulateSchedule(matches, {
      numTables,
      avgMatchMinutes: avgMinutes,
      minRestMinutes: minRest,
    });

    // event_date llega como "YYYY-MM-DD" (::text en el repo) — se arma la
    // hora de inicio en esa fecha y se le suman los minutos simulados.
    // Construido con componentes en vez de un string armado a mano para
    // que Date interprete todo en un solo huso horario consistente.
    const [y, mo, d] = tournament.event_date.split("-").map(Number);
    const dayStart = new Date(y, (mo ?? 1) - 1, d ?? 1, startH, startM, 0, 0);

    const toPersist = scheduled.map((m) => ({
      id_match: m.id_match,
      table_number: m.table_number,
      start_at: new Date(dayStart.getTime() + m.start_minute * 60_000).toISOString(),
    }));

    await repo.persistSchedule(id_tournament, avgMinutes, toPersist);

    return res.json({ ok: true, data: { confirmed: toPersist.length } });
  })
);

export default router;
