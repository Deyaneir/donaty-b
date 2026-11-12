# DONATY-EC — Correcciones de ubicación, reasignación, trazabilidad, IA y clasificación por punto

Trabaja exclusivamente en el backend de Donaty-EC para corregir los siguientes problemas.

**Instrucciones:** primero inspecciona los modelos, controladores, rutas y servicios relacionados. Reutiliza la arquitectura actual. No inventes endpoints ni campos, no elimines funcionalidades y no modifiques la aplicación web. Realiza únicamente los cambios necesarios para estos requerimientos.

### 1. Ubicación del recolector y destino
- Revisar cómo se almacena y consulta la ubicación actual del recolector.
- Proporcionar los datos necesarios para mostrar en el mapa de la campaña la ubicación del recolector asignado.
- Mantener la relación entre campaña, punto de recolección y recolector.
- No confundir la ubicación del recolector con la ubicación fija del punto.

### 2. Reasignación de donaciones
Corregir la lógica cuando un recolector es reemplazado por otro dentro de un punto.

Ejemplo:
- Inicialmente la donación está asignada a Pepito.
- Se reasigna a Mario.
- Mario debe recibir la donación en sus consultas.
- Pepito ya no debe verla como una donación pendiente de su responsabilidad.
- La reasignación debe conservarse en el historial.

Reglas:
- Las donaciones que todavía no han sido recolectadas deben poder reasignarse según su estado y las reglas actuales del proyecto.
- Las donaciones que ya fueron recolectadas deben conservar el responsable real de esa recolección.
- No cambiar retroactivamente quién realizó una recolección.
- Si corresponde una nueva asignación después de la recolección, registrar el cambio sin borrar el historial anterior.
- Las donaciones deben quedar asociadas al recolector actualmente responsable de la siguiente actividad.
- Evitar que dos recolectores aparezcan simultáneamente como responsables actuales de la misma donación.

### 3. Historial de reasignaciones y responsables
Mantener trazabilidad completa:
- Recolector anterior.
- Nuevo recolector.
- Fecha y hora del cambio.
- Punto al que pertenece.
- Estado de la donación cuando ocurrió el cambio.
- Recolector que realizó la recolección.
- Recolector responsable de la clasificación.
- Recolector principal del punto.

El historial debe permitir reconstruir quién tuvo la responsabilidad en cada etapa.

Cuando finalice el proceso de clasificación y corresponda la entrega general, debe identificarse también al recolector principal responsable de realizarla.

No sobrescribir el historial con el nombre del último recolector.

### 4. Autorrellenado mediante IA
Corregir el problema de reutilización de una fotografía:

Caso actual:
1. El usuario toma una fotografía.
2. Ejecuta el autorrellenado.
3. La IA completa los campos.
4. Borra todos los campos, excepto la imagen.
5. Vuelve a ejecutar el autorrellenado.
6. La IA ya no procesa la imagen.

Debe permitirse volver a analizar la misma imagen cuando el usuario lo solicite.

- No bloquear el análisis únicamente porque la imagen ya fue procesada anteriormente.
- No depender de un identificador de imagen anterior para impedir nuevos análisis.
- Mantener la imagen seleccionada.
- Permitir que el análisis vuelva a ejecutarse y devuelva los datos extraídos.
- Evitar duplicar registros o guardar automáticamente una donación durante el análisis.

### 5. Error al crear donaciones del recolector
Actualmente aparece «Respuesta inesperada en el servidor» al registrar una donación desde el recolector.

Investigar la causa real:
- Validaciones.
- Campos obligatorios.
- Datos del donante.
- Categoría y producto.
- Cantidad.
- Identificador de campaña y punto.
- Identificador del recolector autenticado.
- Evidencias y archivos multipart, si intervienen.
- Estructura de respuesta del controlador.

Corregir el error sin ocultarlo con respuestas genéricas. Mantener respuestas consistentes y mensajes útiles para Flutter.

### 6. Evidencias de recolección
En la consulta de evidencias:
- Mostrar el nombre del recolector una sola vez como responsable de la evidencia.
- Debajo, mostrar las fotografías correspondientes.
- No repetir el nombre por cada fotografía.
- No mostrar el número de identificación del recolector.
- Mantener la relación de las fotografías con la donación y su etapa.

### 7. Clasificación agrupada por punto de recolección
Cambiar la lógica de clasificación para que los productos se organicen por categorías dentro de cada punto.

Ejemplo del punto A:

Categoría: MUÑECAS.

Dentro de esa categoría:
- Donante María: Barbie, nombre del bien donado Barbie, cantidad 6.
- Donante Josefina: Muñeca de trapo, nombre del bien donado Muñeca de trapo, cantidad correspondiente.

En la vista resumida de la categoría debe mostrarse:
- Nombre de la categoría: Muñecas.
- Cantidad total acumulada: suma de las cantidades de los bienes clasificados en esa categoría.

Al abrir la categoría, deben mostrarse los detalles individuales:
- Donante.
- Producto.
- Nombre del bien donado.
- Cantidad.

No perder la información individual de cada donación al agrupar.

### 8. Aislamiento de clasificación por punto
La clasificación debe estar separada por punto de recolección.

Ejemplo:
- El punto A tiene sus propias donaciones y clasificación.
- El punto B tiene sus propias donaciones y clasificación.
- Los recolectores del punto A solamente consultan y clasifican las donaciones de A.
- Los recolectores del punto B solamente consultan y clasifican las donaciones de B.

Un recolector que no pertenece al punto A no debe recibir ni consultar la clasificación de A.

Los recolectores autorizados del punto B deben poder ver lo que ya se ha clasificado en B y continuar registrando sus productos.

La categoría y los registros individuales deben conservarse separados por punto. No mezclar cantidades ni productos entre puntos.

Validar los permisos desde el backend utilizando la asignación real del usuario autenticado, no un identificador de punto enviado libremente por Flutter.

### 9. Validaciones y pruebas
Agregar o corregir pruebas para:
- Reasignación de una donación pendiente.
- Conservación del recolector que realizó una recolección.
- Historial con recolector anterior y nuevo.
- Reejecución de IA con la misma imagen.
- Registro de donación por recolector.
- Evidencias con varias fotografías.
- Agrupación de productos y suma de cantidades.
- Aislamiento de clasificación entre puntos.
- Restricción de acceso de recolectores de otros puntos.

Al finalizar, informar archivos modificados, causa de los errores, contratos definitivos para Flutter y pruebas ejecutadas.