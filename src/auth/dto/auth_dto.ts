export const ERRORS = {
  EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_ADMIN_SECRET: "INVALID_ADMIN_SECRET",
  // Cuenta creada por Google (password_hash null) intentando entrar con
  // contraseña — mensaje aparte de INVALID_CREDENTIALS para que la persona
  // sepa que tiene que usar el botón de Google, no que "se equivocó".
  GOOGLE_ONLY_ACCOUNT: "GOOGLE_ONLY_ACCOUNT",
  // El token de Google no verificó (vencido, mal formado, audience
  // distinta) o no trajo email — no es un error de credenciales nuestro.
  GOOGLE_TOKEN_INVALID: "GOOGLE_TOKEN_INVALID",
} as const;

export type AuthError = typeof ERRORS[keyof typeof ERRORS];

export type UserRole = "admin" | "player";

export type AuthSuccess = {
  token: string;
  user: {
    id_user: string;
    email: string;
    role: UserRole;
  };
  // Solo lo manda el login con Google: true si a esta cuenta le falta el
  // género (dato clave para inscribirse en categorías) — el registro por
  // email lo pide en el mismo formulario, pero Google solo entrega
  // nombre/apellido/email/foto, así que hace falta un paso aparte después.
  profile_incomplete?: boolean;
};

export type CreateUserInput = {
  email: string;
  password_hash: string;
  id_role?: string;
  first_name?: string;
  last_name?: string;
  gender?: "male" | "female" | "other";
  club_name?: string;
  birth_date?: string;
  country?: string;
  id_document?: string;
  category?: string;
};

export type UserCreatedDB = {
  id_user: string;
  email: string;
  created_at: Date | string;
};

export type RoleIdDB = {
  id_role: string;
};

export type UserWithPasswordDB = {
  id_user: string;
  email: string;
  // null en cuentas creadas por Google — ver GOOGLE_ONLY_ACCOUNT.
  password_hash: string | null;
  role: UserRole;
};

// Fila que necesita el login con Google — a diferencia de
// UserWithPasswordDB (que solo trae lo justo para el login por contraseña),
// acá hace falta gender (para armar profile_incomplete) y google_sub (para
// saber si ya estaba vinculada).
export type UserAuthProfileDB = {
  id_user: string;
  email: string;
  role: UserRole;
  gender: "male" | "female" | "other" | null;
  google_sub: string | null;
};

export type CreateGoogleUserInput = {
  email: string;
  google_sub: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
};