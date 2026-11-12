# DONATY-EC — CORRECCIÓN INTEGRAL DE LÓGICA Y CONTRATOS DEL BACKEND

Trabaja exclusivamente en el backend existente de Donaty-EC:

`/Users/dam/Downloads/donaty-b`

Stack actual: Node.js, Express, ES Modules y MongoDB/Mongoose.

Necesito corregir la lógica real del sistema. No hagas cambios cosméticos ni agregues rutas sin revisar primero las existentes.

## REGLAS OBLIGATORIAS

Antes de programar:

1. Inspecciona los modelos, controladores, servicios, rutas, middlewares y pruebas actuales.
2. Identifica cómo se relacionan campañas, puntos de recolección, recolectores, donaciones, evidencias, clasificación, entregas y trazabilidad.
3. Identifica los estados reales y las transiciones actuales.
4. Revisa las rutas existentes y sus permisos.
5. Reutiliza los modelos y contratos actuales cuando sean adecuados.
6. No inventes campos, estados, relaciones ni datos.
7. Si falta una entidad necesaria, implementa una solución consistente con el modelo existente y documenta el cambio.
8. No elimines funcionalidades válidas para resolver los problemas descritos.

No modifiques Flutter en esta tarea.

---

## 1. ASIGNACIÓN DE RECOLECTORES POR PUNTO

La lógica correcta es:

**Cada punto de recolección de una campaña debe tener exactamente un recolector principal.**

La asignación de principal no es global para toda la campaña.

Una campaña puede tener varios puntos y cada punto puede tener un recolector principal diferente.

También puede tener recolectores secundarios según las asignaciones permitidas por el sistema.

Ejemplo conceptual:

Campaña A
- Punto 1: Recolector A — principal; Recolector B — secundario.
- Punto 2: Recolector C — principal; Recolector D — secundario.
- Punto 3: Recolector E — principal.

Reglas:

- No debe existir más de un principal activo para el mismo punto.
- Un recolector puede ser principal en un punto y secundario en otro.
- El rol debe determinarse por la asignación al punto, no por una propiedad global del recolector ni por la campaña completa.
- Las donaciones deben relacionarse correctamente con el punto de recolección que les corresponde.
- Las operaciones de recolección y entrega deben validar la asignación correspondiente a ese punto.

Revisa también el flujo de creación y edición de campañas para garantizar que el principal se seleccione por cada punto.

---

## 2. RECOLECCIÓN Y EVIDENCIAS FOTOGRÁFICAS

Cuando el recolector ejecuta la operación de marcar una donación como `recolectada`, el sistema debe exigir las evidencias fotográficas correspondientes.

El flujo debe ser:

1. El recolector selecciona la acción de recolectar.
2. Se solicita la evidencia fotográfica.
3. La evidencia es obligatoria.
4. Si no se adjunta la evidencia requerida, no se permite completar la operación.
5. Las fotografías deben guardarse de manera persistente.
6. La donación solo cambia al estado correspondiente cuando la operación se completa correctamente.
7. Las evidencias deben quedar asociadas a la donación y disponibles para su trazabilidad.

No aceptes únicamente rutas temporales del dispositivo.

Revisa el mecanismo actual de almacenamiento y utiliza el sistema persistente existente.

No confundas las fotografías de recolección con las evidencias finales de entrega.

---

## 3. CLASIFICACIÓN DE DONACIONES

Cuando el recolector selecciona la acción `Clasificada`, debe abrirse el flujo de clasificación de la donación.

La clasificación debe permitir registrar productos:

- Nombre del producto.
- Los demás campos que ya estén definidos en el sistema y sean necesarios.
- Agregar más productos mediante una acción equivalente a `Agregar producto`.

No conviertas la clasificación en una descripción de texto libre que no permita identificar los productos.

La clasificación debe persistirse y quedar asociada a la campaña y al conjunto de donaciones correspondiente.

No inventes cantidades ni datos de inventario. Si la cantidad es necesaria para el modelo, verifica cómo debe definirse y validarse.

La clasificación debe poder consultarse posteriormente y no depender de datos temporales de Flutter.

---

## 4. ESTADOS Y ENTREGA GENERAL DE CAMPAÑA

La lógica funcional debe ser:

- Los recolectores principales y secundarios pueden participar en la recolección y clasificación de las donaciones que tienen asignadas.
- Después de clasificar, las donaciones permanecen en el flujo de clasificación.
- La acción de entrega general no debe aparecer como una acción individual para cada recolector secundario.
- Cuando la campaña haya terminado y se cumplan las condiciones de entrega, el recolector principal correspondiente al punto debe poder realizar el registro de entrega general.
- Los recolectores secundarios permanecen en el estado de clasificación; no deben aparecer como responsables de la entrega general.
- El principal debe poder consultar las donaciones y la clasificación que corresponden al alcance de su entrega.

**No conviertas automáticamente todas las donaciones a `en_entrega` solo porque una persona presione un botón.**

Define y valida la transición real con base en los estados existentes y la finalización de la campaña.

La condición de entrega debe considerar la campaña y el punto correspondientes. No mezcles puntos que tienen distintos recolectores principales.

La autorización debe validarse en el backend. No confíes únicamente en que Flutter oculte el botón.

---

## 5. REGISTRO DE ENTREGA GENERAL

El registro de entrega general debe ser obligatorio cuando corresponda.

Revisa el contrato existente y define claramente:

- Qué donaciones forman parte del registro.
- Qué punto de recolección corresponde.
- Qué recolector principal está autorizado.
- Qué datos del receptor son obligatorios.
- Qué fecha se registra.
- Qué evidencias finales son obligatorias.
- Qué estado se asigna después de completar la entrega.

