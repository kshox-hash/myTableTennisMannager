export type RoleName = "admin" | "player";

export interface RegisterDTO {
  email: string;
  password: string;
  // para prod: NO recibir role, siempre player
  role?: RoleName; // en dev puedes permitirlo si quieres
}

export interface LoginDTO {
  email: string;
  password: string;
}
