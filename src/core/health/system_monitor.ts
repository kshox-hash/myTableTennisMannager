// "Estado del sistema" para el súper usuario: lo que avisa de un cuello de
// botella antes de que un jugador u organizador lo note (sobre todo en un
// día de torneo en vivo). Todo se mide en este mismo proceso y en la base;
// no necesita claves de Render. Nada se guarda: se cuenta en memoria y al
// reiniciar parte de cero (y eso mismo se muestra como "se reinició").
import type { NextFunction, Request, Response } from "express";
import { monitorEventLoopDelay } from "perf_hooks";
import DB from "../../db/db_configuration";

export type Level = "ok" | "warn" | "bad";
const level = (value: number, warn: number, bad: number): Level => (value >= bad ? "bad" : value >= warn ? "warn" : "ok");

// ── Retraso del servidor (event loop) ──────────────────────────────────
// Node atiende todo en un solo hilo: si algo lo ocupa (una consulta pesada,
// armar una llave grande), todo lo demás espera — respuestas, horarios,
// avisos. Este retraso es el mejor indicador de "el servidor está saturado".
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let lastLoop = { p99_ms: 0, mean_ms: 0 };
setInterval(() => {
  lastLoop = { p99_ms: Math.round(loop.percentile(99) / 1e6), mean_ms: Math.round(loop.mean / 1e6) };
  loop.reset();
}, 60_000).unref();

// ── Tráfico (últimos 5 minutos) ───────────────────────────────────────
const WINDOW_MS = 5 * 60_000;
type Hit = { at: number; ms: number; error: boolean };
const hits: Hit[] = [];
const prune = (now: number) => {
  while (hits.length && hits[0].at < now - WINDOW_MS) hits.shift();
  // Tope por si hubiera una avalancha: con 20.000 en 5 min ya se ve el problema.
  if (hits.length > 20_000) hits.splice(0, hits.length - 20_000);
};

/** Middleware: cuenta cada petición, cuánto tardó y si terminó en error del servidor (5xx). */
export function requestMonitor(_req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const now = Date.now();
    hits.push({ at: now, ms: Number(process.hrtime.bigint() - start) / 1e6, error: res.statusCode >= 500 });
    prune(now);
  });
  next();
}

function traffic() {
  prune(Date.now());
  const sorted = hits.map((h) => h.ms).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  return {
    requests_per_min: Math.round((hits.length / (WINDOW_MS / 60_000)) * 10) / 10,
    p95_ms: Math.round(p95),
    errors_5m: hits.filter((h) => h.error).length,
  };
}

// ── Tareas automáticas (los schedulers) ───────────────────────────────
type Task = { label: string; intervalMs: number; lastRunAt: number | null; lastMs: number | null; runs: number; lastErrorAt: number | null; lastError: string | null };
const tasks = new Map<string, Task>();

/** Lo llama cada scheduler al arrancar. */
export function registerTask(name: string, label: string, intervalMs: number) {
  tasks.set(name, { label, intervalMs, lastRunAt: null, lastMs: null, runs: 0, lastErrorAt: null, lastError: null });
}

/** Envuelve una pasada del scheduler: anota cuándo corrió y cuánto tardó. */
export async function runTask<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const t = tasks.get(name);
    if (t) {
      t.lastRunAt = Date.now();
      t.lastMs = t.lastRunAt - start;
      t.runs++;
    }
  }
}

/** Lo llama el catch del scheduler (que sigue tragándose el error para no cortar el ciclo). */
export function taskFailed(name: string, err: unknown) {
  const t = tasks.get(name);
  if (!t) return;
  t.lastErrorAt = Date.now();
  t.lastError = String((err as Error)?.message ?? err).slice(0, 200);
}

const startedAt = Date.now();

