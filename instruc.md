# BACKEND — CONSULTA DE CAMPAÑAS, DONACIONES E HISTORIAL POR RECOLECTOR

## 1. OBJETIVO

Implementar o corregir la lógica del backend para permitir que el administrador consulte las campañas asignadas a un recolector y sus donaciones, y que el recolector consulte únicamente sus propias campañas y donaciones.

Proyecto: `donaty-b`.

Tecnologías actuales: Node.js, Express, MongoDB y Mongoose. Mantener la arquitectura, convenciones y estructura existentes.

**REGLA FUNDAMENTAL:** Antes de programar, inspeccionar los modelos, controladores, servicios, rutas, middleware y relaciones existentes. No inventar campos, endpoints ni relaciones. No modificar funcionalidades ajenas al requerimiento.

## 2. ADMINISTRADOR: CONSULTA POR RECOLECTOR

El backend debe permitir:

1. Buscar recolectores por nombre.
2. Obtener las campañas asignadas al recolector seleccionado.
3. Filtrar las campañas por período académico.
4. Obtener las donaciones relacionadas con el recolector y la campaña seleccionada.
5. Obtener el detalle completo de una donación.

### 2.1 Búsqueda de recolectores

Revisar si ya existe un endpoint para consultar recolectores.

Si existe, comprobar que permita localizar por nombre y que devuelva los datos necesarios para identificarlos.

Si no existe una funcionalidad equivalente, implementar una consulta compatible con las convenciones actuales.

No devolver contraseñas, tokens ni información sensible.

### 2.2 Campañas asignadas

Crear o adaptar la consulta que permita obtener exclusivamente las campañas asignadas al recolector indicado.

Cada resultado debe incluir los campos reales disponibles y necesarios para la tabla:

- Identificador de campaña.
- Nombre.
- Período académico.
- Fecha de inicio.
- Fecha de finalización.

El filtro por período académico debe utilizar los valores almacenados en la base de datos.

Debe permitir:
- Consultar todos los períodos.
- Consultar un período específico.
- Mantener la búsqueda y el filtro como criterios independientes.

No devolver campañas simplemente porque estén activas. Debe comprobarse la relación real de asignación del recolector.

### 2.3 Historial de donaciones por recolector y campaña

Implementar o adaptar una consulta que reciba el identificador del recolector y el identificador de la campaña.

Debe devolver únicamente las donaciones que realmente correspondan a ese recolector dentro de esa campaña.

La respuesta debe incluir los datos necesarios para la tabla:

- Código de donación.
- Donante.
- Tipo de donación.
- Fecha.
- Estado.
- Identificador de donación.

No devolver todas las donaciones de la campaña sin comprobar la relación con el recolector.

Importante: revisar cómo se registra actualmente al recolector responsable, las asignaciones y los cambios de responsable. No asumir que el creador de la donación es necesariamente el recolector que la gestionó.

## 3. RECOLECTOR: SUS CAMPAÑAS ASIGNADAS

El recolector autenticado debe consultar únicamente sus campañas asignadas.

La identificación del recolector debe obtenerse del usuario autenticado mediante el mecanismo actual de JWT y autorización.

No confiar en un identificador de recolector enviado libremente por Flutter para determinar los permisos.

La consulta debe permitir:

- Obtener todas sus campañas asignadas.
- Buscar por nombre.
- Filtrar por período académico.
- Combinar ambos criterios.
- Limpiar los filtros sin perder la restricción de asignación.

El backend debe aplicar la restricción de asignación antes de devolver los resultados.

## 4. DONACIONES DEL RECOLECTOR

Cuando el recolector seleccione una campaña, el backend debe devolver exclusivamente las donaciones que le correspondan dentro de esa campaña.

No permitir consultar donaciones de otros recolectores mediante la manipulación de identificadores.

Validar en el servidor:

- Identidad del recolector autenticado.
- Existencia de la campaña.
- Asignación del recolector a la campaña.
- Relación de la donación con la campaña.
- Relación real de la donación con el recolector.

Si no existe una relación suficiente para determinar qué donaciones corresponden a cada recolector, identificar el problema y explicar qué cambio de modelo o registro sería necesario. No inventar una relación.

## 5. DETALLE COMPLETO DE DONACIÓN

Revisar el endpoint actual de detalle de donaciones y reutilizarlo si es compatible.

Debe devolver toda la información real disponible:

- Información general.
- Campaña.
- Donante.
- Recolector responsable.
- Fecha de registro.
- Estado actual.
- Productos y cantidades.
- Condiciones o características de productos.
- Evidencias e imágenes almacenadas.
- Ubicación, cuando corresponda.
- Historial de estados.
- Fechas y responsables de los movimientos.

