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

`POST /api/campanas` acepta `multipart/form-data` con `nombre`, `descripcion`, `ubicacion`, `fechaInicio`, `fechaFin`, `periodoAcademico`, `diasAtencion` (lista JSON), `horaInicio`, `horaFin`, `numeroRecolectores`, `metaDonaciones` y `activa`. Los valores numéricos y booleanos pueden enviarse como texto multipart; `activa` debe ser `false` al crear porque las campañas se guardan como borrador y se activan después. `imagen` es opcional; si se omite, la campaña se crea sin imagen de portada. La creación responde `201` con `{ msg, campana, disponibilidad }`.

Después de crear la campaña, cada punto se puede agregar mediante `POST /api/campanas/:campaignId/puntos` como JSON. La respuesta `201` contiene `{ campanaId, punto, totalPuntos }`.

También se exponen las operaciones administrativas:

- `GET /api/campanas/:campanaId/puntos` — administrador ve todos los puntos (incluidos inactivos); donante y recolector autenticados ven solo puntos activos de campañas activas. Responde `{ "campanaId": "...", "totalPuntos": 1, "puntos": [...] }`; cada elemento incluye `_id`, `id`, `campanaId`, `nombre`, `descripcion`, `direccion`, `referenciasLugar`, `telefonoContacto`, `latitud`, `longitud`, `latitude`, `longitude` y `estado`. `edificio`, `piso` y `aula` son cadenas vacías para registros antiguos que no los tengan. Los puntos embebidos permanecen almacenados en el documento campaña.
- `POST /api/campanas/:campaignId/puntos` — crea un punto. El cuerpo puede ser el objeto del punto mostrado arriba o `{ "punto": { ... } }`. Responde `201` con `campanaId`, `punto` y `totalPuntos`.
- `PATCH /api/campanas/:campaignId/puntos/:pointId` — edita los campos enviados del punto, incluidos `estado: "activo"|"inactivo"` para activar/desactivar. Acepta coordenadas `latitud`/`longitud` o `latitude`/`longitude`; responde `200` con `campanaId`, `punto` y `totalPuntos`.
- `DELETE /api/campanas/:campaignId/puntos/:pointId` — elimina un punto sin asignaciones ni donaciones relacionadas. Responde `200` con `campanaId`, `pointId` y el nuevo `totalPuntos`; devuelve `409` si el punto está en uso.
- La edición de puntos sigue disponible mediante `PATCH /api/campanas/:id` o `PUT /api/campanas/:id`, enviando la lista `puntosRecoleccion`; no hay una ruta de edición individual de punto.
- `GET /api/campanas/admin/lista` — cada objeto de `campanas` incluye `totalPuntos`, calculado como el tamaño actual de `puntosRecoleccion` (0 cuando no hay puntos), además de `totalDonaciones`.

Los puntos se guardan embebidos en el documento `Campana`; no hay una colección/modelo independiente. `nombre` es obligatorio (si no llega, se deriva de datos reales edificio/nombre de edificio/aula). Descripción, dirección, referencias y coordenadas se persisten cuando las envía el cliente; para puntos creados por el formulario actual que no mande esos campos, el backend devuelve texto vacío o coordenadas `null`, no inventa valores. Latitud/longitud deben llegar juntas y dentro de rangos geográficos válidos.

La respuesta de consulta de campaña conserva los datos del punto para donantes y recolectores, pero no expone IDs de recolectores ni el historial administrativo de asignaciones. Los administradores pueden consultarlos en la distribución.

## Fechas, horario y disponibilidad de campañas

`fechaInicio` y `fechaFin` siguen siendo campos BSON `Date` (sin migración ni campos nuevos) y representan días calendario, no instantes de apertura/cierre. `horaInicio` y `horaFin` son horas diarias `HH:mm` que se repiten en cada día del rango inclusivo. La campaña abre en la fecha inicial a `horaInicio` y cierra en la fecha final a `horaFin`; por ejemplo, del 5 al 8 de noviembre, de 09:00 a 17:00, queda disponible cada uno de esos cuatro días de 09:00 a 17:00.

