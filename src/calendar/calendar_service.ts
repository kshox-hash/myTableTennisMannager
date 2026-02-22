import { CalendarRepository } from "./calendar_repository";

export class CalendarService {
  constructor(private repo: CalendarRepository) {}

  async myEvents(userId: string, from: string, to: string) {
    return this.repo.myEventsInRange(userId, from, to);
  }
}
