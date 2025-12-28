import { Router } from "express";
import { EnrollmentController } from "../enrollments/enrollment_controller";

const router = Router();
const controller = new EnrollmentController();

// Inscribirse a una categoría de un torneo
router.post("/enroll", controller.enroll);

// Cancelar inscripción
//router.delete("/:id_enrollment", controller.cancel);

// Ver inscritos de un torneo (admin)
//router.get("/tournaments/:id_tournament", controller.getByTournament);

// Ver mis inscripciones
//router.get("/me", controller.getMine);

export default router;
