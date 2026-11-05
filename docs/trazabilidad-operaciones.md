# Contratos de trazabilidad y recolectores

Todas las rutas indicadas usan el prefijo `/api` y requieren `Authorization: Bearer <JWT>`, salvo donde se indique. Los identificadores son ObjectId de MongoDB.

## Puntos de recolección en campañas

Los administradores pueden crear o editar `puntosRecoleccion` en las operaciones existentes de campaña. Cada punto acepta:

```json
{
  "_id": "opcional-al-crear",
  "nombre": "Centro norte",
  "campanaId": "CAMPANA_ID",
  "edificioId": 16,
  "nombreEdificio": "Facultad de Ingeniería Eléctrica y Electrónica",
  "estado": "activo",
  "edificio": "Bloque A",
  "piso": "2",
  "aula": "Aula 204",
  "direccion": "Calle 1",
  "referenciasLugar": "Junto a recepción",
  "telefonoContacto": "022222222",
  "latitud": -0.18,
  "longitud": -78.47,
  "activo": true
}
```

También se exponen las operaciones administrativas:

- `GET /api/campanas/:campanaId/puntos` — administrador ve todos los puntos (incluidos inactivos); donante y recolector autenticados ven solo puntos activos de campañas activas. Responde `{ "campanaId": "...", "totalPuntos": 1, "puntos": [...] }`; cada elemento incluye `_id`, `id`, `campanaId`, `nombre`, `descripcion`, `direccion`, `referenciasLugar`, `telefonoContacto`, `latitud`, `longitud`, `latitude`, `longitude` y `estado`. `edificio`, `piso` y `aula` son cadenas vacías para registros antiguos que no los tengan. Los puntos embebidos permanecen almacenados en el documento campaña.
- `POST /api/campanas/:campaignId/puntos` — crea un punto. El cuerpo puede ser el objeto del punto mostrado arriba o `{ "punto": { ... } }`. Responde `201` con `campanaId`, `punto` y `totalPuntos`.
- `PATCH /api/campanas/:campaignId/puntos/:pointId` — edita los campos enviados del punto, incluidos `estado: "activo"|"inactivo"` para activar/desactivar. Acepta coordenadas `latitud`/`longitud` o `latitude`/`longitude`; responde `200` con `campanaId`, `punto` y `totalPuntos`.
- `DELETE /api/campanas/:campaignId/puntos/:pointId` — elimina un punto sin asignaciones ni donaciones relacionadas. Responde `200` con `campanaId`, `pointId` y el nuevo `totalPuntos`; devuelve `409` si el punto está en uso.
- La edición de puntos sigue disponible mediante `PATCH /api/campanas/:id` o `PUT /api/campanas/:id`, enviando la lista `puntosRecoleccion`; no hay una ruta de edición individual de punto.
- `GET /api/campanas/admin/lista` — cada objeto de `campanas` incluye `totalPuntos`, calculado como el tamaño actual de `puntosRecoleccion` (0 cuando no hay puntos), además de `totalDonaciones`.

Los puntos se guardan embebidos en el documento `Campana`; no hay una colección/modelo independiente. `nombre` es obligatorio (si no llega, se deriva de datos reales edificio/nombre de edificio/aula). Descripción, dirección, referencias y coordenadas se persisten cuando las envía el cliente; para puntos creados por el formulario actual que no mande esos campos, el backend devuelve texto vacío o coordenadas `null`, no inventa valores. Latitud/longitud deben llegar juntas y dentro de rangos geográficos válidos.

La respuesta de consulta de campaña conserva los datos del punto para donantes y recolectores, pero no expone IDs de recolectores ni el historial administrativo de asignaciones. Los administradores pueden consultarlos en la distribución.

## Recolectores disponibles y distribución

- `GET /api/donaciones-fisicas/admin/recolectores` — solo administrador. Devuelve recolectores activos, aprobados y con correo confirmado:

```json
{
  "total": 1,
  "recolectores": [
    {
      "_id": "RECOLECTOR_ID",
      "nombre": "Ana",
      "apellido": "Pérez",
      "email": "ana@example.test",
      "telefono": "",
      "asignadasActivas": 0
    }
  ]
}
```

- `POST /api/campanas/:campaignId/distribucion-recolectores` — solo administrador. Cuerpo:

```json
{ "recolectores": ["RECOLECTOR_ID_1", "RECOLECTOR_ID_2"], "motivo": "Distribución inicial" }
```

La lista contiene recolectores nuevos para asignar; los recolectores que ya tienen punto en la campaña se conservan y no se redistribuyen. El servidor reparte los nuevos de forma equilibrada entre puntos activos, con máximo 3 por punto y sin duplicar un recolector dentro de la campaña. La capacidad total es la suma de los espacios disponibles en los puntos activos, sin un máximo adicional por campaña. Rechaza IDs duplicados, inactivos, no aprobados, no verificados y selecciones que excedan la capacidad. Agregar o editar puntos no cambia las asignaciones existentes. La escritura usa control optimista de versión; si hay conflicto concurrente devuelve `409` para que el cliente vuelva a consultar. Las nuevas asignaciones notifican a los recolectores afectados.