Las fechas recibidas en el formato existente (`YYYY-MM-DD` o ISO con fecha) se guardan como medianoche UTC para preservar el día calendario enviado. Los registros existentes conservan sus valores y se interpretan por su componente de fecha UTC; no se ejecuta migración. Los registros antiguos con fechas y horas válidas siguen funcionando; un horario faltante o inválido no se considera disponible hasta que se corrija.

La disponibilidad se calcula con `America/Guayaquil`, con límites inclusivos: antes de inicio o después de cierre no se puede seleccionar la campaña ni registrar donaciones. `fechaFin` anterior a `fechaInicio` se rechaza; ambos días pueden ser iguales si las horas son válidas y `horaFin` es posterior. Las horas deben ser `HH:mm` y `horaFin` debe ser posterior a `horaInicio`.

El filtro aplica a `GET /api/campanas` para donantes/recolectores, las consultas de categorías y subcategorías, y el registro de donaciones, con nueva comprobación dentro de la transacción de asignación. La respuesta para administradores mantiene su visibilidad actual. La campaña se considera finalizada para estas reglas después de su hora de cierre en Ecuador.

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

- `GET /api/campanas/:campaignId/distribucion-recolectores` — administrador o recolector asignado actualmente. El administrador recibe la distribución completa e historial ordenado cronológicamente. El recolector recibe solo sus puntos activos, con ubicación, responsable principal y el equipo asignado a cada uno; no recibe otros puntos ni sus responsables. Devuelve `campanaId` y `puntos`; cada punto contiene `responsableRecolector` y `recolectores`, ambos con `_id`, `nombre`, `apellido` y `rolPunto` (`principal` o `apoyo`). El principal figura en el equipo aunque no se repita en la lista persistida de secundarios.
- Las asignaciones de principal y apoyos quedan registradas con fecha del servidor al crear el punto (`POST /api/campanas/:campaignId/puntos`), al crearlo junto con la campaña, o al cambiar recolectores en el punto. La ruta existente de distribución devuelve esa fecha como `historialAsignaciones[].fecha`. Las asignaciones antiguas sin fecha persistida no se reconstruyen ni se les asigna una fecha estimada.
- `GET /api/campanas/historial` para un donante usa el ID del usuario autenticado y devuelve solo campañas vinculadas a sus donaciones; cada elemento incluye `_id`, `nombre`, `estado`, `fechaInicio`, `fechaFin`, `periodoAcademico` e `imagenUrl`. Administradores y recolectores conservan su propio alcance de historial. En el historial de recolectores, las asignaciones vigentes sin historial persistido se indican con `fuente: "asignacion_vigente"` y `fecha: null`; incluyen recolector, punto y rol principal/secundario.
- Los donantes pueden consultar campañas activas/disponibles y campañas cerradas o inactivas donde tengan donaciones propias. La portada `imagenUrl` se conserva en las respuestas de campañas e historial. Categorías y subcategorías históricas se conservan para consultar las donaciones existentes; esto no habilita nuevos registros.
- Los avisos de asignación usan los dispositivos registrados en `PUT /api/notifications/device`. El payload de datos incluye `type: "collector_point_assignment"`, `campaignId`/`campanaId`, `campaignName`, `pointId`/`puntoRecoleccionId`, `pointName`, `principalId`, `principalNombre`, `principalApellido`, `recolectores` (JSON con `_id`, `nombre`, `apellido`, `rolPunto`) y `rolPunto` del destinatario. La notificación también incluye `title` y `body` para primer plano; el envío informa `sent` solo si FCM no reporta fallos.
- `PUT /api/campanas/:campaignId/puntos/:pointId/reasignar` — solo administrador. Mueve o asigna explícitamente un recolector (no redistribuye los demás):

