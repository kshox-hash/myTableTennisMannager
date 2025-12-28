import { Request, Response } from "express";
import { EnrollmentService } from "./enrollment_service";

export class EnrollmentController {
  private service = new EnrollmentService();

  // POST /enrollments
  enroll = async (req: Request, res: Response) => {
    try {
      const { id_tournament, id_category } = req.body;

      // 👇 idealmente viene del token
      const id_user = req.body.id_user;

      const enrollment = await this.service.enroll({
        id_user,
        id_tournament,
        id_category,
      });

      return res.status(201).json(enrollment);
    } catch (err: any) {
      return this.handleError(res, err);
    }
  };

  /**  


  // DELETE /enrollments/:id_enrollment
  cancel = async (req: Request, res: Response) => {
    try {
      const { id_enrollment } = req.params;
      const id_user = req.body.id_user;

      await this.service.cancel(id_enrollment, id_user);
      return res.status(204).send();
    } catch (err: any) {
      return this.handleError(res, err);
    }
  };

  // GET /enrollments/tournaments/:id_tournament
  getByTournament = async (req: Request, res: Response) => {
    try {
      const { id_tournament } = req.params;
      const enrollments = await this.service.getByTournament(id_tournament);
      return res.json(enrollments);
    } catch (err: any) {
      return this.handleError(res, err);
    }
  };

  // GET /enrollments/me
  getMine = async (req: Request, res: Response) => {
    try {
      const id_user = req.body.id_user;
      const enrollments = await this.service.getMine(id_user);
      return res.json(enrollments);
    } catch (err: any) {
      return this.handleError(res, err);
    }
  };

    */

  // =========================
  // Error handling central
  // =========================
  private handleError(res: Response, err: any) {
    switch (err.message) {
      case "USER_NOT_PLAYER":
        return res.status(403).json({ message: "Solo jugadores pueden inscribirse" });

      case "CATEGORY_FULL":
        return res.status(409).json({ message: "La categoría no tiene cupos" });

      case "ALREADY_ENROLLED":
        return res.status(409).json({ message: "Ya estás inscrito en esta categoría" });

      case "CATEGORY_NOT_FOUND":
        return res.status(404).json({ message: "Categoría no encontrada" });

      default:
        console.error(err);
        return res.status(500).json({ message: "Error interno" });
    }
  }
}
