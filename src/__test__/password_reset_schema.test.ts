import { forgotPasswordSchema, resetPasswordSchema } from "../auth/schema/auth_schema";

describe("recuperar contraseña — validación", () => {
  it("normaliza el email", () => {
    expect(forgotPasswordSchema.parse({ email: "  Juan@Mail.COM " }).email).toBe("juan@mail.com");
  });

  it("acepta un código de 6 dígitos y una contraseña de 8+", () => {
    const r = resetPasswordSchema.safeParse({ email: "a@b.cl", code: "012345", password: "nueva1234" });
    expect(r.success).toBe(true);
  });

  it("rechaza códigos que no son de 6 dígitos", () => {
    for (const code of ["12345", "1234567", "12a456", ""]) {
      expect(resetPasswordSchema.safeParse({ email: "a@b.cl", code, password: "nueva1234" }).success).toBe(false);
    }
  });

  it("rechaza contraseñas cortas", () => {
    expect(resetPasswordSchema.safeParse({ email: "a@b.cl", code: "123456", password: "corta" }).success).toBe(false);
  });
});