No permitas registros incompletos.

No permitas que un recolector secundario realice la entrega general del punto.

No permitas registrar la misma entrega dos veces si el contrato actual exige unicidad.

Conserva las rutas existentes que estén en uso y evita crear rutas duplicadas sin necesidad.

---

## 6. PDF DE CLASIFICACIÓN Y VISIBILIDAD POR ROL

La tabla de clasificación debe generar un PDF persistente o recuperable.

El PDF debe representar la clasificación real registrada. No debe generarse a partir de una lista ficticia o datos temporales.

Visibilidad:

### Administrador
Puede consultar el PDF de clasificación y la información de entrega conforme a sus permisos.

### Recolectores
Los recolectores correspondientes pueden consultar el PDF de clasificación de sus campañas y puntos asignados.

### Donante
El donante no debe visualizar el PDF interno de clasificación.

Al donante se le deben mostrar los datos del registro de entrega que le corresponden, junto con las evidencias fotográficas finales.

No expongas al donante información interna de otros donantes, recolectores o puntos.

La autorización debe verificarse en el backend para cada descarga o consulta del documento.

---

## 7. DETALLE DE DONACIÓN Y TRAZABILIDAD

El detalle de donación debe diferenciarse de la trazabilidad.

### Detalle de donación
Debe mostrar:

- Los datos que el donante registró al crear la donación.
- El código QR correspondiente.

No debe incluir:

- Mapa.
- Ubicación del recolector.
- Coordenadas GPS del recolector.
- Datos de ubicación que pertenecen al seguimiento operativo.

No agregues información que el donante no registró en el formulario original, salvo el código QR solicitado.

### Trazabilidad
Debe contener el historial de estados y eventos correspondientes a la donación.

El código QR debe estar disponible en esta sección según el flujo actual.

La ubicación del recolector debe reflejarse en el mapa de trazabilidad cuando corresponda, utilizando la ubicación real y más reciente persistida.

No uses una ubicación estática ni una ubicación de prueba como si fuera real.

---

## 8. UBICACIÓN DEL RECOLECTOR

Revisa el flujo actual de ubicación:

- Captura GPS.
- Persistencia.
- Relación con el recolector.
- Relación con la campaña, punto o donación.
- Consulta por administración y donante.
- Actualización del mapa.

Corrige la causa por la que el mapa no refleja correctamente la ubicación del recolector.

No cambies arbitrariamente la frecuencia de actualización.

No inventes coordenadas.

No confundas la ubicación del punto de recolección con la ubicación actual del recolector.

La respuesta de ubicación debe identificar correctamente al recolector y su contexto operativo, respetando los permisos.

No permitas que un donante consulte la ubicación de recolectores que no estén relacionados con su donación.

---

## 9. GESTIÓN ADMINISTRATIVA — HISTORIAL DE RECOLECTORES

En Gestión administrativa deben existir las secciones:

- Usuarios.
- Campañas.
- Historial.

La sección `Recolectores` no debe permanecer como una sección independiente si la funcionalidad que se necesita corresponde al historial.

Revisa el diseño y la navegación actual antes de modificar.

El historial administrativo debe permitir:

1. Buscar y visualizar el nombre del recolector.
2. Consultar las campañas asociadas a ese recolector.
3. Mostrar las campañas en una tabla.
4. Seleccionar una campaña.
5. Consultar las donaciones asignadas al recolector en esa campaña.
6. Mostrar si el recolector fue principal o secundario en el punto correspondiente.
7. Mostrar los datos reales de cada donación.
8. Consultar el detalle completo de la donación.
9. Consultar el PDF de clasificación según permisos.
10. Consultar el historial de asignaciones cuando corresponda.

La condición de principal/secundario debe obtenerse de la asignación al punto de recolección. No la deduzcas de la campaña completa.

Conserva búsqueda y filtros existentes, incluido el período académico.

No elimines filtros para simplificar la consulta.

---

## 10. PRUEBAS OBLIGATORIAS

Agrega o adapta pruebas para:

- Un principal por punto.
- Distintos principales en distintos puntos de una campaña.
- Un recolector principal en un punto y secundario en otro.
- Permisos por punto.
- Evidencia obligatoria al recolectar.
- Persistencia de evidencias.
- Clasificación con uno o varios productos.
- Persistencia de clasificación.
- Restricción de entrega general al principal.
- Bloqueo de entrega general para secundarios.
- Entrega general por punto.
- Visibilidad del PDF por rol.
- Restricción del PDF para donantes.
- Detalle de donación sin mapa ni ubicación.
- Trazabilidad con QR.
- Consulta de ubicación real del recolector.
- Historial administrativo con principal/secundario.
- Búsqueda y filtros.

Ejecuta la suite completa y las verificaciones de sintaxis.

No afirmes que se probó con MongoDB real si no se ejecutó una prueba de integración real.

---

## 11. INFORME FINAL

Indica:

- Archivos modificados.
- Modelos y relaciones modificados.
- Rutas nuevas o ajustadas.
- Reglas de permisos aplicadas.
- Flujo de recolección y evidencias.
- Flujo de clasificación.
- Flujo de entrega general por punto.
- Acceso al PDF por rol.
- Corrección del detalle y trazabilidad.
- Corrección de ubicación.
- Corrección del historial administrativo.
- Pruebas ejecutadas y resultados.
- Pendientes reales.

No declares la tarea terminada si una de estas reglas todavía no está implementada.

No modifiques Flutter.