```json
{ "recolectorId": "RECOLECTOR_ID", "rol": "principal", "motivo": "Cambio solicitado" }
```

`rol` admite `principal` o `apoyo`; se puede omitir para conservar el comportamiento anterior. Para sustituir a un recolector y transferir sus donaciones, enviar también `recolectorAnteriorId` con el ID del recolector asignado actualmente al mismo punto. La operación conserva estados y evidencias, registra el cambio en los historiales de campaña y donaciones, y libera la reserva del recolector anterior. Cada punto conserva un solo `responsableRecolector` principal. Designar uno nuevo sin indicar `recolectorAnteriorId` conserva el comportamiento anterior; cambiar el principal a apoyo exige que haya otro recolector para promover. Un apoyo no puede registrar la entrega general.

Los responsables no recolectores de una campaña se configuran por separado en `POST /api/campanas` o `PATCH|PUT /api/campanas/:id`, con `responsablesCampana`:

```json
{
  "responsablesCampana": [
    { "nombreCompleto": "Nombre Apellido", "cargo": "Coordinación" }
  ]
}
```

La campaña almacena uno o varios nombres completos y cargos, sin valores predeterminados. Se conservan separados de los recolectores principales, los de apoyo y quien registra la entrega.

Valida que el punto pertenezca a la campaña, esté activo y tenga capacidad. Devuelve `campanaId`, `punto`, `recolector`, `rol` e `historialAsignaciones`. Las asignaciones anteriores se conservan; solo se marca la vigente como tal.

## Ubicación GPS

- `GET /api/recolector/asignaciones-vigentes` — solo recolector autenticado. En cada elemento de `items`, `fechaAsignacion` contiene la fecha/hora real en ISO 8601; el móvil debe leer `items[].fechaAsignacion` y mostrarla en hora local. Para asignaciones antiguas sin fecha persistida, el valor es `null`; no se inventa la fecha. El móvil usa los IDs devueltos para actualizar GPS; no selecciona un punto ni un recolector aleatoriamente.
- Cuando `PATCH /api/campanas/:id` agrega o mueve recolectores al editar puntos, el backend registra la fecha/hora exacta del cambio en el historial. Editar otros datos o reenviar sin cambios la misma asignación no crea una fecha nueva.
- `GET /api/recolectores/ubicacion` — solo recolector autenticado. Devuelve la última ubicación del propio recolector, sus coordenadas, fecha de captura (`capturadoEn`) y fecha de recepción (`actualizadoEn`). Una captura antigua conserva su fecha original; no se sustituye por la fecha de recepción.
- `GET /api/recolectores/:collectorId/ubicacion` — administrador o el mismo recolector. Consulta la última posición guardada para ese recolector; otro recolector recibe `403`. Cada `POST` guarda también un registro de historial con la fecha original `capturadoEn` y la fecha de recepción del servidor.
- `POST /api/recolectores/ubicacion` — solo recolector autenticado. Registra la ubicación del token autenticado sin requerir campaña, punto ni pertenencia al geofence:

```json
{
  "latitud": -0.210145,
  "longitud": -78.488712,
  "precisionMetros": 8.5,
  "capturadoEn": "2026-11-06T14:30:00.000Z"
}
```

Las coordenadas son obligatorias y deben estar dentro de los rangos de latitud y longitud. `precisionMetros` y `capturadoEn` son opcionales; si se envían, deben tener formato válido. `capturadoEn` conserva la hora de captura del dispositivo y `actualizadoEn` registra la recepción del servidor. Una ubicación fuera del área también se guarda y consulta, pero no concede permiso para operar.

El guard geográfico sigue aplicándose a las operaciones de recolector que requieren presencia física (por ejemplo, registrar donaciones, cambiar su estado o subir evidencias). Para esas operaciones se valida que la ubicación sea reciente, precisa y esté dentro del polígono real de la EPN (OpenStreetMap way `31135336`, ODbL 1.0); la separación de este endpoint no elimina esas validaciones. La API no reasigna recolectores automáticamente.

