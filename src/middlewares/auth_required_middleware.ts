import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { EffectiveRole } from "../core/constants/roles";
import DB from "../db/db_configuration";

export interface AuthPayload {
  id_user: string;
  role: EffectiveRole;
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
  } catch {
    return res.status(401).json({
      ok: false,
      message: "Token inválido",
    });
  }

  // El token puede ser válido pero de un usuario que ya no existe (se borró
  // la cuenta o la base): antes pasaba y cada escritura fallaba con errores
  // raros ("IDs inválidos"). Ahora se corta acá y el cliente vuelve al login.
  DB.getPool()
    .query("SELECT 1 FROM users WHERE id_user = $1", [req.user!.id_user])
    .then((r) => {
      if ((r.rowCount ?? 0) === 0) {
        return res.status(401).json({
          ok: false,
          code: "SESSION_INVALID",
          message: "Tu sesión ya no es válida. Vuelve a iniciar sesión.",
        });
      }
      return next();
    })
    .catch(next);
}