
import { AuthRepository } from "../repositories/auth_repository";
import { IUser } from "../interfaces/user_interface";


export class AuthService {
  constructor( public authRepository : AuthRepository ) {}

  //registrar usuario
  async signup( item : IUser) : Promise<IUser | null>{ 
    // Verificar si email ya existe
    const existingUser = await this.authRepository.findByEmail(item.email);
    if (existingUser) {
      throw new Error("El usuario ya existe");
    }

    const existinRut = await this.authRepository.findById(item.rut);
    if (existinRut) {
      throw new Error("El RUT ya está registrado");
    }

   const newUser : IUser = await this.authRepository.create(item);
   return newUser

  }

}