El acceso debe respetar los roles:

**Administrador:** puede consultar según sus permisos actuales.

**Recolector:** solo puede consultar donaciones que le correspondan según las asignaciones y relaciones reales.

No modificar permisos para facilitar la consulta.

## 6. HISTORIAL DEL RECOLECTOR

Revisar el endpoint actual del historial.

Debe devolver los registros reales correspondientes al recolector autenticado.

Evitar:
- Duplicar registros.
- Mezclar donaciones de otros recolectores.
- Perder registros históricos.
- Modificar innecesariamente la estructura de respuestas existente.

Conservar compatibilidad con el historial actual del administrador.

## 7. VALIDACIÓN DEL ÁREA AUTORIZADA

Actualmente, al recolector le aparece «Fuera del área autorizada» y esto termina impidiendo que pueda continuar con las consultas.

Revisar dónde se realiza esta validación en el backend.

Se solicita un modo temporal de pruebas que permita continuar consultando campañas, donaciones, detalles e historial aunque el recolector esté fuera del área.

Condiciones:

1. Identificar la validación geográfica actual.
2. Mantener el cálculo real de dentro/fuera del área.
3. No eliminar la lógica geográfica.
4. No modificar el sistema GPS ni el seguimiento de ubicación.
5. No modificar las asignaciones.
6. No eliminar controles de autenticación ni permisos.
7. Desactivar únicamente el bloqueo que impide las consultas durante las pruebas.
8. Utilizar una configuración claramente identificada y reversible.
9. Documentar cómo reactivar la restricción para producción.

No convertir el modo de pruebas en una autorización general para acceder a información de otros usuarios.

Si el bloqueo ocurre exclusivamente en Flutter, informar que el cambio corresponde al frontend y no alterar innecesariamente el backend.

## 8. CONTRATOS API

Antes de crear endpoints, revisar todas las rutas existentes.

Reutilizar los endpoints compatibles.

Si falta alguno, implementarlo siguiendo:
- Prefijo `/api`.
- Estructura de rutas actual.
- Middleware JWT.
- Roles existentes: administrador, donante y recolector.
- Formato de respuestas utilizado por el proyecto.
- Manejo de errores existente.

Documentar para cada endpoint:

- Método HTTP.
- Ruta.
- Parámetros.
- Query parameters.
- Datos de respuesta.
- Roles autorizados.
- Validaciones.
- Códigos de error.

No cambiar rutas existentes sin justificarlo y mantener compatibilidad.

## 9. RESTRICCIONES

- No modificar Flutter.
- No crear datos simulados.
- No inventar campos ni relaciones.
- No duplicar endpoints.
- No modificar autenticación.
- No alterar roles.
- No realizar refactorizaciones generales.
- No cambiar modelos sin comprobar primero el impacto.
- No modificar módulos ajenos al requerimiento.
- No eliminar información histórica.
- No declarar implementado algo que no haya sido probado.

## 10. PRUEBAS

Comprobar:

1. El administrador puede buscar recolectores.
2. El administrador obtiene las campañas del recolector seleccionado.
3. El filtro por período funciona.
4. La búsqueda y el filtro funcionan conjuntamente.
5. El administrador obtiene las donaciones del recolector dentro de una campaña.
6. El recolector obtiene únicamente sus campañas.
7. El recolector puede filtrar sus campañas por período.
8. El recolector obtiene únicamente sus donaciones correspondientes.
9. No puede consultar registros de otros recolectores manipulando identificadores.
10. El detalle devuelve los datos completos.
11. El historial no duplica ni mezcla registros.
12. El modo de pruebas permite consultar sin eliminar la validación geográfica.
13. La restricción puede reactivarse.
14. Los permisos existentes siguen funcionando.

## 11. INFORME FINAL

Entregar:

- Archivos modificados.
- Archivos creados.
- Modelos y relaciones revisados.
- Endpoints reutilizados.
- Endpoints nuevos, si fueron necesarios.
- Contrato completo de cada endpoint nuevo o modificado.
- Validaciones de permisos.
- Funcionamiento de búsqueda y filtro.
- Funcionamiento de consultas por recolector.
- Cambios relacionados con el área autorizada.
- Pruebas ejecutadas y resultados.
- Problemas pendientes.

Si alguna funcionalidad no puede implementarse por falta de datos o relaciones, detener esa parte y explicar exactamente qué falta. No inventar soluciones.

**No realices cambios fuera de estos requerimientos y no aumentes nada de md o txt.**