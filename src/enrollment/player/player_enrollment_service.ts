import type { EnrollmentDTO } from "../../enrollment/schema/enrollment_schema";
import { EnrollmentsRepository } from "./player_enrollment_repository";

export class EnrollmentsService {
  constructor(private repo: EnrollmentsRepository) {}

  async enRoll(id_user: string, payload: EnrollmentDTO) {
    return this.repo.subscribe(id_user, payload);
  }
}
