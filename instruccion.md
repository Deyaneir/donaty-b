# BACKEND: clasificación persistente + entrega

**No hagas preguntas.** Detecta el stack y las convenciones del repo (rutas, ORM, migraciones) y úsalas. Implementa, **ejecuta** y demuestra que funciona. Los nombres de rutas pueden adaptarse al estilo del proyecto, pero **los JSON deben quedar exactos**.

## Prueba obligatoria al final (sin esto, la tarea no está hecha)
1. `git diff --stat` mostrado.
2. Migración aplicada y servidor **reiniciado**.
3. Probar cada endpoint con `curl` y mostrar la respuesta real.
4. Imprimir el bloque **CONTRATO FINAL** (método, ruta, body, respuesta) para pegarlo en la sesión móvil.

## Modelo
- `Clasificacion { id, campanaId, puntoId, nombre }` (único por campaña + punto + nombre, sin distinguir mayúsculas).
- `Donacion.clasificacionId` (nullable). **Todo por `id`; las descripciones pueden repetirse.**
- `Entrega { id, campanaId, recolectorId, recibeNombre, recibeIdentificacion, recibeInstitucion, fecha, observacion, createdAt }`, una por campaña.

## Endpoints

### 1. Listar clasificaciones
`GET /campanas/{campanaId}/clasificaciones?puntoId=`
```json
[{ "id": "c1", "nombre": "Peluches", "total": 5 }]
```
`total` = suma de `cantidad` de las donaciones con esa clasificación. Solo del punto indicado.

### 2. Clasificar donación
`PATCH /donaciones/{id}/clasificar` body: `{ "clasificacionId": "c1" }` **o** `{ "nombre": "Peluches" }`
- Si viene `nombre` y ya existe en ese punto/campaña → **reutiliza** (no duplica); si no, crea.
- Guarda `clasificacionId`, la donación pasa a `en entrega`.
- No acepta cambiar `cantidad`.
- Respuesta: `{ "donacion": {...}, "clasificacion": { "id","nombre","total" } }`

### 3. Estado de entrega de la campaña
Incluir en el detalle/lista de campañas el campo `puedeEntregar: boolean` = usuario es **recolector principal** Y campaña **finalizada** Y **todas** las donaciones en `en entrega`.

### 4. Registrar entrega
`POST /campanas/{campanaId}/entrega` body:
```json
{ "recibeNombre": "", "recibeIdentificacion": "", "recibeInstitucion": "", "fecha": "2026-11-11", "observacion": "" }
```
- Validar rol principal, campaña finalizada, todas en `en entrega`; si no, 403/409 con mensaje claro.
- Crear `Entrega`, pasar donaciones a `entregada`.

### 5. Obtener entrega + tablas
`GET /campanas/{campanaId}/entrega` (principal y admin)
```json
{
  "entrega": { "recibeNombre": "", "recibeIdentificacion": "", "recibeInstitucion": "", "fecha": "", "observacion": "", "entregadoPor": "" },
  "campana": { "id": "", "nombre": "" },
  "tablas": [
    { "clasificacion": "Peluches",
      "filas": [ { "producto": "Peluche de oso", "cantidad": 3 }, { "producto": "Peluche de oso", "cantidad": 2 } ],
      "total": 5 }
  ]
}
```
Una fila por donación (aunque se repitan nombres). 404 si aún no hay entrega.

### 6. Botón Entregado por donación
Bloquear en backend la acción individual "entregada" cuando la campaña ya está finalizada con todo en `en entrega` (la entrega se hace solo por el punto 4).

## Reglas
- Autorización en backend siempre, no confiar en la app.
- Mensajes de error claros.