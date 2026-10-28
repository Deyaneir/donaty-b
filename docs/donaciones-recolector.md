# Flujo de donaciones del recolector

Todas las rutas de esta guía requieren `Authorization: Bearer <token>` con rol `recolector`.

## Registro de donante externo

`POST /api/donacion/registrar-por-recolector`

La donación se guarda con estado `asignada`, y el recolector autenticado queda como `recolector` y `registradoPorRecolector`. La respuesta `{ donacion }` incluye `recolector`, `registradoPorRecolector`, `donanteExterno`, `campana` y `estado`.

Para JSON, las ubicaciones se envían así:

```json
{
  "donanteExterno": {
    "nombre": "Ana",
    "apellido": "Ejemplo",
    "telefono": "0990000000",
    "direccion": "Calle 1",
    "latitud": -0.18,
    "longitud": -78.48
  },
  "puntoRecoleccion": {
    "latitud": -0.18,
    "longitud": -78.48
  }
}
```

En `multipart/form-data`, `donanteExterno` y `puntoRecoleccion` pueden ser JSON serializado. También se aceptan los campos `donanteLatitud`, `donanteLongitud`, `puntoRecoleccionLatitud` y `puntoRecoleccionLongitud`. Como compatibilidad, `latitud` y `longitud` se interpretan como coordenadas del punto de recolección. Cada ubicación debe enviar ambas coordenadas; latitud va de -90 a 90 y longitud de -180 a 180. Son opcionales.

## Lista asignada

`GET /api/donacion/asignadas` devuelve donaciones cuyo campo `recolector` coincide con el recolector autenticado, incluidas las externas que se autoasignan al registrarlas. Las donaciones de un donante con cuenta aparecen solo después de que un administrador las asigne. No devuelve donaciones sin recolector asignado ni asignaciones de otros recolectores.

## Acciones y estados

| Acción | PATCH | Estado requerido | Estado resultante |
| --- | --- | --- | --- |
| Marcar pendiente de recolección | `/api/donacion/:id/pendiente-recoleccion` | `asignada` | `pendiente_recoleccion` |
| Marcar recolectada | `/api/donacion/:id/recolectar` | `pendiente_recoleccion` | `recolectada` |
| Clasificar | `/api/donacion/:id/clasificar` | `recolectada` | `clasificada` |
| Iniciar entrega | `/api/donacion/:id/iniciar-entrega` | `clasificada` | `en_entrega` |
| Marcar entregada | `/api/donacion/:id/entregar` | `en_entrega` | `entregada` |
| Solicitar devolución | `/api/donacion/:id/devolucion` | `recolectada` | `devolucion` |
| Confirmar devolución | `/api/donacion/:id/confirmar-devolucion` | `devolucion` | `devuelta` |

Las acciones solo las puede ejecutar el recolector asignado. Se devuelve `403` para otro usuario, `404` si no existe la donación y `409` si el estado actual no permite la transición. Todas aceptan body vacío `{}`; la solicitud de devolución puede incluir `{ "motivoDevolucion": "..." }`.

Orden para la cronología: `pendiente → asignada → pendiente_recoleccion → recolectada → clasificada → en_entrega → entregada`. La rama de devolución es `recolectada → devolucion → devuelta`. El backend devuelve el estado exacto guardado. Para la vista del recolector, mostrar desde `asignada` y mantener `asignada` y `pendiente_recoleccion` como pasos distintos. En etiquetas visibles, `pendiente` significa “Pendiente de asignación” y `pendiente_recoleccion` significa “Pendiente de recolección”.

## Lectura de QR

`POST /api/donacion/qr` requiere token Bearer y rol `admin`, `donante` o `recolector`.

```json
{ "codigo": "DONATY:<id_de_donacion>" }
```

El código debe comenzar con `DONATY:` y continuar con un ObjectId válido. La respuesta exitosa tiene la forma `{ "donacion": { ... } }` e incluye campaña, donante, recolector, estado, categoría, descripción, metadata, direcciones y marcas de tiempo. Administradores pueden consultar cualquier donación; donantes, solo las propias; recolectores, solo las asignadas a su cuenta.

Respuestas de error: `400` para código inválido, `403` si el usuario no tiene permiso, `404` si no existe la donación y `401` si falta o no es válido el token.