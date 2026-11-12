# Flujo de donaciones del recolector

Todas las rutas de esta guía requieren `Authorization: Bearer <token>` con rol `recolector`.

## Registro de donante externo

`POST /api/donacion/registrar-por-recolector`

La donación se guarda con estado `asignada`, y el recolector autenticado queda como `recolector` y `registradoPorRecolector`. La respuesta `{ donacion, asignacion }` incluye `recolector`, `registradoPorRecolector`, `donanteExterno`, `campana`, `estado` y el punto asignado. El backend no cambia al responsable por otro recolector del mismo punto.

El registro usa `multipart/form-data`: `campana`, `categoria`, `nombreBien`, `descripcion`, `imagen` y `donanteExterno` como texto JSON con `nombre`, `apellido` y `telefono`. La dirección no forma parte del contrato del donante externo ni se guarda dentro de `donanteExterno`. `tipo` puede omitirse y se guarda como `fisica`. `metadata` conserva los campos dinámicos requeridos por la categoría; también se acepta `cantidad` como campo multipart directo y se guarda en `metadata.cantidad`. Si se envían ambas cantidades, deben coincidir. `puntoRecoleccionId` puede omitirse si el recolector tiene un único punto asignado; si tiene varios, debe indicarse. `direccionEntrega` y `telefonoContacto` son opcionales y se guardan por separado. `ubicacionRecoleccion`, si se envía, debe ser un texto JSON con coordenadas GPS y se conserva como ubicación independiente. La respuesta incluye `asignacion` con el punto, recolector finalmente asignado y fecha.

Los errores conservan `{ "msg": "..." }`: validaciones de los datos responden `400` con el mensaje de campo, conflictos de estado/asignación `409` y errores internos `500`.

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

La ubicación seleccionada para la donación puede enviarse adicionalmente como el campo `ubicacionRecoleccion`, serializado como JSON en multipart:

```json
{
  "latitude": -0.210145,
  "longitude": -78.488712,
  "source": "gps_real",
  "isSimulated": false,
  "buildingId": 16,
  "buildingName": "Facultad de Ingeniería Eléctrica y Electrónica"
}
```

`buildingId` y `buildingName` son opcionales. `source` admite `gps_real`, `simulated` o `map`; las coordenadas y el origen se guardan en `donacion.ubicacionRecoleccion` y se devuelven en las respuestas autenticadas de registro, consulta y edición. Si `isSimulated` es verdadero (o `source` es `simulated`), el servidor normaliza el origen a `simulated` y no copia esas coordenadas al campo heredado `puntoRecoleccion`, que queda reservado para coordenadas GPS reales en este flujo. Una ubicación de origen `map` tampoco se trata como GPS real. El campo `direccionEntrega` se conserva de forma independiente.

## Lista asignada

`GET /api/donacion/asignadas` devuelve donaciones cuyo campo `recolector` coincide con el recolector autenticado, incluidas las externas que se autoasignan al registrarlas. Las donaciones de un donante con cuenta aparecen solo después de que un administrador las asigne. No devuelve donaciones sin recolector asignado ni asignaciones de otros recolectores.

`GET /api/campanas` para un recolector solo devuelve campañas activas y publicadas, dentro de sus fechas de participación, con puntos activos donde el recolector está asignado como principal o secundario. El mismo control se aplica al registrar una donación por recolector.

## Acciones y estados

| Acción | PATCH | Estado requerido | Estado resultante |
| --- | --- | --- | --- |
| Marcar pendiente de recolección | `/api/donacion/:id/pendiente-recoleccion` | `asignada` | `pendiente_recoleccion` |
| Marcar recolectada | `/api/donacion/:id/recolectar` | `pendiente_recoleccion` | `recolectada` |
| Clasificar | `/api/donacion/:id/clasificar` | `recolectada` | `en_entrega` |
| Iniciar entrega | `/api/donacion/:id/iniciar-entrega` | `clasificada` | `en_entrega` |
| Marcar entregada | `/api/donacion/:id/entregar` | `en_entrega` | `entregada` |
| Solicitar devolución | `/api/donacion/:id/devolucion` | `recolectada` | `devolucion` |
| Confirmar devolución | `/api/donacion/:id/confirmar-devolucion` | `devolucion` | `devuelta` |

