// Todos contra todos por el método del círculo: N-1 jornadas (N par),
// cada jugador juega una vez por jornada. Si N es impar, uno descansa cada
// jornada (el par que le tocaría contra el "BYE" simplemente no se genera).
export function roundRobinSchedule(playerIds: string[]): Array<Array<[string, string]>> {
  const players = [...playerIds];
  if (players.length < 2) return [];
  if (players.length % 2 === 1) players.push("__BYE__");

  const n = players.length;
  const arr = [...players];
  const rounds: Array<Array<[string, string]>> = [];

  for (let r = 0; r < n - 1; r++) {
    const round: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        // Alterna quién va "primero" jornada por jornada (reparte de local/
        // visita si en el futuro importa; en fase 1 es solo cosmético).
        round.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(round);
    // Rota: arr[0] fijo, el último pasa a la posición 1.
    arr.splice(1, 0, arr.pop() as string);
  }

  return rounds;
}
