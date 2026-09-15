export const ROLE_IDS = {
  admin: "11111111-1111-1111-1111-111111111111",
  player: "22222222-2222-2222-2222-222222222222",
} as const;

export type DbRole = "admin" | "player";
export type EffectiveRole = DbRole | "superadmin";

// "superadmin" NO es una fila de `roles` ni un valor de `users.id_role` —
// evita migración y evita tocar el FK. Se resuelve al firmar el JWT
// (login/registro/Google) comparando el email contra una lista fija en env
// var: cualquier cuenta con ese email (jugador o admin como quedó guardada
// en la base) entra con rol efectivo "superadmin", superset de todo (ver
// require_role_middleware.ts).
const SUPERADMIN_EMAILS = new Set(
  (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export function resolveEffectiveRole(email: string, dbRole: DbRole): EffectiveRole {
  return SUPERADMIN_EMAILS.has(email.trim().toLowerCase()) ? "superadmin" : dbRole;
}

export function isSuperadminEmail(email: string): boolean {
  return SUPERADMIN_EMAILS.has(email.trim().toLowerCase());
}

// Para filtrar estas cuentas fuera de listados/conteos de "admin" (panel de
// Súper usuario) — su rol efectivo es "superadmin", no deberían aparecer
// mezcladas con los admins comunes ni sumar al conteo de admins.
export function getSuperadminEmails(): string[] {
  return [...SUPERADMIN_EMAILS];
}