- `GET /api/campanas/:campaignId/ubicaciones-recolectores` — solo administrador. Devuelve `ubicaciones`; cada elemento contiene recolector, punto, `estado` (`activo`, `inactivo` o `desactualizado`), coordenadas y `actualizadoEn`. Un recolector asignado puede estar `activo` si la ubicación corresponde a su campaña/punto actual; después de 5 minutos el GPS es `desactualizado` y las coordenadas se omiten. Ubicaciones antiguas no se presentan como actuales. Las coordenadas del recolector son independientes de las coordenadas fijas del punto.

## Consulta de trazabilidad QR

- `POST /api/donacion/qr` — administrador, donante autenticado o recolector autenticado.
- `GET /api/donacion/:id` — usa la misma respuesta y las mismas reglas de autorización que la consulta QR.
- Cuerpo: `{ "codigo": "DONATY:DONACION_ID" }`.
- Un donante solo consulta sus propias donaciones; un recolector solo las que tiene asignadas; el administrador puede consultar cualquiera. El acceso no autorizado responde `403`.
- Respuesta `200`: `donacion`, `entregaGeneralCampana`, `puntoRecoleccion`, `recolectoresAsignadosAlPunto`, `responsableVigente`, `ubicacionResponsable`, `historialEstados`, `historialRecolectores` y `evidenciasPorEtapa`. Cada fotografía de `evidenciasPorEtapa` incluye la etapa, URL pública, fecha y recolector que la registró. Los IDs se conservan en campos separados; no se usan como sustituto de nombres faltantes. Se incluye un ID de evidencia solo si ese registro ya tiene uno.
- El QR existente usa `DONATY:` seguido del `_id` original; el detalle devuelve ese identificador y no crea códigos nuevos.
- `GET /api/donacion/mis` filtra por el ID del donante autenticado y agrega evidencias, historiales y `entregaGeneralCampana` a cada donación propia. Antes de registrar la entrega general, devuelve `registrada: false`; cuando existe, devuelve receptor, fecha, responsables/cargos y evidencias persistentes. La evidencia general se incluye solo si el registro de entrega vincula explícitamente esa donación; no se mezcla con las evidencias individuales.
- Las evidencias individuales tienen la misma forma plana en `GET /api/donacion/mis`, `GET /api/donacion/:id`, `POST /api/donacion/qr` y la respuesta de `PATCH /api/donacion/:id/recolectar`: `etapa`, `imagenUrl`, `fecha` y `recolector`. `evidenciasPorEtapa` se mantiene como agrupación adicional en las respuestas que ya la ofrecen.
- `PATCH /api/donacion/:id/recolectar` guarda las imágenes subidas como evidencia `recepcion` en la misma donación cuyo ID está en la ruta y responde con `{ donacion, evidencias, evidenciasPorEtapa, duplicada }`. Acepta fotos en `evidencias`, `imagenes` o `imagen`; `etapa`, si se envía, debe ser `recepcion`. La URL guardada se devuelve como `imagenUrl` pública; la respuesta no expone el ID privado del proveedor de imágenes ni la clave idempotente.
- El historial del donante, el detalle/QR y la trazabilidad administrativa presentan la entrega individual en `entregas`; además exponen `entrega` como alias del registro más reciente cuando existe. `recibeNombre` se compone de los nombres y apellidos ya guardados. `recibeIdentificacion` y `recibeInstitucion` son opcionales, se guardan en la entrega individual si se envían a `PATCH /api/donacion/:id/entregar` y responden `null` si no fueron registrados. `fechaEntrega` es un alias de `fecha`. Los datos de `entregaGeneralCampana` se mantienen separados y no completan campos de una entrega individual.
- `PATCH /api/donacion/:id/entregar` conserva el contrato existente para nombres (`nombresReceptor`, `apellidosReceptor`), teléfono, cargo, descripción, foto e idempotencia; también acepta opcionalmente `recibeIdentificacion` (máximo 40 caracteres) y `recibeInstitucion` (máximo 180). El servidor persiste estos campos en el registro individual de `Donacion.entregas`.
- Ejemplo anonimizado de los campos añadidos para una entrega individual:

