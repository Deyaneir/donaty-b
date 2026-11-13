Necesito corregir el registro de usuarios en Donaty-EC.

Actualmente el sistema no permite registrar dos cuentas utilizando el mismo correo electrónico, aunque tengan roles diferentes.

Quiero implementar el siguiente comportamiento:

Ejemplo:
- Cuenta 1: usuario@epn.edu.ec → RECOLECTOR.
- Cuenta 2: usuario@epn.edu.ec → DONANTE.

Ambas deben ser cuentas independientes.

**CAMBIOS NECESARIOS:**

1. Revisar el modelo de Usuario y sus validaciones.
2. Revisar los índices únicos existentes en MongoDB.
3. Eliminar la restricción de unicidad exclusiva del correo electrónico, mediante una migración controlada.
4. Implementar un índice compuesto único por correo electrónico y rol.
5. Permitir registrar el mismo correo cuando el rol sea diferente.
6. Impedir registrar el mismo correo dos veces con el mismo rol.
7. Normalizar los correos (eliminar espacios y convertirlos a minúsculas).
8. Mantener contraseñas, perfiles e identificadores independientes.
9. Revisar el controlador de registro y todas sus validaciones.
10. Revisar el inicio de sesión: como un correo puede tener dos cuentas, debe poder identificarse la cuenta mediante el correo, contraseña y rol seleccionado.
11. El JWT debe identificar correctamente el ID y rol de la cuenta seleccionada.
12. Revisar recuperación de contraseña para evitar confundir las cuentas.
13. Mantener las restricciones del administrador.

**IMPORTANTE:**
No basta con modificar el esquema de Mongoose. Revisar los índices que ya existen físicamente en MongoDB, porque un índice único anterior puede seguir impidiendo los registros.

No eliminar datos ni índices que no estén relacionados con este cambio.

Primero analizar, después implementar y finalmente probar.

Entregar también el contrato de los endpoints de registro e inicio de sesión para adaptar Flutter.