Respuesta `200`:

```json
{
  "campanaId": "CAMPANA_ID",
  "puntos": [
    {
      "_id": "PUNTO_ID",
      "nombre": "Centro norte",
      "recolectores": ["RECOLECTOR_ID_1"],
      "responsableRecolector": "RECOLECTOR_ID_1"
    }
  ],
  "totalRecolectores": 1
}
```

- `GET /api/campanas/:campaignId/distribucion-recolectores` — solo administrador. Devuelve `campanaId`, cada punto con sus recolectores autorizados y responsable vigente, y `historialAsignaciones` ordenado cronológicamente. Cada entrada contiene recolector, campaña, punto anterior/nuevo, administrador, fecha, motivo y `vigente`.
- `PUT /api/campanas/:campaignId/puntos/:pointId/reasignar` — solo administrador. Mueve o asigna explícitamente un recolector (no redistribuye los demás):

```json
{ "recolectorId": "RECOLECTOR_ID", "motivo": "Cambio solicitado" }
```

Valida que el punto pertenezca a la campaña, esté activo y tenga capacidad. Devuelve `campanaId`, `punto`, `recolector` e `historialAsignaciones`. Las asignaciones anteriores se conservan; solo se marca la vigente como tal.

## Ubicación GPS

- `GET /api/recolector/asignaciones-vigentes` — solo recolector autenticado. Devuelve sus puntos activos asignados, con campaña, edificio, piso, aula, dirección y referencias. El móvil usa los IDs devueltos para actualizar GPS; no selecciona un punto ni un recolector aleatoriamente.
- `POST /api/recolectores/ubicacion` — solo recolector. El usuario autenticado debe estar asignado al punto activo de una campaña activa:

```json
{
  "campanaId": "CAMPANA_ID",
  "puntoRecoleccionId": "PUNTO_ID",
  "latitud": -0.210145,
  "longitud": -78.488712,
  "precisionMetros": 8.5
}
```

El servidor vuelve a validar la asignación y el geofence del polígono real de la EPN (OpenStreetMap way `31135336`, ODbL 1.0), y rechaza precisiones superiores a 50 m. Una ubicación fuera del polígono responde `403` con código `OUTSIDE_EPN_GEOFENCE`; una precisión insuficiente responde `422` con código `LOCATION_ACCURACY_INSUFFICIENT`. La API no reasigna recolectores automáticamente. La respuesta `200` contiene `ubicacion` con IDs, coordenadas, `precisionMetros` y `actualizadoEn`.

- `GET /api/campanas/:campaignId/ubicaciones-recolectores` — solo administrador. Devuelve `ubicaciones`; cada elemento contiene recolector, punto, `estado` (`activo`, `inactivo` o `desactualizado`), coordenadas y `actualizadoEn`. Un recolector asignado puede estar `activo` si la ubicación corresponde a su campaña/punto actual; después de 5 minutos el GPS es `desactualizado` y las coordenadas se omiten. Ubicaciones antiguas no se presentan como actuales.

## Consulta de trazabilidad QR

- `POST /api/donacion/qr` — administrador, donante autenticado o recolector autenticado.
- Cuerpo: `{ "codigo": "DONATY:DONACION_ID" }`.
- Un donante solo consulta sus propias donaciones; un recolector solo las que tiene asignadas; el administrador puede consultar cualquiera. El acceso no autorizado responde `403`.
- Respuesta `200`: `donacion`, `puntoRecoleccion`, `recolectoresAsignadosAlPunto`, `responsableVigente`, `ubicacionResponsable`, `historialEstados`, `historialRecolectores` y `evidenciasPorEtapa`.
- `puntoRecoleccion` incluye identificador, nombre, edificio, piso, aula, dirección y referencias existentes en el punto.
- Los historiales se devuelven cronológicamente. El historial de estados comienza con las transiciones registradas desde esta versión; los registros históricos no se reconstruyen ni se inventan.
- `ubicacionResponsable` informa `estado`, `coordenadas` y `actualizadoEn`. Coordenadas se devuelven solo cuando la ubicación corresponde a la campaña y punto de la donación y tiene menos de 5 minutos.

## Evidencias fotográficas

