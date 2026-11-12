Necesito corregir estrictamente la lógica de asignación y reasignación de recolectores en Donaty-EC.

IMPORTANTE:
- Primero analiza los modelos, controladores, rutas, servicios y lógica actual de asignación de recolectores.
- No modifiques funcionalidades que no estén relacionadas con esta solicitud.
- No elimines la lógica existente de recolectores principales y secundarios.
- No dupliques endpoints ni crees estructuras innecesarias.
- Respeta la arquitectura y convenciones actuales del proyecto.

**1. Control del máximo de recolectores**

La campaña dispone de un máximo de recolectores permitidos. Cuando se aumente este límite, debe ser posible agregar nuevos recolectores secundarios en los puntos de recolección.

Si el máximo permitido ya está ocupado, el sistema debe impedir agregar otro recolector y devolver una respuesta informativa indicando que no se puede eliminar directamente a un recolector de la campaña, sino que debe realizarse una reasignación.

**2. Reasignación de recolectores**

Implementar correctamente la reasignación de un recolector por otro.

Al realizar esta operación:

- Validar que el recolector sustituto pueda ser asignado a la campaña.
- Evitar que un recolector esté asignado simultáneamente a campañas incompatibles según las reglas actuales.
- Transferir inmediatamente todas las donaciones que estaban asignadas al recolector anterior hacia el nuevo recolector.
- Mantener la campaña y el punto de recolección correspondientes.
- Conservar los estados actuales de las donaciones.
- No reiniciar el seguimiento ni alterar las evidencias registradas.
- Actualizar la disponibilidad del recolector anterior para que pueda ser asignado nuevamente.

La operación debe mantener la integridad de los datos, preferiblemente mediante una transacción de base de datos.

**3. Historial y trazabilidad**

La reasignación debe generar un registro histórico que contenga:

- Recolector anterior.
- Recolector nuevo.
- Administrador que realizó la reasignación.
- Fecha y hora de la operación.
- Campaña y punto de recolección.
- Donaciones transferidas.
- Estado que tenía cada donación antes de la reasignación.

El historial de cada donación debe conservar las acciones y evidencias del recolector anterior.

En la tabla de seguimiento debe visualizarse hasta qué estado llegó la donación antes de la reasignación. Las acciones posteriores deben quedar asociadas al nuevo recolector.

No sobrescribir ni eliminar los registros históricos anteriores.

**4. Disponibilidad del recolector**

Una vez finalizada la reasignación, el recolector anterior debe dejar de estar asignado a ese punto y quedar disponible para futuras asignaciones, siempre que no tenga otras asignaciones activas que lo impidan.

Verificar que los cambios se reflejen correctamente en los endpoints de consulta de recolectores, campañas, puntos y donaciones.

**IMPORTANTE:** No modificar la lógica de entrega general de la campaña ni los demás procesos de donación.

**5. Integridad y atomicidad de la reasignación**

La reasignación debe ejecutarse como una única operación atómica mediante una transacción de base de datos.

- Primero se deben validar el recolector sustituto, la campaña, el punto y las donaciones asignadas.
- Se deben transferir todas las donaciones del recolector anterior al nuevo.
- Se debe registrar el evento de reasignación en el historial.
- Se debe actualizar la disponibilidad del recolector anterior y la asignación del nuevo.
- Todos estos cambios deben confirmarse únicamente si la operación se completa correctamente.

Si ocurre un error durante cualquiera de los pasos, se debe ejecutar un rollback para revertir todos los cambios realizados. De esta manera, el recolector anterior conservará sus asignaciones y no quedarán donaciones transferidas parcialmente.

No permitir que una reasignación incompleta se considere exitosa.