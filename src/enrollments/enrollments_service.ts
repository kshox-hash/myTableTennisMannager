import { EnrollmentsRepository } from "./enrollments_repository";

export class EnrollmentsService {
  constructor(private repo: EnrollmentsRepository) {}

  async subscribe(payload: {
    id_user: string;
    id_tournament: string;
    id_category: string;
  }) {
    // aquí después puedes validar cuotas, status 'open', etc.
    return await this.repo.subscribe(payload);
  }
}
