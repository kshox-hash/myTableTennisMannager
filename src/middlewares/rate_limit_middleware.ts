import rateLimit from "express-rate-limit";

// Sign-up/sign-in son las únicas rutas de registro abiertas al público (los
// admins no se auto-registran, ver ADMIN_SECRET) — el objetivo acá no es
// frenar tráfico normal, sino bots/fuerza bruta creando cuentas o probando
// contraseñas. 10 intentos cada 15 min por IP alcanza de sobra para un
// usuario real que se equivoca de contraseña un par de veces.
//
// Solo cuentan los intentos FALLIDOS (skipSuccessfulRequests): en un torneo
// todos los jugadores del WiFi del lugar salen con la misma IP pública, y
// contando también los logins correctos el jugador n°11 quedaba bloqueado
// 15 minutos. Contra fuerza bruta sigue igual (lo que falla es lo que suma).
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Demasiados intentos. Inténtalo de nuevo en unos minutos." },
});
