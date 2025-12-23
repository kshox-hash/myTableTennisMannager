"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const auth_repository_1 = require("../repositories/auth_repository");
const auth_service_1 = require("../services/auth_service");
// si luego quieres hash real, instala bcryptjs y úsalo en el service
const authRepository = new auth_repository_1.AuthRepository();
const authService = new auth_service_1.AuthService(authRepository);
class AuthController {
    constructor() { }
    async signUp(req, res) {
        try {
            const { firstName, lastName, email, password_hash } = req.body ?? {};
            console.log(req.body);
            debugger;
            // Validaciones básicas
            if (!firstName || !lastName || !email || !password_hash) {
                return res.status(400).json({
                    ok: false,
                    message: "firstName, lastName, email y passwordHash son obligatorios",
                });
            }
            // Llama a la capa de servicio (se encarga del repo/PA)
            const user = await authService.signup({
                email: email,
                password_hash: password_hash,
                first_name: firstName,
                secondName: null,
                last_name: lastName,
                secondLastName: null,
                birthdate: null,
                category: null,
            });
            return res.status(201).json({ ok: true, user });
        }
        catch (error) {
            if (error?.code === "DUPLICATE_EMAIL") {
                return res.status(409).json({ ok: false, message: "El correo ya está registrado" });
            }
            console.error("[signUp] error:", error);
            return res.status(500).json({ ok: false, message: "Error interno" });
        }
    }
}
exports.AuthController = AuthController;
//# sourceMappingURL=auth_controller.js.map