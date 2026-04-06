import type { EnrollmentDTO } from "../../enrollment/schema/enrollent_schema";
import { EnrollmentsRepository } from "./player_enrollment_repository";

export class EnrollmentsService {
  constructor(private repo: EnrollmentsRepository) {}

  async enRoll(payload: EnrollmentDTO) {
    return this.repo.subscribe(payload);
  }
}