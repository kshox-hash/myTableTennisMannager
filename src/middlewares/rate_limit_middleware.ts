import rateLimit from "express-rate-limit";

// Sign-up/sign-in son las únicas rutas de registro abiertas al público (los
// admins no se auto-registran, ver ADMIN_SECRET) — el objetivo acá no es
// frenar tráfico normal, sino bots/fuerza bruta creando cuentas o probando
// contraseñas. 10 intentos cada 15 min por IP alcanza de sobra para un
// usuario real que se equivoca de contraseña un par de veces.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Demasiados intentos. Probá de nuevo en unos minutos." },
});
