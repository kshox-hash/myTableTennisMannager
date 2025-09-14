/*
Basándome en la estructura de tu base de datos, los endpoints que necesitas para tu aplicación pueden ser organizados de acuerdo a las funcionalidades de administración (para crear y gestionar campeonatos) y jugadores (para inscribirse en campeonatos y consultar información). A continuación, te proporciono los endpoints que cubrirían todas las funcionalidades necesarias para ambos roles.

Endpoints para Administradores:

Crear un campeonato:

Método: POST

Ruta: /api/campeonatos

Descripción: Crea un campeonato, con sus parámetros (fecha de inicio, fecha de fin, cantidad de jugadores, lugar, premios, etc.).

Cuerpo de la solicitud:

{
  "nombre": "Campeonato X",
  "fecha_inicio": "2025-01-01",
  "fecha_fin": "2025-01-15",
  "cantidad_jugadores": 16,
  "lugar": "Estadio X",
  "premios": "Premio 1, Premio 2",
  "creado_por": 1
}


Modificar un campeonato:

Método: PUT

Ruta: /api/campeonatos/{id_campeonato}

Descripción: Modifica un campeonato ya creado.

Cuerpo de la solicitud:

{
  "nombre": "Nuevo nombre del campeonato",
  "fecha_inicio": "2025-02-01",
  "fecha_fin": "2025-02-15",
  "cantidad_jugadores": 32,
  "lugar": "Nuevo Estadio",
  "premios": "Nuevo premio",
  "creado_por": 1
}


Obtener todos los campeonatos:

Método: GET

Ruta: /api/campeonatos

Descripción: Devuelve la lista de todos los campeonatos.

Obtener detalles de un campeonato específico:

Método: GET

Ruta: /api/campeonatos/{id_campeonato}

Descripción: Devuelve los detalles de un campeonato específico, incluidas las llaves y grupos si existen.

Agregar un participante a un campeonato:

Método: POST

Ruta: /api/campeonatos/{id_campeonato}/participantes

Descripción: Inscribe a un jugador en un campeonato.

Cuerpo de la solicitud:

{
  "id_usuario": 5
}


Obtener la lista de participantes de un campeonato:

Método: GET

Ruta: /api/campeonatos/{id_campeonato}/participantes

Descripción: Devuelve la lista de participantes en un campeonato específico.

Crear las llaves del campeonato:

Método: POST

Ruta: /api/campeonatos/{id_campeonato}/llaves

Descripción: Crea las llaves del campeonato, generando las rondas de acuerdo con la cantidad de jugadores.

Actualizar el puntaje de un partido:

Método: PUT

Ruta: /api/campeonatos/{id_campeonato}/partidos/{id_partido}

Descripción: Actualiza el puntaje de un partido.

Cuerpo de la solicitud:

{
  "puntaje_jugador1": 3,
  "puntaje_jugador2": 2
}

Endpoints para Jugadores:

Obtener todos los campeonatos disponibles:

Método: GET

Ruta: /api/campeonatos/activos

Descripción: Devuelve los campeonatos que están abiertos para inscripción.

Inscribirse en un campeonato:

Método: POST

Ruta: /api/campeonatos/{id_campeonato}/inscripcion

Descripción: Permite a un jugador inscribirse en un campeonato.

Cuerpo de la solicitud:

{
  "id_usuario": 3
}


Consultar el ranking:

Método: GET

Ruta: /api/ranking/{id_campeonato}

Descripción: Devuelve el ranking de los jugadores en un campeonato específico.

Consultar los partidos de un campeonato:

Método: GET

Ruta: /api/campeonatos/{id_campeonato}/partidos

Descripción: Devuelve todos los partidos de un campeonato, con su respectivo puntaje y ganador.

Consultar detalles de un partido específico:

Método: GET

Ruta: /api/campeonatos/{id_campeonato}/partidos/{id_partido}

Descripción: Devuelve los detalles de un partido específico en el campeonato.

Roles y Autorización

Los administradores deben tener acceso completo a los endpoints de creación y modificación de campeonatos, así como la gestión de partidos y participantes.

Los jugadores solo deben poder acceder a los campeonatos disponibles, inscribirse en ellos, consultar partidos y ver el ranking.

Resumen de Endpoints:
Para Administradores:

POST /api/campeonatos: Crear un campeonato.

PUT /api/campeonatos/{id_campeonato}: Modificar un campeonato.

GET /api/campeonatos: Ver todos los campeonatos.

GET /api/campeonatos/{id_campeonato}: Ver detalles de un campeonato.

POST /api/campeonatos/{id_campeonato}/participantes: Inscribir a un participante.

GET /api/campeonatos/{id_campeonato}/participantes: Ver participantes de un campeonato.

POST /api/campeonatos/{id_campeonato}/llaves: Crear llaves del campeonato.

PUT /api/campeonatos/{id_campeonato}/partidos/{id_partido}: Actualizar el puntaje de un partido.

Para Jugadores:

GET /api/campeonatos/activos: Ver campeonatos disponibles.

POST /api/campeonatos/{id_campeonato}/inscripcion: Inscribirse en un campeonato.

GET /api/ranking/{id_campeonato}: Ver el ranking.

GET /api/campeonatos/{id_campeonato}/partidos: Ver partidos de un campeonato.

GET /api/campeonatos/{id_campeonato}/partidos/{id_partido}: Ver detalles de un partido. */