# Cuentas y autenticación por rol

Donantes, recolectores y administradores se almacenan en colecciones MongoDB separadas. El índice único de `email` de cada modelo impide duplicados dentro de ese rol, pero no impide que un donante y un recolector tengan el mismo correo. No se debe reemplazar por un índice global.

Los endpoints existentes de registro e inicio de sesión siguen determinando el rol por la ruta:

- `/api/donante/registro` y `/api/donante/login`
- `/api/recolector/registro` y `/api/recolector/login`

El rol enviado en el cuerpo no selecciona ni concede privilegios. El registro público crea solo donantes o recolectores; las cuentas de administrador mantienen su flujo protegido.

Si un correo tiene cuentas de donante y recolector, el endpoint compartido `/api/donante/recuperarpassword` requiere `rol: "donante"` o `rol: "recolector"` para iniciar la recuperación. Si solo existe una cuenta pública con ese correo, el campo sigue siendo opcional. El endpoint de recuperación bajo `/api/recolector` ya está limitado al recolector. Los enlaces de restablecimiento identifican la cuenta por su token, no por el correo.

El reenvío compartido de confirmación también acepta `rol` cuando hay más de una cuenta sin confirmar con el mismo correo; sin ese dato responde `409` en vez de elegir una cuenta arbitrariamente.

No se requiere migración de índices: los índices únicos existentes son por colección/rol. No eliminar ni recrear los índices `email_1` de `donantes`, `recolectores` o `admins`.
