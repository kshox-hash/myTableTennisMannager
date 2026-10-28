-- La inscripción online ahora también funciona en fase de grupos si el
-- organizador la reabre a mano (status='active'). Las categorías que ya
-- empezaron quedaban con status='active' "de arrastre" (antes lo que
-- bloqueaba era solo la fase), así que se cierran para que no se abran solas.
UPDATE tournament_categories
SET status = 'closed'
WHERE status = 'active'
  AND COALESCE(phase, 'enrollment') <> 'enrollment';
