# API de chat

Todas las rutas REST requieren `Authorization: Bearer <token>`. La identidad del remitente siempre se toma del JWT; Flutter no debe enviar `senderId`, `senderRol` ni identidad equivalente.

## Conversaciones permitidas

`GET /api/chat/conversations`

Devuelve solo los hilos permitidos al usuario actual:

- Donante: sus donaciones asignadas que tengan recolector.
- Recolector: donaciones con donante que estén asignadas actualmente a ese recolector, más sus chats directos con administradores.
- Administrador: solo chats directos que haya abierto con recolectores. No obtiene hilos privados de donaciones.

```json
{
  "items": [{
    "id": "donationId o admin:<adminId>:recolector:<collectorId>",
    "type": "donation",
    "donacion": {
      "_id": "donationId",
      "estado": "asignada",
      "descripcion": "Alimentos",
      "campana": { "_id": "campaignId", "nombre": "Campaña" }
    },
    "contacto": { "_id": "userId", "nombre": "Nombre", "apellido": "Apellido", "rol": "recolector" },
    "ultimoMensaje": null,
    "ultimaActividad": "2026-10-29T12:00:00.000Z",
    "noLeidos": 0,
    "soloLectura": false
  }]
}
```

## Chat donación

El hilo se identifica por el `donacionId`; no hay creación independiente de hilo.

`GET /api/chat/{donacionId}?limit=50` obtiene los mensajes y marca como leídos los mensajes anteriores al momento de lectura. `limit` se limita a 1..200.

`POST /api/chat/{donacionId}/messages`

```json
{ "text": "Hola" }
```

Respuesta `201`:

```json
{
  "message": {
    "room": "donationId",
    "donacion": "donationId",
    "senderId": "id tomado del JWT",
    "senderRol": "donante",
    "senderNombre": "Nombre",
    "senderApellido": "Apellido",
    "text": "Hola",
    "createdAt": "2026-10-29T12:00:00.000Z"
  }
}
```

El texto no puede superar 2000 caracteres. Para mensajes en tiempo real se puede emitir el evento Socket.IO `message` con `{ "roomId": "donationId", "text": "Hola" }`; el backend emite el mensaje persistido a la sala.

## Chat administrador-recolector

Solo un administrador puede abrirlo:

`POST /api/chat/direct/{collectorId}`

Devuelve `conversacion` con `id`, `type: "admin_recolector"`, contacto, último mensaje y `noLeidos`. La sala tiene la forma `admin:{adminId}:recolector:{collectorId}`. Se usa el mismo `GET /api/chat/{roomId}`, `POST /api/chat/{roomId}/messages` y los eventos Socket.IO.

## Socket.IO y autorización

Autenticar el handshake con `{ auth: { token } }` (también se acepta `Authorization: Bearer ...`). Emitir `joinRoom` con `{ "roomId": "..." }` antes de escuchar `joinedRoom`. Eventos disponibles: `message`, `typing`, `leaveRoom`, `roomAccessRevoked` y `error`.

El servidor vuelve a validar el acceso para entrar, escribir y señalar escritura. En salas de donación solo acceden el donante propietario y el recolector asignado vigente. Los administradores no acceden a estas salas. Al reasignar, el socket del recolector anterior se saca y recibe `roomAccessRevoked`; se conserva el historial y el nuevo recolector queda como participante actual.

Las donaciones `entregada`, `cancelada` o `devuelta` son de solo lectura: pueden consultar historial, pero no enviar mensajes ni emitir `typing`.

Errores REST usan `{ "msg": "..." }`: `401` no autenticado, `403` sin acceso, `404` sala/participante inexistente, `409` chat de solo lectura, `400` ID/texto inválido y `500` error interno. Socket.IO comunica errores con evento `error` y `{ "msg": "...", "code": 4xx }` cuando aplica.