```json
{
  "recibeNombre": "Nombre Ficticio",
  "recibeIdentificacion": "ID-FICTICIO",
  "recibeInstitucion": "Institución ficticia",
  "fecha": "2026-11-23T12:00:00.000Z",
  "fechaEntrega": "2026-11-23T12:00:00.000Z",
  "imagenUrl": "https://api.example.test/uploads/entrega.jpg"
}
```
- Los historiales de estado conservan `estado` técnico e incluyen `estadoLabel`, fecha, observación y responsable con rol/nombre cuando está disponible. Las reasignaciones conservan los datos registrados y añaden `changedAt`, `previousCollector`, `newCollector` y `changedBy`; `fullName` queda `null` si no existe un nombre persistido.
- Ejemplo anonimizado de evidencia individual en `GET /api/donacion/mis`:

```json
{
  "etapa": "recepcion",
  "imagenUrl": "https://api.example.test/uploads/evidencia.jpg",
  "fecha": "2026-11-23T12:00:00.000Z",
  "recolector": {
    "id": "recolector-ejemplo",
    "nombre": "Nombre",
    "apellido": "de ejemplo"
  }
}
```

- Ejemplo anonimizado de evidencia de entrega general, en `entregaGeneralCampana.evidencias`:

```json
{
  "etapa": "entrega",
  "imagenUrl": "https://api.example.test/uploads/entrega.jpg",
  "fecha": "2026-11-23T12:30:00.000Z",
  "recolector": {
    "id": "recolector-ejemplo",
    "nombre": "Nombre",
    "apellido": "de ejemplo"
  }
}
```

- `GET /api/admin/historial/donaciones/:donacionId/trazabilidad` — solo administrador; devuelve la tarjeta de la donación, evidencias, datos de entrega y los historiales de estado y reasignación. En la evidencia individual, `id` aparece solo si existe; los registros de evidencia de los modelos actuales no generan IDs artificiales.
- `puntoRecoleccion` incluye identificador, nombre, edificio, piso, aula, dirección y referencias existentes en el punto.
- Los historiales se devuelven cronológicamente. El historial de estados comienza con las transiciones registradas desde esta versión; los registros históricos no se reconstruyen ni se inventan.
- `ubicacionResponsable` informa `estado`, `coordenadas` y `actualizadoEn`. Coordenadas se devuelven solo cuando la ubicación corresponde a la campaña y punto de la donación y tiene menos de 5 minutos.

## Evidencias fotográficas

- `PATCH /api/donacion/:id/recolectar` — solo recolector asignado. `multipart/form-data` con una o varias fotos en `imagen`, `imagenes` o `evidencias`, `etapa=recepcion` (opcional por compatibilidad) y `Idempotency-Key` o `idempotencyKey`. La transición a `recolectada` se guarda junto con todas las evidencias; si alguna carga o persistencia falla, no cambia el estado.
- `POST /api/donacion/:id/evidencias` — solo recolector asignado. `multipart/form-data` con `etapa` (`recepcion`, `finalizacion` o `devolucion`) y de una a dos fotos en `imagen`, `imagenes` o `evidencias`.
- Clave obligatoria: `Idempotency-Key` (encabezado) o `idempotencyKey` (campo de formulario), máximo 128 caracteres.
- La etapa debe ser compatible con el estado actual: recepción (`pendiente_recoleccion` o `recolectada`), finalización (`entregada`) o devolución (`devolucion` o `devuelta`). La asignación y el estado se vuelven a comprobar al guardar.
- `PATCH /api/donacion/:id/devolucion` y `PATCH /api/donacion/:id/confirmar-devolucion` también aceptan `multipart/form-data` con `etapa=devolucion`, `idempotencyKey` y hasta dos imágenes en `evidencias`; cambian el estado y guardan las imágenes en la donación identificada por `:id`.
- Las imágenes JPG, PNG y WebP tienen un máximo de 5 MB y se almacenan en Cloudinary. El endpoint auxiliar no cambia el estado; cada transición conserva sus propios requisitos de evidencia.
- La clave idempotente se aplica a todas las fotos de una misma solicitud. Respuesta `201` contiene `evidencia` (grupos de fotos de la etapa), `evidencias` y `evidenciasPorEtapa`, agrupadas por responsable con su nombre una sola vez, y `duplicada: false`. Un reintento con la misma clave devuelve `200` con los mismos grupos y `duplicada: true`; no crea otros registros.

