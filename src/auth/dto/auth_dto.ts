export const ERRORS = {
  EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
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
};

export type CreateUserInput = {
  email: string;
  password_hash: string;
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
  password_hash: string;
  role: UserRole;
};