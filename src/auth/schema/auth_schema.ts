import { z } from "zod";

export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Debes ingresar un email válido")
    .max(150, "El email es demasiado largo"),

  password: z
    .string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .max(72, "La contraseña es demasiado larga"),

  role: z.enum(["admin", "player"]).optional(),
  admin_secret: z.string().optional(),

  // Ficha del jugador (Punto 1 de la doc del proyecto) — opcionales acá
  // porque el registro rápido (solo email/password) sigue siendo válido;
  // se pueden completar después desde "Editar perfil".
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  club_name: z.string().trim().max(150).optional(),
  birth_date: z.string().trim().min(1).max(10).optional(),
  country: z.string().trim().max(100).optional(),
  id_document: z.string().trim().max(50).optional(),
  category: z.string().trim().max(50).optional(),
});

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Debes ingresar un email válido"),

  password: z.string().min(1, "La contraseña es obligatoria"),
});

export type SignUpDTO = z.infer<typeof signUpSchema>;
export type SignInDTO = z.infer<typeof signInSchema>;