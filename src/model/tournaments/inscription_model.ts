// src/models/Inscription.ts
export interface IInscription {
  id: number;
  torneoId: number;
  jugadorId: number;
  fechaInscripcion: Date;
  estado: string; // pendiente, confirmado, rechazado
  pago: boolean;
}

export class Inscription implements IInscription {
  constructor(
    public id: number,
    public torneoId: number,
    public jugadorId: number,
    public fechaInscripcion: Date,
    public estado: string,
    public pago: boolean
  ) {}
}
