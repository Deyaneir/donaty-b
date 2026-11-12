# DONATY-EC — Auditoría y corrección integral del backend del rol RECOLECTOR

Necesito revisar y corregir el backend de Donaty-EC para que funcione correctamente con el flujo del rol RECOLECTOR en la aplicación móvil Flutter.

**IMPORTANTE:**
- El alcance es exclusivamente el backend que consume la aplicación móvil.
- NO modificar ni desarrollar funcionalidades de la aplicación web.
- Antes de programar, revisar los modelos, controladores, rutas, middlewares, servicios y contratos actuales.
- No inventar rutas, campos, estados ni respuestas.
- No duplicar funcionalidades existentes.
- Mantener compatibilidad con las funciones actuales del administrador y donante.
- No eliminar lógica existente para solucionar errores.
- Si Flutter y backend tienen contratos diferentes, identificar la diferencia y corregirlos de forma coherente.

## 1. Registro de donaciones por recolector

Revisar el flujo de registro de donaciones realizado por un recolector desde una campaña y sus categorías.

El registro debe conservar la información del donante y del bien donado.

Verificar:
- Nombre del donante.
- Información del donante que actualmente solicita el formulario.
- Campaña asociada.
- Categoría de la donación.
- Nombre del bien donado.
- Cantidad.
- Fecha de registro.
- Recolector que registró la donación.
- Relación correcta con la campaña.

No eliminar campos que ya forman parte del formulario actual. Comprobar que todos los datos enviados desde Flutter se validen y persistan correctamente en MongoDB.

Distinguir correctamente las donaciones registradas por un recolector de las registradas directamente por un donante.

## 2. Campañas visibles para el recolector

El recolector solamente debe recibir campañas que correspondan a campañas publicadas y disponibles para su participación.

- No devolver campañas en estado `borrador`.
- No mostrar campañas que todavía no estén disponibles para los recolectores.
- Respetar las asignaciones de puntos y recolectores.
- No modificar la visibilidad de campañas para el administrador.

La validación debe realizarse en el backend, no depender exclusivamente de filtros de Flutter.

## 3. Evidencias fotográficas de recolección

Revisar el endpoint y controlador de recolección.

Actualmente existe un problema: cuando se adjuntan varias fotografías aparece el mensaje «Debes adjuntar evidencia fotográfica de la recolección», aunque se hayan seleccionado archivos. Con una sola fotografía el comportamiento es diferente.

Investigar específicamente:
- Recepción de archivos multipart.
- Nombre del campo esperado por Multer.
- Diferencia entre un archivo y un arreglo de archivos.
- Validación de cantidad de evidencias.
- Persistencia de evidencias.
- Respuesta del endpoint.
- Manejo de errores cuando se envían varias fotografías.

La recolección debe aceptar las evidencias fotográficas según las reglas actuales del proyecto, tanto si se envía una fotografía como varias.

No marcar una donación como `recolectada` si la evidencia obligatoria no se ha guardado correctamente.

No permitir que una validación incorrecta rechace fotografías válidas.

## 4. Clasificación de productos

Implementar o corregir la persistencia de la clasificación de los bienes recibidos.

La clasificación debe permitir registrar varios productos asociados a una misma donación.

La información debe contemplar estos campos:

| Campo | Ejemplo |
|---|---|
| Categoría | Enlatados |
| Producto | Atún |
| Nombre del bien donado | Atún en agua |
| Cantidad | 10 |

Cada registro debe estar relacionado con su donación y campaña.

Requisitos:
- Permitir agregar varios productos.
- Validar cantidades.
- Guardar correctamente todos los registros.
- Evitar duplicaciones accidentales.
- Recuperar la clasificación al consultar el detalle de la donación.
- Mantener la información disponible para el registro de entrega general.

No reemplazar la información original de la donación. La clasificación complementa los datos del bien recibido.

## 5. Permisos de recolectores principales y secundarios

Respetar la asignación existente por punto de recolección.

- El recolector principal y los secundarios pueden realizar las actividades de recolección y clasificación que les correspondan.
- Los secundarios NO pueden registrar la entrega general de la campaña.
- El recolector principal es el único autorizado para completar el registro de entrega general.
- No confiar en un campo enviado por Flutter como `esPrincipal`; comprobar el rol y la asignación real desde el backend.

## 6. Entrega general de campaña

La entrega general no se registra por cada donación, sino una sola vez por campaña.

El backend debe permitir que el recolector principal registre la entrega únicamente cuando se cumplan ambas condiciones:

1. La campaña haya finalizado según su estado y reglas reales.
2. Todas las donaciones que pertenecen a esa campaña se encuentren en estado `en_entrega`.

No habilitar la entrega si:
- La campaña todavía está activa.
- Existe alguna donación que todavía no está en `en_entrega`.
- El usuario autenticado no es el recolector principal autorizado.
- La entrega ya fue registrada.

El registro general debe conservar los campos definidos para la entrega:
- Nombres y apellidos de los responsables.
- Teléfono.
- Cargo o función.
- Descripción de los bienes entregados.
- Fecha de entrega.
- Evidencias fotográficas.

La descripción de los bienes debe poder alimentarse de los productos registrados durante la clasificación, incluyendo categoría, producto, nombre del bien donado y cantidad.

No volver a registrar manualmente los mismos productos por cada donación si ya existe la información de clasificación.

## 7. Consultas y trazabilidad

Comprobar que las consultas devuelvan correctamente:
- Campañas asignadas al recolector.
- Punto de recolección.
- Donaciones asociadas.
- Datos del donante.
- Imagen de la donación.
- Estado actual.
- Evidencias fotográficas.
- Productos clasificados.
- Información de entrega general.

La información debe respetar los permisos de cada rol.

## 8. QR y comprobante de impresión

Revisar cómo se genera, almacena y consulta el QR existente.

El detalle de la donación debe proporcionar:
- Código o identificador.
- QR existente.
- Datos necesarios para mostrarlo en Flutter.

El QR debe corresponder a la donación original. No crear un nuevo código para imprimir.

La impresión se realizará desde Flutter mediante un PDF A5. No crear un endpoint de impresión si el backend ya proporciona todos los datos necesarios.

No restringir los endpoints generales de lectura QR utilizados por donantes y administradores.

## 9. Validaciones obligatorias

- Revisar autorización por rol y asignación.
- Validar transiciones de estados.
- Evitar saltos de estados.
- Evitar duplicación de entregas.
- Evitar clasificaciones inconsistentes.
- Validar persistencia de archivos.
- Verificar relaciones entre campaña, donación y recolector.
- Mantener la lógica de idempotencia existente.

## 10. Entrega del trabajo

Antes de finalizar:
1. Ejecutar pruebas existentes.
2. Agregar pruebas para los errores detectados.
3. Probar una y varias fotografías de recolección.
4. Probar clasificación con varios productos.
5. Probar los permisos de principal y secundario.
6. Probar el bloqueo de entrega general hasta que se cumplan las dos condiciones.
7. Comprobar que el QR siga funcionando para todos los roles.

Entregar un informe con:
- Archivos modificados.
- Problemas encontrados.
- Cambios realizados.
- Endpoints existentes modificados.
- Contratos de petición y respuesta definitivos para Flutter.
- Pruebas ejecutadas y resultados.

No modificar funcionalidades ajenas a estos requerimientos.