- `POST /api/donacion/:id/evidencias` — solo recolector asignado. `multipart/form-data` con `etapa` (`recepcion`, `finalizacion` o `devolucion`) y archivo `imagen`.
- Encabezado obligatorio: `Idempotency-Key` (máximo 128 caracteres).
- La etapa debe ser compatible con el estado actual: recepción (`pendiente_recoleccion` o `recolectada`), finalización (`entregada`) o devolución (`devolucion` o `devuelta`). La asignación y el estado se vuelven a comprobar al guardar.
- Las imágenes JPG, PNG y WebP tienen un máximo de 5 MB y se almacenan en Cloudinary. La falta de una foto no bloquea ni cambia las rutas de transición de estado existentes.
- Respuesta `201` contiene `evidencia`, `evidenciasPorEtapa` y `duplicada: false`. Un reintento con la misma clave devuelve `200`, la evidencia ya guardada y `duplicada: true`; no crea otro registro.

## Cantidad por categoría

Los administradores pueden definir `maxUnidadesPorDonacion` (entero positivo o `null`) al crear/editar una categoría. Si se envía, `metadata.cantidad` debe ser un entero positivo y no exceder ese máximo. La cantidad se guarda en `donacion.metadata.cantidad` y se devuelve con la donación. Categorías sin límite (`null`) no tienen un máximo configurado.

## Asignación automática al registrar una donación

`POST /api/donacion` requiere la campaña y los datos del bien; el donante no elige ni envía el punto ni el recolector. El servidor obtiene nombre y teléfono de `Donante`, elige un punto activo y un recolector habilitado asignado a ese punto y persiste `puntoRecoleccionRef`, `recolector`, `fechaAsignacion` y la entrada de `historialRecolectores`. No utiliza la ubicación GPS para elegir la asignación. `metodoEntrega` se guarda como `punto_recoleccion` y `direccionEntrega` se resuelve desde el punto. `referenciasEntrega` puede contener indicaciones adicionales del donante; si se omite, se usan las referencias del punto.

La selección minimiza primero la carga más alta entre el punto y el recolector candidato y luego su carga combinada. Los empates se resuelven aleatoriamente. Se excluyen `cancelada`, `entregada` y `devuelta` del conteo. La lectura de cargas, bloqueo de campaña y creación de la donación se ejecutan en una transacción MongoDB; se requiere una instancia compatible con transacciones (por ejemplo, Atlas o replica set). Si falta punto/recolector disponible, el endpoint devuelve `409` sin crear la donación.

El teléfono del donante se lee del perfil y se guarda como snapshot en `telefonoContacto`; si falta, responde `400` pidiendo completar el perfil. No se usa un teléfono del body. La ubicación opcional recibida se puede guardar aparte, pero nunca interviene en la selección de punto o recolector.

La respuesta conserva `{ "donacion": ... }` e incluye `asignacion` con el punto, recolector y fecha elegidos. La donación incluye además `recolector`, `puntoRecoleccionRef`, `fechaAsignacion`, `fechaRegistro`, `telefonoContacto`, `direccionEntrega` e `historialRecolectores`. Las donaciones registradas por recolectores para donantes externos mantienen su flujo anterior.

Al completar el registro, el backend envía una notificación al recolector elegido, además de la notificación administrativa existente.

Las campañas nuevas se crean inactivas de forma predeterminada. Se configuran puntos y se distribuyen recolectores hasta la capacidad disponible (máximo 3 por punto) mediante `POST /api/campanas/:campaignId/distribucion-recolectores`; luego se pueden activar con `PATCH /api/campanas/:id`. El servidor rechaza la activación cuando no hay al menos un recolector activo, aprobado y verificado asignado a un punto activo.

Ejemplo de respuesta del registro:

```json
{
  "donacion": {
    "_id": "DONACION_ID",
    "estado": "asignada",
    "campana": "CAMPANA_ID",
    "puntoRecoleccionRef": "PUNTO_ID",
    "recolector": "RECOLECTOR_ID",
    "fechaAsignacion": "2026-11-03T03:00:00.000Z",
    "direccionEntrega": "Centro norte"
  },
  "asignacion": {
    "fecha": "2026-11-03T03:00:00.000Z",
    "puntoRecoleccion": {
      "_id": "PUNTO_ID",
      "nombre": "Centro norte",
      "direccion": "Calle 1",
      "referenciasLugar": "Junto a recepción",
      "telefonoContacto": "022222222"
    },
    "recolector": {
      "_id": "RECOLECTOR_ID",
      "nombre": "Ana",
      "apellido": "Pérez"
    }
  }
}
```

`PATCH /api/donaciones-fisicas/:id/admin-asignar` mantiene la reasignación administrativa existente. Para donaciones vinculadas a campaña, el recolector destino debe estar asignado al mismo punto. La ruta registra recolector/punto anterior y nuevo y actualiza `fechaAsignacion`; los conteos de carga se derivan de las donaciones no finalizadas, por lo que reasignar actualiza las cargas sin contadores duplicados.

## Respuestas de error

Las rutas devuelven `{ "msg": "..." }` para errores. Se usan `400` para datos inválidos, `401` para falta de autenticación, `403` para permisos o asignación no autorizada, `404` para recursos inexistentes, `409` para capacidad/estado/conflictos de concurrencia y `500` para errores internos.