// ── Todo junto ────────────────────────────────────────────────────────
export async function systemStatus() {
  const pool = DB.getPool();
  const [dbRow, liveRow] = await Promise.all([
    pool.query<{ size_bytes: string; connections: number; max_connections: number }>(
      `SELECT pg_database_size(current_database())::text AS size_bytes,
              (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
              current_setting('max_connections')::int AS max_connections`,
    ),
    pool.query<{ playing: number; today: number }>(
      `SELECT
         (SELECT COUNT(DISTINCT t.id_tournament)::int
            FROM tournaments t JOIN tournament_categories c ON c.id_tournament = t.id_tournament
           WHERE t.status = 'active' AND c.phase IN ('groups', 'bracket')) AS playing,
         (SELECT COUNT(*)::int FROM tournaments t
           WHERE t.event_date = (now() AT TIME ZONE 'America/Santiago')::date) AS today`,
    ),
  ]);
  const db = dbRow.rows[0];
  const live = liveRow.rows[0];
  const now = Date.now();

  const limitMb = Number(process.env.MEMORY_LIMIT_MB ?? 512);
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const uptimeS = Math.round((now - startedAt) / 1000);
  const t = traffic();
  const connPct = db.max_connections ? db.connections / db.max_connections : 0;

  const server = {
    memory_mb: rssMb,
    memory_limit_mb: limitMb,
    memory_level: level(rssMb / limitMb, 0.6, 0.8),
    uptime_s: uptimeS,
    uptime_level: (uptimeS < 600 ? "warn" : "ok") as Level,
    loop_p99_ms: lastLoop.p99_ms,
    loop_level: level(lastLoop.p99_ms, 100, 500),
  };
  const trafficOut = {
    ...t,
    p95_level: level(t.p95_ms, 1000, 3000),
    errors_level: level(t.errors_5m, 1, 10),
  };
  const taskList = [...tasks.entries()].map(([name, x]) => {
    const sinceS = x.lastRunAt ? Math.round((now - x.lastRunAt) / 1000) : null;
    // Sin correr hace más de 3 vueltas: quedó pegada (o el servidor recién arrancó).
    const stuck = uptimeS > (x.intervalMs / 1000) * 3 && (sinceS === null || sinceS > (x.intervalMs / 1000) * 3);
    const recentError = x.lastErrorAt !== null && now - x.lastErrorAt < 15 * 60_000;
    return {
      name,
      label: x.label,
      every_s: Math.round(x.intervalMs / 1000),
      last_run_s: sinceS,
      last_ms: x.lastMs,
      runs: x.runs,
      last_error: recentError ? x.lastError : null,
      level: (stuck ? "bad" : recentError ? "warn" : "ok") as Level,
    };
  });
  const database = {
    size_bytes: Number(db.size_bytes),
    connections: db.connections,
    max_connections: db.max_connections,
    // Del pool de este servidor: si hay consultas esperando conexión, la base es el cuello de botella.
    pool_total: pool.totalCount,
    pool_idle: pool.idleCount,
    pool_waiting: pool.waitingCount,
    level: pool.waitingCount > 0 ? ("bad" as Level) : level(connPct, 0.6, 0.8),
  };

  const alerts: { level: Level; text: string }[] = [];
  if (server.memory_level !== "ok") alerts.push({ level: server.memory_level, text: `El servidor usa ${rssMb} de ${limitMb} MB de memoria.${server.memory_level === "bad" ? " Si sigue subiendo, Render lo reinicia." : ""}` });
  if (server.uptime_level !== "ok") alerts.push({ level: "warn", text: `El servidor se reinició hace ${Math.max(1, Math.round(uptimeS / 60))} min. Si no hiciste un deploy, revisa los logs de Render.` });
  if (server.loop_level !== "ok") alerts.push({ level: server.loop_level, text: `El servidor está respondiendo con ${lastLoop.p99_ms} ms de retraso: está saturado (horarios, avisos y respuestas se atrasan).` });
  if (trafficOut.p95_level !== "ok") alerts.push({ level: trafficOut.p95_level, text: `Las páginas tardan hasta ${(t.p95_ms / 1000).toFixed(1)} s en responder (las más lentas).` });
  if (trafficOut.errors_level !== "ok") alerts.push({ level: trafficOut.errors_level, text: `${t.errors_5m} ${t.errors_5m === 1 ? "error" : "errores"} del servidor en los últimos 5 minutos. Revisa los logs de Render.` });
  for (const x of taskList) {
    if (x.level === "bad") alerts.push({ level: "bad", text: `La tarea "${x.label}" no corre hace ${x.last_run_s === null ? "que arrancó el servidor" : Math.round(x.last_run_s / 60) + " min"} (debería cada ${x.every_s} s).` });
    else if (x.level === "warn") alerts.push({ level: "warn", text: `La tarea "${x.label}" falló hace poco: ${x.last_error}` });
  }
  if (database.pool_waiting > 0) alerts.push({ level: "bad", text: `Hay ${database.pool_waiting} consultas esperando conexión a la base de datos.` });
  else if (database.level !== "ok") alerts.push({ level: database.level, text: `La base de datos usa ${db.connections} de ${db.max_connections} conexiones.` });

  const overall: Level = alerts.some((a) => a.level === "bad") ? "bad" : alerts.length ? "warn" : "ok";
  return {
    overall,
    alerts,
    server,
    traffic: trafficOut,
    tasks: taskList,
    database,
    live: { playing: live.playing, today: live.today },
    checked_at: new Date(now).toISOString(),
  };
}
