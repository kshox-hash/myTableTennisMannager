import { z } from "zod";

export const updateProfileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    // Nombre público del ORGANIZADOR — separado de first_name/last_name
    // (el nombre del jugador) para que un admin que también juega pueda
    // cambiar uno sin que el otro se mueva. null = "usar mi nombre de
    // jugador" (ver ORGANIZER_NAME_SQL, cae a first_name/last_name).
    organizer_first_name: z.string().trim().max(100).nullable().optional(),
    organizer_last_name: z.string().trim().max(100).nullable().optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    club_name: z.string().trim().max(150).nullable().optional(),
    birth_date: z.string().trim().min(1).max(10).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    // Región de Chile (lista oficial, igual que tournaments.region) — filtra
    // "Campeonatos nuevos" del Inicio. null = borrarla.
    region: z.string().trim().max(40).nullable().optional(),
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
