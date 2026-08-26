import type { Request, Response, NextFunction } from "express";

export function requireRole(role: "admin" | "player" | Array<"admin" | "player">) {
  const allowed = Array.isArray(role) ? role : [role];

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "No autorizado" });
    }

    if (!allowed.includes(req.user.role as "admin" | "player")) {
      return res.status(403).json({ ok: false, message: "Acceso denegado" });
    }

    return next();
  };
}
