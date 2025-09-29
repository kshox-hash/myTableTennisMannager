
import { AuthService } from "../services/auth_service";
import { AuthRepository } from "../repositories/auth_repository";
import { Request, Response } from "express";


export class AuthController {
    constructor( 
        private readonly authService : AuthService,
        private readonly authRepo : AuthRepository
    
    ){}
      // POST /auth/signup

signup = async (req: Request, res: Response) : Promise<Response> => {
  try {
      const result = await this.authService.signup(req.body); // 2 = rol "player"
      return res.status(201).json({
        message: "Usuario creado correctamente",
        ...result,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
}

    


  // POST /auth/login
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const result = await this.authService.signup(req.body);
      return res.status(200).json({
        message: "Login exitoso",
        ...result,
      });
    } catch (err: any) {
      return res.status(401).json({ error: err.message });
    }
  }

  // GET /auth/me
  async me(req: Request, res: Response): Promise<Response> {
    try {
      const user = (req as any).user; // lo setea el middleware JWT
      return res.json({ user });
    } catch {
      return res.status(401).json({ error: "No autorizado" });
    }
  } 

}