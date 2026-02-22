import { Router } from "express";
import { LocationsController } from "../locations/locations_controller";

const router = Router();
const controller = new LocationsController();

router.get("/regions", controller.regions);
router.get("/provinces", controller.provinces); // ?regionCode=
router.get("/communes", controller.communes);   // ?provinceCode=

export default router;
