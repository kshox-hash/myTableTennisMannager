import type { Request, Response, NextFunction } from "express";
import type { EffectiveRole } from "../core/constants/roles";

export function requireRole(role: EffectiveRole | Array<EffectiveRole>) {
  const allowed = Array.isArray(role) ? role : [role];

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "No autorizado" });
    }

    // superadmin es superset de todo — mismos poderes que "somos el dueño
    // de la plataforma": pasa cualquier gate de rol sin tener que listar
    // "superadmin" en cada ruta existente. Los chequeos de OWNERSHIP
    // puntuales (requireTournamentOwnership, requireOwnClub) siguen aparte
    // y no se ven afectados por esto.
    if (req.user.role === "superadmin") {
      return next();
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ ok: false, message: "Acceso denegado" });
    }

    return next();
  };
}
