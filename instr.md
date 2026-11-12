# CORRECCIÓN DEL HISTORIAL ADMINISTRATIVO – BACKEND DONATY-EC

Necesito corregir el módulo de historial del administrador. Actualmente presenta problemas de consultas, filtros, relaciones y recuperación de donaciones.

Antes de modificar, inspecciona los modelos, controladores, servicios y rutas actuales de:
- Campañas.
- Recolectores.
- Asignaciones.
- Puntos de recolección.
- Donaciones.
- Categorías.
- Historial administrativo.

No inventes propiedades, relaciones ni endpoints. Trabaja con la estructura real del proyecto.

## 1. HISTORIAL PRINCIPAL: BÚSQUEDA Y FILTRO

La consulta del historial debe permitir recuperar todas las asignaciones de recolectores.

Necesito que admita:

- Búsqueda por nombre del recolector.
- Filtro por período académico.

Ambos filtros deben poder combinarse.

IMPORTANTE: un mismo recolector puede haber sido asignado a una misma campaña o a campañas diferentes en distintas fechas. Cada asignación debe aparecer como un registro independiente.

NO agrupes ni elimines registros solamente porque tengan el mismo recolector.

Ejemplo:

| Recolector | Campaña | Fecha de asignación |
|---|---|---|
| Recolector A | Campaña 1 | 10/09/2026 09:00 |
| Recolector A | Campaña 2 | 15/09/2026 14:30 |
| Recolector A | Campaña 1 | 20/09/2026 11:00 |

Los tres registros deben aparecer si representan asignaciones diferentes.

La fecha y hora deben proceder del registro real de cada asignación.

## 2. DETALLE DE CADA ASIGNACIÓN

Al seleccionar una asignación, el backend debe recuperar las donaciones relacionadas con ESA asignación.

Actualmente la pantalla únicamente muestra información básica del recolector, como su cargo, pero no aparecen las donaciones.

Esto debe corregirse.

La consulta debe utilizar las relaciones reales entre:

- Identificador de la asignación.
- Recolector.
- Campaña.
- Punto de recolección.
- Donaciones correspondientes.

No basta con consultar las donaciones de una campaña completa si eso provoca que aparezcan donaciones de otros recolectores.

Tampoco basta con consultar una sola donación.

Debe devolver TODAS las donaciones que correspondan a la asignación seleccionada, sin limitarse a un único resultado.

Comprueba especialmente:

- Si el filtro está utilizando el identificador correcto del recolector.
- Si está utilizando el identificador correcto del punto.
- Si está confundiendo el identificador de campaña con el de asignación.
- Si existe una condición que limita los resultados a una sola donación.
- Si una relación o población está descartando registros.
- Si las donaciones se están asociando correctamente al recolector principal y a los secundarios según la lógica real de asignación.

No incluyas donaciones ajenas a la asignación.

## 3. CATEGORÍAS DINÁMICAS

Las categorías no deben estar escritas manualmente ni limitadas a una lista fija.

El administrador puede crear nuevas categorías y estas deben aparecer automáticamente en el historial.

Cuando se consulte el detalle de una asignación:

- El backend debe permitir obtener las categorías disponibles de la campaña correspondiente.
- Debe devolver las categorías reales que utiliza la campaña y sus donaciones.
- Si el administrador crea una categoría nueva, esta debe poder aparecer en el filtro sin modificar código.
- No uses categorías estáticas.
- No inventes categorías.
- No elimines categorías existentes.

El filtro debe poder consultar donaciones por cualquiera de las categorías disponibles.

Comprueba si la categoría está almacenada directamente en la donación, relacionada mediante un identificador o mediante otra estructura. Respeta el modelo real.

## 4. FILTRO POR FECHA DE DONACIÓN

El detalle de la asignación también debe permitir filtrar por fecha de donación.

La consulta debe admitir el criterio temporal que soporte el proyecto, por ejemplo un rango de fechas si el modelo y el contrato lo permiten.

Debe utilizar la fecha real de creación o registro de la donación, no la fecha de asignación del recolector.

La búsqueda, categoría y fecha deben poder combinarse.

Ejemplo:
- Recolector seleccionado: Recolector A.
- Categoría: Víveres.
- Fecha: rango seleccionado.

Resultado: todas las donaciones de esa asignación que cumplan simultáneamente los filtros.

## 5. RESPUESTA DEL DETALLE

El endpoint o servicio existente debe entregar la información necesaria para mostrar:

- Información básica del recolector.
- Campaña.
- Punto de recolección, cuando corresponda.
- Rol del recolector en ese punto: principal o secundario.
- Todas las donaciones asociadas.
- Nombre del donante.
- Categoría.
- Nombre de la donación.
- Fecha de la donación.
- Identificador necesario para abrir el detalle individual.

No devuelvas únicamente el perfil del recolector.

No devuelvas una única donación cuando existen varias.

## 6. PRUEBAS OBLIGATORIAS

Agrega pruebas para comprobar:

1. Un recolector con varias asignaciones en diferentes fechas aparece varias veces.
2. La búsqueda por nombre devuelve las asignaciones correspondientes.
3. El filtro por período académico funciona.
4. La búsqueda y el período académico funcionan juntos.
5. El detalle de una asignación devuelve todas sus donaciones.
6. No devuelve solamente la primera donación.
7. No mezcla donaciones de otros recolectores.
8. Respeta la relación del punto de recolección.
9. Las categorías se obtienen dinámicamente.
10. Una categoría nueva creada por el administrador aparece en el filtro.
11. El filtro de categoría funciona.
12. El filtro de fecha funciona.
13. Categoría y fecha funcionan combinadas.
14. El detalle individual de cada donación devuelve el registro correcto.
15. Se respetan los permisos administrativos.

## 7. RESTRICCIONES

- No cambies la lógica de creación de campañas.
- No alteres la asignación de recolectores que ya funciona.
- No cambies el flujo de donaciones.
- No inventes registros.
- No uses datos estáticos.
- No agrupes asignaciones de diferentes fechas.
- No elimines filtros.
- No cambies innecesariamente los modelos.
- No modifiques el frontend.

## 8. INFORME FINAL

Indica:

- Causa exacta por la que no aparecían las donaciones.
- Por qué solamente se devolvía una donación.
- Cómo identificas una asignación específica.
- Cómo recuperas todas sus donaciones.
- Cómo obtienes las categorías dinámicas.
- Rutas y parámetros reales.
- Archivos modificados.
- Pruebas ejecutadas y resultados.

No declares el problema resuelto si el detalle continúa devolviendo solamente información del recolector y ninguna donación.