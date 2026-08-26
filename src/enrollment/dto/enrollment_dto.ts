export type { EnrollmentDTO } from "../schema/enrollment_schema";

export type EnrollmentResultRow = {
  id_enrollment: string;
  id_user: string;
  id_tournament: string;
  id_category: string;
  status: string;
  enrolled_at: string | Date;
};
