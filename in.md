# CORRECCIÓN ESTRICTA DEL BACKEND – ASIGNACIÓN DE RECOLECTORES E HISTORIAL DE ADMINISTRADOR

Necesito corregir errores funcionales del módulo de administrador de Donaty-EC. Antes de modificar código, inspecciona los modelos, controladores, servicios, validaciones y rutas existentes relacionados con campañas, puntos de recolección, asignaciones de recolectores e historial.

**No inventes rutas, propiedades, modelos ni relaciones.** Utiliza la estructura y los contratos reales del proyecto.

## 1. CORREGIR LA ASIGNACIÓN DE RECOLECTORES POR PUNTO

Actualmente, al crear una campaña, puedo indicar que un punto de recolección necesita 2 recolectores y seleccionar uno como principal. Sin embargo, al guardar o enviar la información, el backend responde que faltan 2 recolectores.

Esto es incorrecto.

La lógica obligatoria es:

- Cada punto tiene una cantidad requerida de recolectores.
- El recolector principal forma parte de esa cantidad.
- Los recolectores secundarios completan los cupos restantes.
- Si un punto necesita 2 recolectores y ya tiene 1 principal, solamente falta 1 secundario.
- Si necesita 3 y ya tiene 1 principal, faltan 2 secundarios.
- Nunca cuentes al principal como si no estuviera asignado.
- No permitas duplicar al mismo recolector dentro del mismo punto.
- Valida la cantidad de recolectores por punto, no globalmente por campaña.
- Conserva la distinción entre principal y secundario.

Ejemplo obligatorio:

Punto A:
- Recolectores requeridos: 2.
- Principal: Recolector 1.
- Secundario: Recolector 2.
- Resultado: asignación válida.

No debe aparecer el mensaje de que faltan 2 recolectores.

Si la campaña tiene varios puntos, cada punto debe validar sus propios cupos de manera independiente.

## 2. HORARIO DE CAMPAÑA Y PUNTOS DE RECOLECCIÓN

Actualmente se está manejando un horario en la campaña y aparentemente otro en cada punto.

Quiero evitar esa duplicación.

La regla es:

- El horario se configura en la campaña.
- Los puntos de recolección utilizan el horario definido en esa campaña.
- No se debe exigir que el administrador vuelva a registrar el mismo horario para cada punto.
- Al consultar los puntos, el backend debe proporcionar el horario correspondiente a la campaña.
- Si existen datos antiguos con horarios propios en los puntos, revisa cómo compatibilizarlos sin romper campañas anteriores.

No elimines información existente sin comprobar primero sus dependencias.

## 3. HISTORIAL DE ASIGNACIONES: DATOS QUE DEBE ENTREGAR EL BACKEND

El historial de asignaciones de recolectores debe estar disponible para la sección Gestión > Historial del administrador.

La primera tabla debe permitir mostrar exactamente estas columnas:

| Nombre del recolector | Campaña | Fecha y hora de asignación | Acción |
|---|---|---|---|
| Nombre real | Nombre real | Fecha y hora real | Ver detalles |

La fecha y hora deben corresponder al momento en que se realizó la asignación a esa campaña, no a la fecha de creación de la campaña ni a la fecha actual.

Comprueba si actualmente se guarda ese dato. Si no existe, implementa el registro correcto de la fecha de asignación, conservando los registros históricos existentes.

No uses una fecha inventada ni reemplaces la fecha original cuando se actualice otra información de la asignación.

## 4. DETALLE DEL HISTORIAL DE UNA ASIGNACIÓN

Cuando el administrador consulta los detalles de una asignación, el backend debe proporcionar las donaciones correspondientes a la campaña y al recolector seleccionado.

La tabla debe permitir mostrar:

| Nombre del donante | Categoría | Nombre de la donación | Fecha de la donación | Acción |
|---|---|---|---|---|
| Donante real | Categoría real | Donación real | Fecha real | Ver donación |

La información debe obtenerse de los registros reales de donaciones.

Implementa o adapta los filtros necesarios:

- Búsqueda por texto.
- Filtro por categoría.
- Filtro por fecha de donación.

Los filtros deben poder combinarse. Por ejemplo, buscar una categoría dentro de un rango de fechas y, además, filtrar por nombre.

La consulta debe respetar la campaña y el recolector de la asignación seleccionada. No debe mostrar donaciones de otros recolectores, otras campañas ni registros ajenos.

La acción de consultar una donación debe permitir recuperar el detalle completo mediante el mecanismo existente del proyecto.

## 5. PERMISOS Y CONSISTENCIA

- Solo el administrador puede consultar el historial administrativo completo.
- No mezcles asignaciones de diferentes campañas.
- No mezcles las asignaciones de diferentes puntos.
- Si el recolector participa como principal o secundario, conserva ese dato en la relación.
- No dupliques donaciones al consultar el historial.
- Respeta los estados y relaciones actuales.
- Mantén la trazabilidad de las asignaciones.

## 6. PRUEBAS OBLIGATORIAS

Agrega o adapta pruebas para verificar:

1. Dos recolectores requeridos y uno principal: falta solamente uno.
2. Dos recolectores requeridos y principal más secundario: asignación válida.
3. Tres recolectores requeridos y uno principal: faltan dos.
4. No se permite asignar dos veces al mismo recolector en un punto.
5. Cada punto valida sus propios cupos.
6. Los puntos heredan el horario de la campaña.
7. La fecha de asignación se registra correctamente.
8. El historial devuelve el recolector, campaña y fecha/hora de asignación.
9. El detalle devuelve únicamente las donaciones correspondientes a esa asignación.
10. La búsqueda y los filtros de categoría y fecha funcionan individualmente y combinados.
11. La consulta de detalle de donación devuelve la información correcta.
12. Los permisos del administrador se respetan.

## 7. RESTRICCIONES

- No modifiques funcionalidades ajenas a esta solicitud.
- No cambies nombres de campos o rutas sin comprobar sus dependencias.
- No generes datos ficticios para completar respuestas.
- No elimines funcionalidades existentes.
- No alteres el flujo de donaciones ni la lógica de ubicación.
- No cambies la arquitectura del proyecto.
- No declares resuelto algo que solamente hayas preparado parcialmente.

## 8. INFORME FINAL

Al terminar, informa:

1. Archivos modificados.
2. Problema exacto que causaba el conteo incorrecto de recolectores.
3. Cómo quedó la validación del principal y secundarios.
4. Cómo se maneja ahora el horario de campaña y puntos.
5. Rutas existentes modificadas o nuevas, indicando método y contrato real.
6. Cómo se registra la fecha y hora de asignación.
7. Cómo funcionan la búsqueda y los filtros del historial.
8. Pruebas ejecutadas y resultados reales.
9. Pendientes o limitaciones.

Primero inspecciona y comprende las relaciones actuales. Después implementa las correcciones. No te limites a explicar qué habría que hacer: realiza los cambios.