## Campañas visibles para recolectores

`GET /api/campanas` para recolectores excluye borradores, campañas desactivadas/finalizadas y campañas fuera de sus fechas de participación; solo devuelve puntos activos con asignación vigente del recolector. `POST /api/donacion/registrar-por-recolector` aplica el mismo control de disponibilidad. La consulta de administrador no cambia.

## Cantidad por categoría

Los administradores pueden definir `maxUnidadesPorDonacion` (entero positivo o `null`) al crear/editar una categoría. Si se envía, `metadata.cantidad` debe ser un entero positivo y no exceder ese máximo. La cantidad se guarda en `donacion.metadata.cantidad` y se devuelve con la donación. Categorías sin límite (`null`) no tienen un máximo configurado.

## Asignación automática al registrar una donación

`POST /api/donacion` requiere la campaña y los datos del bien; el donante no elige ni envía el punto ni el recolector. El servidor obtiene nombre y teléfono de `Donante`, elige un punto activo y un recolector habilitado asignado a ese punto y persiste `puntoRecoleccionRef`, `recolector`, `fechaAsignacion` y la entrada de `historialRecolectores`. No utiliza la ubicación GPS para elegir la asignación. `metodoEntrega` se guarda como `punto_recoleccion` y `direccionEntrega` se resuelve desde el punto. `referenciasEntrega` puede contener indicaciones adicionales del donante; si se omite, se usan las referencias del punto.

La selección minimiza primero la carga más alta entre el punto y el recolector candidato y luego su carga combinada. Los empates se resuelven aleatoriamente. Se excluyen `cancelada`, `entregada` y `devuelta` del conteo. La lectura de cargas, bloqueo de campaña y creación de la donación se ejecutan en una transacción MongoDB; se requiere una instancia compatible con transacciones (por ejemplo, Atlas o replica set). Si falta punto/recolector disponible, el endpoint devuelve `409` sin crear la donación.

El teléfono del donante se lee del perfil y se guarda como snapshot en `telefonoContacto`; si falta, responde `400` pidiendo completar el perfil. No se usa un teléfono del body. La ubicación opcional recibida se puede guardar aparte, pero nunca interviene en la selección de punto o recolector.

La respuesta conserva `{ "donacion": ... }` e incluye `asignacion` con el punto, recolector y fecha elegidos. La donación incluye además `recolector`, `puntoRecoleccionRef`, `fechaAsignacion`, `fechaRegistro`, `telefonoContacto`, `direccionEntrega` e `historialRecolectores`. `POST /api/donacion/registrar-por-recolector` usa la misma asignación dentro del punto elegido, guarda por separado `registradoPorRecolector` y el recolector finalmente asignado, y devuelve también `asignacion`.

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

