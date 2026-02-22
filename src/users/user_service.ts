import { UserRepository } from "./user_repository";

export class UserService {
  constructor(private repo: UserRepository) {}

  async me(id_user: string) {
    const user = await this.repo.getMe(id_user);
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  }
}
