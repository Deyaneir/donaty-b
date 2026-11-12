# DONATY-EC BACKEND — REVISIÓN Y CORRECCIÓN DE CONTRATOS PARA MÓVIL

Debes inspeccionar el backend actual de Donaty-EC y corregir las incompatibilidades que impiden que las pantallas móviles funcionen correctamente.

No inventes rutas ni cambies contratos existentes sin verificar sus dependencias.

## A. GESTIÓN DE RECOLECTORES

Revisa las rutas, controladores, servicios y modelos relacionados con recolectores.

Verifica que Flutter pueda consultar los recolectores reales y que la respuesta incluya los datos necesarios para su presentación.

Comprueba:
- Identificador.
- Nombre.
- Estado.
- Datos de contacto que estén disponibles y autorizados.
- Información de asignación a puntos.
- Rol principal o secundario cuando corresponda.

No crees endpoints duplicados.
No cambies la estructura de autenticación.
No permitas que un usuario consulte o modifique datos fuera de sus permisos.

## B. CAMPAÑAS DEL RECOLECTOR

Verifica que el backend permita obtener únicamente las campañas y los puntos a los que el recolector tiene acceso.

La respuesta debe incluir los datos reales que Flutter necesita para mostrar las campañas como tarjetas:
- Identificador.
- Nombre.
- Imagen, si existe.
- Descripción.
- Estado.
- Periodo académico.
- Puntos asignados.
- Información necesaria para abrir el detalle.

No devuelvas campañas de otros recolectores cuando el acceso deba estar restringido.

## C. HISTORIAL Y FILTRO POR PERIODO

Revisa el endpoint existente del historial.

Comprueba si permite filtrar por:
- Texto de búsqueda.
- Periodo académico.
- Campaña.
- Estado, si ya está contemplado.

Si los filtros pueden ejecutarse correctamente en el backend, implementa su soporte sin romper el contrato actual.

El periodo debe utilizar el dato real de la campaña o de la donación.

No inventes campos ni generes periodos ficticios.
Si un filtro no puede implementarse con los modelos actuales, informa qué dato falta.

## D. ENTREGA GENERAL

Conserva el contrato existente:

`POST /api/campanas/:campanaId/entrega`

Verifica:
- Autorización del recolector principal responsable.
- Validación de todas las donaciones.
- Registro único por campaña.
- Persistencia de evidencias.
- Datos del receptor.
- Fecha.
- Responsables de campaña.
- Usuario que registra la entrega.
- Cantidades realmente entregadas.

No cambies el recolector asignado individualmente a cada donación.

No permitas que un recolector secundario registre la entrega general si no está autorizado.

## E. BLOQUEOS DE CLASIFICACIÓN E INVENTARIO

Actualmente no existe una API real de clasificación por productos ni un endpoint de inventario consolidado.

No simules estas funcionalidades.
No derives el inventario de `metadata.cantidad`.
No expongas cantidades disponibles ficticias.

Inspecciona los modelos actuales y presenta qué entidades, rutas y validaciones hacen falta para implementar correctamente:
- Clasificación por donación.
- Productos clasificados.
- Inventario consolidado.
- Cantidades disponibles.
- Trazabilidad de productos.

No implementes estos módulos hasta contar con un contrato definido.

## F. VALIDACIONES

- Mantén las validaciones en backend.
- No confíes en roles enviados desde Flutter.
- No confíes en IDs de usuarios enviados por el cliente para determinar al usuario autenticado.
- Mantén los códigos HTTP y estructuras de respuesta existentes, salvo que exista una incompatibilidad demostrada.
- No elimines rutas ni funcionalidades existentes.

## G. RESULTADO

Realiza las correcciones que sí estén respaldadas por los contratos actuales.

Al finalizar, informa:
- Rutas revisadas.
- Rutas modificadas.
- Modelos modificados.
- Contratos reales de request y response.
- Compatibilidad con Flutter.
- Pruebas realizadas.
- Bloqueos pendientes.

No respondas únicamente con una propuesta. Inspecciona y corrige el backend.