`PATCH /api/donaciones-fisicas/:id/admin-asignar` permite asignar una donación pendiente y reasignar donaciones en `asignada`, `pendiente_recoleccion` o `recolectada`. Para donaciones vinculadas a campaña, el recolector destino debe estar asignado al mismo punto. La ruta registra recolector/punto anterior y nuevo, fecha y estado de la donación sin retroceder su estado. Así, una donación `recolectada` conserva al recolector registrado en `historialEstados` como responsable de la recolección y queda asignada al nuevo responsable de la clasificación. Los conteos de carga se derivan de las donaciones no finalizadas, por lo que reasignar actualiza las cargas sin contadores duplicados.

## Entrega general consolidada por campaña

- `POST /api/campanas/:campanaId/entrega` — requiere autenticación como recolector principal habilitado de un punto de esa campaña. Acepta JSON:

```json
{
  "recibeNombre": "Ana Ejemplo",
  "recibeIdentificacion": "1234567890",
  "recibeInstitucion": "Centro de acogida",
  "fecha": "2026-11-11",
  "observacion": "Entrega de los bienes recolectados"
}
```

- El servidor verifica que la campaña haya finalizado, que tenga donaciones y que todas estén en `en_entrega`. Un usuario de apoyo, transición inválida o entrega duplicada recibe un error claro. No se requiere una configuración de responsables de campaña. El registro único por campaña y los cambios de estado se guardan en la misma transacción; cada donación se actualiza por ID.
- El documento `EntregaCampana` conserva el principal que registró la entrega, datos del receptor, fecha y observación. `GET /api/campanas/:campanaId/entrega` acepta al principal que la registró o a un administrador y responde `{ entrega, campana, tablas }`. Un donante autenticado también puede consultar el registro si el arreglo de donaciones de la entrega contiene una donación que le pertenece y está asociada a esa campaña; su respuesta es `{ entregaGeneral, campana }` y no expone tablas de inventario ni datos de otras donaciones. El JWT del donante es suficiente; no se requiere token adicional. Cada tabla completa para admin/recolector agrupa por clasificación ID e incluye una fila por donación; nombres repetidos nunca se fusionan.
- La respuesta para donantes incluye `entregaGeneral.recibeNombre`, `recibeIdentificacion`, `recibeInstitucion`, `fecha` y `fechaEntrega` con los datos persistidos. `recibeNombre` usa nombres y apellidos si están registrados, o el receptor persistido como alternativa. `GET /api/donacion/mis` y `GET /api/donacion/:id` incluyen `campana` con su `_id`, que es el ID aceptado por esta ruta.
- La misma transacción cambia a `entregada` cada donación de la campaña, identificada por su ID, y guarda la entrega. Si no puede actualizar todas o guardar el registro, la transacción falla y no se devuelve éxito. Una segunda entrega responde `409`.
- `PATCH /api/donacion/:id/entregar` no permite entrega individual si la campaña ya finalizó y todas sus donaciones están en `en_entrega`; en ese caso se debe usar la entrega general.
- `GET /api/campanas/admin/lista` añade `entregaRegistrada` y `entregaGeneralId` a cada campaña.
- `GET /api/campanas/:id/donaciones` — administrador o recolector. El administrador recibe todas las donaciones y `entregaGeneral` completa. El recolector recibe solo las donaciones de los puntos activos en los que está asignado, sin la entrega general ni los IDs de asignación de otros puntos. `clasificacionPorPunto` agrupa categorías y cantidades totales, conservando el detalle por donación, donante, producto, nombre del bien y cantidad. Un recolector sin punto activo asignado recibe `403`; el punto autorizado se resuelve desde la campaña y la identidad autenticada.
- Los productos sin `metadata.cantidad` se incluyen en su grupo y se cuentan en `donacionesSinCantidad`; no se inventa una cantidad. `cantidad` suma solo cantidades válidas declaradas.

## Respuestas de error

Las rutas devuelven `{ "msg": "..." }` para errores. Se usan `400` para datos inválidos, `401` para falta de autenticación, `403` para permisos o asignación no autorizada, `404` para recursos inexistentes, `409` para capacidad/estado/conflictos de concurrencia y `500` para errores internos.
