import { z } from "zod";

// id_user no va en el body — viene del JWT (req.user.id_user)
export const enrollmentSchema = z
  .object({
    id_tournament: z.string().uuid("id_tournament inválido"),
    id_category: z.string().uuid("id_category inválido"),
  })
  .strict();

export type EnrollmentDTO = Readonly<z.infer<typeof enrollmentSchema>>;
