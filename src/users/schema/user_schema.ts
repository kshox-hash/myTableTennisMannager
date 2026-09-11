import { z } from "zod";

export const updateProfileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    club_name: z.string().trim().max(150).nullable().optional(),
    birth_date: z.string().trim().min(1).max(10).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    id_document: z.string().trim().max(50).nullable().optional(),
    category: z.string().trim().max(50).nullable().optional(),
    dominant_hand: z.enum(["right-handed", "left-handed"]).nullable().optional(),
    // Mostrar el ranking privado ("Mi Ranking") también en la página
    // pública de organizador ("Comunidad") — ver 043_public_organizer_profile.sql.
    public_ranking_enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateProfileDTO = z.infer<typeof updateProfileSchema>;

// Alta rápida de un jugador sin cuenta propia (walk-in) — el admin lo crea
// e inscribe directo, sin que el jugador tenga que registrarse.
export const quickCreatePlayerSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100).optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    club_name: z.string().trim().min(1).max(150).optional(),
  })
  .strict();

export type QuickCreatePlayerDTO = z.infer<typeof quickCreatePlayerSchema>;

// Alta de otro administrador desde el panel — solo la puede hacer un admin
// ya logueado (no necesita ADMIN_SECRET, ese es para el registro público).
export const createAdminSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Email inválido").max(150),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type CreateAdminDTO = z.infer<typeof createAdminSchema>;
