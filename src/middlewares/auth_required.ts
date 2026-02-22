import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  id_user: string;
  role: "admin" | "player";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ ok: false, message: "No autorizado" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ ok: false, message: "JWT_SECRET missing" });

  try {
    const payload = jwt.verify(token, secret) as AuthPayload;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
}