Las acciones solo las puede ejecutar el recolector asignado. Se devuelve `403` para otro usuario, `404` si no existe la donación y `409` si el estado actual no permite la transición. Las acciones de transición conservan el body JSON vigente; la solicitud de devolución puede incluir `{ "motivoDevolucion": "..." }`.

Orden para la cronología: `pendiente → asignada → pendiente_recoleccion → recolectada → clasificada → en_entrega → entregada`. La rama de devolución es `recolectada → devolucion → devuelta`. El backend devuelve el estado exacto guardado. Para la vista del recolector, mostrar desde `asignada` y mantener `asignada` y `pendiente_recoleccion` como pasos distintos. En etiquetas visibles, `pendiente` significa “Pendiente de asignación” y `pendiente_recoleccion` significa “Pendiente de recolección”.

### Evidencias de recolección

`PATCH /api/donacion/:id/recolectar` recibe `multipart/form-data` con una o varias fotos en `imagen`, `imagenes` o `evidencias`. La evidencia se guarda antes de cambiar el estado; si no se puede persistir, la donación permanece en `pendiente_recoleccion`. Se recomienda enviar `Idempotency-Key` para reintentos. La respuesta contiene `{ donacion, evidencias }`.

La consulta `GET /api/campanas/:id/donaciones` está disponible para administradores y recolectores. El administrador recibe la campaña completa; el recolector recibe solamente las donaciones de sus puntos activos y `clasificacionPorPunto`, agrupada por categoría con `cantidadTotal` y los detalles individuales de donante, producto, bien y cantidad. La asignación se obtiene de la campaña y del usuario autenticado; no se acepta un punto elegido por el cliente.

### Evidencias de devolución

Las rutas existentes `PATCH /api/donacion/:id/devolucion` y `PATCH /api/donacion/:id/confirmar-devolucion` también aceptan `multipart/form-data` con `etapa=devolucion`, `idempotencyKey` y de una a dos imágenes en `evidencias`. La clave también puede enviarse en el encabezado `Idempotency-Key`. Las imágenes se guardan bajo el ID de la donación de la ruta; no se crea otra ruta ni se identifican donaciones por descripción.

La solicitud de devolución mueve `recolectada` a `devolucion`; la confirmación mueve `devolucion` a `devuelta`. Ambas guardan el estado y las evidencias en el mismo documento. Reintentar la misma acción con la misma clave devuelve `200` con `duplicada: true`; una etapa, cantidad de archivos o transición inválida devuelve un error claro. Se aceptan JPG, PNG y WebP hasta 5 MB por imagen. El body JSON anterior sigue disponible para clientes existentes.

### Clasificación

`PATCH /api/donacion/:id/clasificar` acepta el JSON vigente con `clasificacionId` para reutilizar una clasificación, o `nombre` para crearla/reutilizarla dentro de la campaña y punto de la donación:

```json
{ "nombre": "Peluches" }
```

El endpoint también conserva la compatibilidad con el formato previo `productosClasificados`. La donación cambia directamente a `en_entrega`; el endpoint existente `/api/donacion/:id/iniciar-entrega` es idempotente para admitir clientes que todavía lo llaman después de clasificar. La respuesta es `{ "donacion": {...}, "clasificacion": { "id": "...", "nombre": "...", "total": 5 } }`. `total` suma las cantidades guardadas de las donaciones vinculadas a ese ID de clasificación; no altera la identidad ni cantidad original de ninguna donación.

`GET /api/campanas/:campanaId/clasificaciones?puntoId=...` requiere administrador o recolector asignado al punto. Devuelve solo las clasificaciones persistidas de ese punto:

```json
[{ "id": "CLASIFICACION_ID", "nombre": "Peluches", "total": 5 }]
```

## Lectura de QR

`POST /api/donacion/qr` requiere token Bearer y rol `admin`, `donante` o `recolector`.

```json
{ "codigo": "DONATY:<id_de_donacion>" }
```

El código existente se forma con `DONATY:` seguido del `_id` de la donación; no se genera otro código para imprimir. La respuesta exitosa tiene la forma `{ "donacion": { ... } }` e incluye campaña, donante, recolector, estado, categoría, descripción, metadata, direcciones, marcas de tiempo, evidencias y productos clasificados. Administradores pueden consultar cualquier donación; donantes, solo las propias; recolectores asignados directamente o asignados al punto de recolección de la donación.

Respuestas de error: `400` para código inválido, `403` si el usuario no tiene permiso, `404` si no existe la donación y `401` si falta o no es válido el token.