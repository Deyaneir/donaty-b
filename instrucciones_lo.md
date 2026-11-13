# DONATY-EC — IMPLEMENTACIÓN DEL HISTORIAL DE ADMINISTRADOR (BACKEND)

## OBJETIVO

Ampliar el apartado HISTORIAL del administrador para permitir consultar los registros históricos de RECOLECTORES y DONANTES, sus campañas asociadas y las donaciones relacionadas.

IMPORTANTE: Antes de modificar, inspecciona únicamente los modelos, controladores, rutas y servicios relacionados con:
- Usuarios.
- Campañas.
- Donaciones.
- Asignaciones de recolectores.
- Historial de estados.
- Historial de participación.

No analices ni modifiques módulos ajenos a esta funcionalidad.

## 1. HISTORIAL DE RECOLECTORES

Implementar un endpoint paginado para listar los recolectores.

Cada registro debe proporcionar, cuando exista:
- ID del recolector.
- Nombres y apellidos.
- Correo electrónico.
- Facultad, carrera o asociación.
- Estado de la cuenta.
- Número de campañas en las que ha participado.
- Número de donaciones asignadas.
- Número de donaciones recolectadas.
- Número de donaciones gestionadas.
- Fecha de última actividad.

Los conteos deben calcularse con datos reales, sin confundir asignaciones con recolecciones efectivas.

### Detalle del recolector

Implementar una consulta que permita obtener:

**Información personal**
- Datos del recolector.
- Estado de la cuenta.

**Campañas asociadas**
- ID y nombre de campaña.
- Período académico.
- Fecha de inicio y finalización.
- Fecha de asignación del recolector.
- Rol desempeñado: principal o secundario.
- Estado de participación.
- Fecha de desvinculación, si existe.

**Donaciones gestionadas**
- Código de donación.
- Donante relacionado.
- Campaña.
- Fecha de asignación.
- Estado actual.
- Fecha de recolección, si existe.
- Fecha de entrega, si existe.

IMPORTANTE: Consultar también las asignaciones históricas. No mostrar únicamente las campañas en las que el recolector participa actualmente.

## 2. HISTORIAL DE DONANTES

Implementar un endpoint paginado para listar donantes.

Cada registro debe incluir:
- ID del donante.
- Nombres y apellidos.
- Correo electrónico.
- Facultad, carrera o asociación, si existe.
- Número de campañas en las que ha participado.
- Total de donaciones registradas.
- Número de donaciones físicas.
- Número de donaciones monetarias.
- Fecha de última donación.

### Detalle del donante

Debe devolver:

**Información del donante**
- Datos personales disponibles.
- Información académica.
- Identificador de usuario.

**Campañas asociadas**
- ID de campaña.
- Nombre de campaña.
- Período académico.
- Fecha de participación.
- Número de donaciones realizadas.
- Estado de las campañas, cuando corresponda.

IMPORTANTE: Una campaña se considera asociada al donante cuando existe al menos una donación registrada por él en dicha campaña.

## 3. DONACIONES DE UN DONANTE POR CAMPAÑA

Implementar un endpoint para consultar las donaciones de un donante dentro de una campaña específica.

Cada donación debe devolver:

- ID.
- Código o identificador QR.
- Tipo de donación.
- Descripción.
- Fecha de registro.
- Estado actual.
- Punto de recolección.
- Recolector asignado.
- Información de clasificación, si existe.
- Información de entrega, si existe.

La respuesta debe incluir los datos necesarios para que Flutter construya tarjetas de donaciones.

También debe existir una consulta de detalle individual que permita obtener la trazabilidad completa de la donación.

## 4. TRAZABILIDAD

Reutilizar el historial de estados existente.

Mostrar los estados registrados con:
- Estado anterior.
- Estado nuevo.
- Fecha y hora.
- Usuario responsable del cambio.
- Observación, si existe.

No reconstruir ni inventar movimientos que no estén almacenados.

Conservar la secuencia real de estados del flujo de Donaty-EC:

Registrada → Pendiente de recolección → Asignada → Recolectada → En clasificación → En proceso de entrega → Entregada → Finalizada.

Considerar los estados adicionales o excepciones que ya contemple el proyecto.

## 5. FILTROS Y BÚSQUEDA

Todos los filtros deben ejecutarse en el backend.

### Recolectores
- Búsqueda por nombres, apellidos o correo.
- Campaña.
- Período académico.
- Estado de cuenta.
- Rol desempeñado.
- Rango de fechas de participación.

### Donantes
- Búsqueda por nombres, apellidos o correo.
- Campaña.
- Período académico.
- Tipo de donación.
- Estado de donación.
- Rango de fechas.

Permitir combinar filtros y limpiar los criterios.

Implementar:
- Paginación.
- Límite de registros.
- Ordenamiento.
- Total de resultados.
- Página actual.
- Total de páginas.

Evitar traer todos los registros a memoria para filtrarlos después.

## 6. ENDPOINTS

Primero revisar los endpoints existentes y reutilizarlos cuando sea posible.

Si no existen operaciones equivalentes, implementar una estructura equivalente a:

GET /api/admin/historial/recolectores

GET /api/admin/historial/recolectores/:recolectorId

GET /api/admin/historial/donantes

GET /api/admin/historial/donantes/:donanteId

GET /api/admin/historial/donantes/:donanteId/campanas/:campanaId/donaciones

GET /api/admin/historial/donaciones/:donacionId/trazabilidad

Los nombres definitivos deben respetar las convenciones actuales del proyecto.

## 7. SEGURIDAD

- Todos los endpoints deben requerir autenticación.
- Únicamente ADMINISTRADOR puede consultar este historial.
- Validar los identificadores recibidos.
- Evitar exposición de contraseñas, tokens y datos sensibles.
- Evitar que un usuario consulte información administrativa mediante endpoints públicos.
- Mantener los middleware actuales.

## 8. RENDIMIENTO E INTEGRIDAD

- Evitar consultas N+1.
- Utilizar agregaciones de MongoDB cuando sean convenientes.
- Evitar duplicar donaciones por relaciones de campaña.
- No modificar documentos históricos para facilitar las consultas.
- No alterar las reglas de asignación de recolectores.
- No cambiar los estados de las donaciones.
- Revisar los índices existentes antes de crear otros.
- Mantener compatibilidad con datos antiguos.

## 9. PRUEBAS

Verificar:
- Listado de recolectores.
- Detalle de recolector.
- Campañas actuales e históricas.
- Listado de donantes.
- Detalle de donante.
- Campañas asociadas.
- Donaciones por campaña.
- Trazabilidad.
- Búsqueda.
- Filtros combinados.
- Paginación.
- Acceso exclusivo de administradores.
- Usuarios sin campañas.
- Usuarios sin donaciones.
- Registros históricos sin asignaciones activas.

## 10. RESTRICCIONES

- Trabajar exclusivamente en BACKEND.
- No modificar Flutter.
- No modificar frontend web.
- No rediseñar modelos si no es necesario.
- No duplicar endpoints existentes.
- No eliminar funcionalidades.
- No realizar migraciones destructivas.
- No desplegar.
- No ejecutar operaciones sobre producción.

## ENTREGA

Al finalizar, informar:
1. Archivos modificados.
2. Endpoints existentes reutilizados.
3. Endpoints nuevos.
4. Estructura JSON de respuesta de cada endpoint.
5. Filtros disponibles.
6. Pruebas realizadas y resultados.
7. Contrato exacto que deberá consumir Flutter.

IMPORTANTE: No implementar funcionalidades visuales. El objetivo es entregar una API funcional, segura y lista para ser consumida por Flutter.
