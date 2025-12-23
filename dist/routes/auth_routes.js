"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_controller_1 = require("../controller/auth_controller");
const routerAuth = express_1.default.Router();
const authController = new auth_controller_1.AuthController();
// Usar bind para no perder el this (aunque no lo uses ahora, es buena práctica)
routerAuth.post("/api/create-user", authController.signUp.bind(authController));
exports.default = routerAuth;
//# sourceMappingURL=auth_routes.js.map