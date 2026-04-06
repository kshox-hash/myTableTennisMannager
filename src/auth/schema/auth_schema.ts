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