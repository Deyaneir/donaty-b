Necesito que analices y corrijas dos problemas del backend de Donaty-EC. Antes de modificar cualquier archivo, revisa la arquitectura actual, los modelos, controladores, rutas, middlewares y validaciones involucradas.

## 1. CORREGIR ERROR AL CREAR CAMPAÑAS

Error actual:

`ReferenceError: session is not defined`

Ubicación:
- Archivo: `src/controllers/campana_controller.js`
- Función: `listAvailableCollectorsForCampaign()`, línea aproximada 184.
- Se ejecuta desde: `crearCampana()`, línea aproximada 1436.

Requisitos:
- Identificar por qué se utiliza `session` sin estar declarada.
- Revisar cómo se manejan las transacciones de MongoDB.
- Corregir la inicialización y propagación de la sesión donde corresponda.
- No eliminar `.session(session)` si es necesaria para mantener la transacción.
- No desactivar las transacciones ni las validaciones existentes.
- Garantizar que la creación de campañas y la asignación de recolectores mantengan la integridad de los datos.

## 2. PERMITIR REGISTRAR DOS CUENTAS CON EL MISMO CORREO, PERO DIFERENTE ROL

Actualmente necesito permitir que una misma persona pueda registrarse dos veces utilizando exactamente el mismo correo electrónico, pero seleccionando roles diferentes.

**Ejemplo de funcionamiento:**

Una persona puede tener:

Cuenta 1:
- Correo: usuario@epn.edu.ec
- Rol: RECOLECTOR
- Contraseña: independiente.
- Perfil: independiente.
- ID de usuario: independiente.

Cuenta 2:
- Correo: usuario@epn.edu.ec
- Rol: DONANTE
- Contraseña: independiente.
- Perfil: independiente.
- ID de usuario: independiente.

Ambas cuentas deben existir como registros independientes en MongoDB.

### Reglas obligatorias

1. Permitir el mismo correo electrónico para dos cuentas cuando sus roles sean diferentes.
2. Impedir que se registre nuevamente el mismo correo con el mismo rol.
3. No combinar los perfiles ni los datos de ambas cuentas.
4. Cada cuenta debe tener su propio `_id`, contraseña, perfil, historial y relaciones con las donaciones.
5. Cada cuenta debe iniciar sesión independientemente.
6. Al iniciar sesión, el sistema debe identificar correctamente la cuenta y su rol.
7. El JWT debe contener el identificador y rol de la cuenta correspondiente, sin confundir las dos cuentas.
8. La recuperación de contraseña debe contemplar que un mismo correo puede tener dos cuentas y evitar modificar la contraseña de la cuenta equivocada.
9. No permitir que una persona obtenga el rol de ADMINISTRADOR mediante el registro público.
10. Mantener las restricciones de autorización de cada rol en todos los endpoints.

## 3. REVISAR LA BASE DE DATOS Y LOS ÍNDICES

Revisar especialmente:
- Modelo de usuario.
- Validación de correo único.
- Índices `unique` de MongoDB.
- Controlador de registro.
- Controlador de inicio de sesión.
- Recuperación de contraseña.
- Middleware JWT.
- Middleware de autorización por roles.

Si actualmente existe un índice único sobre el correo, diseñar una migración segura para permitir la combinación correo + rol como restricción única.

IMPORTANTE:
- No basta con cambiar la validación del controlador.
- La base de datos también debe permitir esta estructura.
- Revisar índices existentes antes de modificarlos.
- No eliminar cuentas ni datos existentes.
- Evitar duplicados de correo y rol.
- Mantener la compatibilidad con las cuentas registradas anteriormente.

## 4. PRUEBAS OBLIGATORIAS

Agregar o adaptar pruebas para verificar:

- Registrar un recolector con un correo nuevo.
- Registrar un donante con ese mismo correo.
- Confirmar que ambas cuentas tienen identificadores independientes.
- Impedir registrar otro recolector con ese correo.
- Impedir registrar otro donante con ese correo.
- Iniciar sesión independientemente en ambas cuentas.
- Verificar que cada JWT contiene el ID y rol correctos.
- Comprobar que una cuenta no puede acceder a las funcionalidades exclusivas del otro rol.
- Comprobar que la recuperación de contraseña no modifica la cuenta equivocada.
- Comprobar que la creación de campañas ya no produce `session is not defined`.

## 5. RESTRICCIONES DE IMPLEMENTACIÓN

- Trabajar exclusivamente en el backend.
- No modificar Flutter ni el frontend web.
- No eliminar funcionalidades existentes.
- No cambiar endpoints sin que sea estrictamente necesario.
- No debilitar los controles de seguridad.
- No ejecutar despliegues.
- No realizar modificaciones destructivas en producción.
- No ejecutar `flutter run` ni compilaciones APK.

Primero analiza toda la implementación actual e identifica los archivos afectados. Después realiza las correcciones necesarias.

Al finalizar, presenta:
1. Archivos modificados.
2. Explicación de cada corrección.
3. Cambios realizados en los índices de MongoDB.
4. Migración necesaria y cómo ejecutarla de forma segura.
5. Pruebas ejecutadas y resultados.
6. Posibles cambios que posteriormente necesitará Flutter o el frontend web.

No supongas que el problema está solucionado únicamente porque el registro funciona. Verifica también el inicio de sesión, JWT, permisos y recuperación de contraseña.