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
    return res.status(401).json({
      ok: false,
      message: "No autorizado",
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      ok: false,
      message: "JWT_SECRET missing",
    });
  }

  try {
    // Fijar el algoritmo esperado en vez de dejar que jsonwebtoken lo infiera
    // del propio token — hoy no es explotable (todos los tokens se firman
    // acá mismo con HS256, nunca con "none" ni con una clave pública/RS256),
    // pero es una defensa barata contra un ataque de confusión de algoritmo
    // si en el futuro se agrega otro método de firma.
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as AuthPayload;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({
      ok: false,
      message: "Token inválido",
    });
  }
}