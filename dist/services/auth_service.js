"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
class AuthService {
    constructor(authRepository) {
        this.authRepository = authRepository;
    }
    //registrar usuario
    async signup(item) {
        const user = await this.authRepository.create(item);
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=auth_service.js.map