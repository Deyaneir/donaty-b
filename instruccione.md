# BACKEND: corregir 3 errores + pendientes (detallado)

**No hagas preguntas.** Detecta el stack, el ORM y las convenciones del repo y úsalos. Trabaja en orden. En cada punto: (a) obtén evidencia real, (b) corrige la causa, (c) demuestra con `curl`/logs. Nada de "debería funcionar".

## Entrega final obligatoria
1. Para cada error: causa encontrada (con el log/valor real que la prueba).
2. `git diff --stat`.
3. Migraciones aplicadas y comando de **reinicio** del servidor ejecutado.
4. Respuestas reales de `curl` (autenticado) de cada endpoint tocado.
5. Bloque **CONTRATO FINAL** (método, ruta, body, respuesta) para pasarlo a la sesión móvil.

Regla global: identificar todo por `id`; las descripciones de donaciones pueden repetirse.

---

## 1. Error: "el identificador del punto no es válido"
**Evidencia primero:** en el endpoint de clasificaciones, loguear `campanaId`, `puntoId` (tal como llegan), `userId` y el punto asignado al recolector en BD. Mostrar esos valores.

**Causas a descartar:** `puntoId` vacío, `"null"`/`"undefined"` como string, nombre del punto en vez del id, id de usuario en vez del de punto, formato distinto al esperado (ObjectId/UUID/entero), comparación entre tipos distintos (número vs string).

**Corrección:**
- Crear una función única `resolverPuntoId(user, queryPuntoId)`:
  1. Si el usuario es recolector → devolver **siempre** su punto asignado (ignorar lo que mande el cliente).
  2. Si es admin → usar `queryPuntoId` si viene, validado contra los puntos de esa campaña.
  3. Si no hay punto resolvible → error 400 con mensaje que diga qué falta: `"El recolector no tiene punto asignado"` o `"punto <valor recibido> no pertenece a la campaña <id>"`.
- `puntoId` pasa a ser **opcional** en `GET /campanas/{campanaId}/clasificaciones`.
- Validar que la campaña exista y que el recolector pertenezca a ella; mensajes claros por cada caso.
- Usar `resolverPuntoId` también al clasificar (`PATCH /donaciones/{id}/clasificar`) y al crear clasificaciones.

---

## 2. Error: no aparece el botón "Entregar donaciones" (`puedeEntregar`)
**Evidencia primero:** con una campaña real, calcular y loguear **cada condición por separado**:
- `esPrincipal`
- `finalizada`
- `todasEnEntrega` (total de donaciones, cuántas en entrega, y el estado literal de las que no)

**Corrección en una función `calcularPuedeEntregar(campana, user)`:**
- `esPrincipal`: comparar ids como **string** (`String(campana.recolectorPrincipalId) === String(user.id)`); revisar cómo se guarda el principal (campo en campaña o rol por punto) y usar el correcto.
- `finalizada`: verdadero si `estado` ∈ {finalizada, cerrada} **o** `fechaFin < ahora` (considerar zona horaria `America/Guayaquil`).
- `todasEnEntrega`: normalizar estados con una función (`trim`, minúsculas, sin tildes, `_`/espacios/guiones equivalentes) para que `EN_ENTREGA`, `en entrega` y `enEntrega` cuenten igual. Ignorar donaciones **rechazadas/canceladas/eliminadas**. Exigir al menos 1 donación válida.
- `yaEntregada`: false (si existe `Entrega` registrada, `puedeEntregar = false`).
- `puedeEntregar = esPrincipal && finalizada && todasEnEntrega && !yaEntregada`.
- Incluir `puedeEntregar` en **lista y detalle** de campañas. Mientras se depura agregar `debug: { esPrincipal, finalizada, todasEnEntrega, totalDonaciones, enEntrega, estadosNoEntrega }` (quitar o proteger por entorno al terminar).
- Probar con `curl` autenticado como el principal y mostrar el JSON.

**Endpoints de entrega (implementar si no existen):**
- `POST /campanas/{campanaId}/entrega` body `{ recibeNombre, recibeIdentificacion, recibeInstitucion, fecha, observacion }`. Validar principal + finalizada + todas en entrega (403/409 con mensaje claro). Crear `Entrega` (una por campaña) y pasar donaciones a `entregada`.
- `GET /campanas/{campanaId}/entrega` (principal y admin) →
```json
{
  "entrega": { "recibeNombre":"", "recibeIdentificacion":"", "recibeInstitucion":"", "fecha":"", "observacion":"", "entregadoPor":"" },
  "campana": { "id":"", "nombre":"" },
  "tablas": [ { "clasificacion":"Peluches", "filas":[{"producto":"Peluche de oso","cantidad":3}], "total":3 } ]
}
```
  Una fila por donación (aunque se repitan nombres). 404 si no hay entrega.

---

## 3. Error: la imagen se ve y luego dice "imagen no cargada"
**Evidencia primero:** mostrar la URL exacta guardada en BD y la que devuelve la API para una foto. Ejecutar `curl -I <url>` y mostrar código y `content-type`.

**Causas a descartar:** ruta relativa, `localhost`/`127.0.0.1`/`10.0.2.2`/IP vieja, `http` en vez de `https`, archivo no guardado en disco, carpeta no servida como estática, URL firmada vencida, endpoint de imagen que exige token.

**Corrección:**
- Helper `urlPublica(path)` que arma una **URL absoluta** con `PUBLIC_BASE_URL` (variable de entorno con el host real). Usarlo en todas las respuestas que incluyan imágenes.
- Servir la carpeta de subidas como estática (o CDN) y confirmar `curl -I` = 200 con `image/*`.
- En la subida: guardar el archivo primero y **solo si se escribió bien** guardar el registro en BD; devolver la URL final.
- Límites: máximo **2 fotos** por evidencia, validar tipo (jpeg/png/webp) y tamaño.
- Si las imágenes requieren auth, documentarlo en el CONTRATO FINAL (la app deberá mandar el header).

---

## 4. Pendientes (si no están hechos)
**Clasificación persistente**
- `Clasificacion { id, campanaId, puntoId, nombre }` única por campaña+punto+nombre (sin distinguir mayúsculas). `Donacion.clasificacionId`.
- `GET /campanas/{campanaId}/clasificaciones` → `[{ "id","nombre","total" }]` (total = suma de cantidades de ese punto).
- `PATCH /donaciones/{id}/clasificar` body `{clasificacionId}` o `{nombre}` (si el nombre ya existe en ese punto/campaña, **reutiliza**). Pasa la donación a `en entrega`. Nunca permite cambiar `cantidad`. Respuesta `{ donacion, clasificacion:{id,nombre,total} }`.

**Campaña cerrada:** si está finalizada **y** tiene `Entrega`, rechazar con **409** cualquier edición (campaña, categorías, campos, activar/desactivar, estados, clasificar, crear/eliminar donaciones). Exponer `cerrada: boolean` en la campaña. Lectura y PDF siguen permitidos.

**Botón entregado individual:** bloquear en backend la acción individual "entregada" cuando la campaña finalizó con todo en `en entrega`; la entrega solo por `POST entrega`.

**Notificaciones:** en el `data` del push y del registro: `tipo`, `donacionId`, `campanaId` (strings). `GET /donaciones/{id}` debe devolver la donación completa validando permisos (dueño, recolector del punto, admin).