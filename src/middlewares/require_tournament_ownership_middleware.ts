import type { Request, Response, NextFunction } from "express";
import DB from "../db/db_configuration";

// Falta de esto en casi todas las rutas de admin fue el hallazgo más grave
// de la auditoría de seguridad: requireRole("admin") solo confirma "es
// ALGÚN admin", no "es EL organizador de ESTE torneo puntual". Con varios
// organizadores independientes en la plataforma (una federación con
// distintos clubes/regiones armando sus propios torneos), sin esto
// cualquier admin podía tocar el torneo de cualquier otro.
//
// Debe ir DESPUÉS de authRequired (necesita req.user). Por default resuelve
// el id_tournament desde req.params.id_tournament — para rutas que solo
// tienen un id_match/id_category/id_group, pasar un `resolveTournamentId`
// que lo busque primero (ver ejemplos de uso en los routers).
//
// `allowViewer`: el rol "viewer" de tournament_organizers (invitado de solo
// lectura, ej. un juez general) por default queda AFUERA de esta gate —
// mismo comportamiento estricto de siempre en cada ruta que no diga lo
// contrario. Se pasa `{ allowViewer: true }` puntualmente en las rutas de
// SOLO LECTURA (para que el invitado pueda ver inscritos/rankings/grupos/
// llave/mesas/actividad) y en la ruta de guardar el orden de sembrado (la
// única escritura que el invitado sí puede hacer).
export function requireTournamentOwnership(
  resolveTournamentId: (req: Request) => Promise<string | null> | string | null = (req) =>
    req.params.id_tournament ?? null,
  options: { allowViewer?: boolean } = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "No autorizado" });
    }

    const idTournament = await resolveTournamentId(req);
    if (!idTournament) {
      return res.status(404).json({ ok: false, message: "No se pudo determinar el campeonato de este pedido" });
    }

    const pool = DB.getPool();
    const tRes = await pool.query<{ created_by: string }>(
      `SELECT created_by FROM tournaments WHERE id_tournament = $1`,
      [idTournament]
    );
    const tournament = tRes.rows[0];
    if (!tournament) {
      return res.status(404).json({ ok: false, message: "Campeonato no encontrado" });
    }

    if (tournament.created_by === req.user.id_user) return next();

    const orgRes = await pool.query<{ role: string }>(
      `SELECT role FROM tournament_organizers WHERE id_tournament = $1 AND id_user = $2`,
      [idTournament, req.user.id_user]
    );
    const organizerRole = orgRes.rows[0]?.role;
    if (organizerRole === "organizer") return next();
    if (organizerRole === "viewer" && options.allowViewer) return next();
    if (organizerRole === "viewer") {
      return res.status(403).json({ ok: false, message: "Tu invitación a este campeonato es de solo lectura" });
    }

    return res.status(403).json({ ok: false, message: "No sos organizador de este campeonato" });
  };
}
