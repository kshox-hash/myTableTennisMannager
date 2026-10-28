import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { resolveEffectiveRole, type DbRole, type EffectiveRole } from "../core/constants/roles";
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
    // Token vencido (JWT_EXPIRES_IN, 7 días) o mal formado. Antes respondía
    // solo "Token inválido" sin código: la web no cerraba la sesión, se
    // veía "logueado" y cada acción (crear un campeonato, p. ej.) fallaba
    // con "Token inválido". Con SESSION_INVALID el cliente vuelve al login.
    return res.status(401).json({
      ok: false,
      code: "SESSION_INVALID",
      message: "Tu sesión expiró. Vuelve a iniciar sesión.",
    });
  }

  // El token puede ser válido pero de un usuario que ya no existe (se borró
  // la cuenta o la base): antes pasaba y cada escritura fallaba con errores
  // raros ("IDs inválidos"). Ahora se corta acá y el cliente vuelve al login.
  // El rol se toma de la base, no del token: si el superadmin convierte a un
  // jugador en organizador, puede crear campeonatos al instante (antes el
  // token viejo seguía diciendo "player" y recibía "Acceso denegado" hasta
  // cerrar sesión y volver a entrar).
  DB.getPool()
    .query<{ email: string; role: DbRole }>(
      `SELECT u.email, r.name AS role
       FROM users u JOIN roles r ON r.id_role = u.id_role
       WHERE u.id_user = $1 AND u.deleted_at IS NULL`,
      [req.user!.id_user]
    )
    .then((r) => {
      const row = r.rows[0];
      if (!row) {
        return res.status(401).json({
          ok: false,
          code: "SESSION_INVALID",
          message: "Tu sesión ya no es válida. Vuelve a iniciar sesión.",
        });
      }
      req.user!.role = resolveEffectiveRole(row.email, row.role);
      return next();
    })
    .catch(next);
}