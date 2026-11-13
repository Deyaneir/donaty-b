# DONATY-EC — SOPORTE BACKEND PARA FUNCIONAMIENTO OFFLINE Y SINCRONIZACIÓN

## OBJETIVO

Adaptar el backend para permitir que Flutter sincronice operaciones creadas sin conexión a internet.

Primero analizar los endpoints, controladores, modelos y middleware actuales.

No rediseñar el backend completo.

## 1. IDENTIFICACIÓN DE OPERACIONES

Revisar cómo se crean actualmente:
- Donaciones.
- Puntos de recolección.
- Clasificaciones.
- Actualizaciones de estado.
- Evidencias.
- Entregas.

Determinar cuáles pueden admitir sincronización diferida y cuáles requieren validación inmediata del servidor.

## 2. EVITAR REGISTROS DUPLICADOS

Implementar un mecanismo de idempotencia para operaciones offline.

Cada operación recibida debe poder identificarse mediante un identificador único generado por Flutter.

Reglas:
- Si una operación llega por primera vez, procesarla.
- Si llega nuevamente con el mismo identificador y pertenece al mismo usuario, devolver el resultado anterior.
- No crear una segunda donación.
- No duplicar evidencias.
- No duplicar cambios de estado.
- Rechazar identificadores reutilizados por usuarios diferentes.

La operación debe conservar su relación con el usuario autenticado.

## 3. VALIDACIONES AL SINCRONIZAR

No confiar únicamente en las validaciones realizadas por Flutter.

Al recibir una operación:
- Validar JWT.
- Validar usuario.
- Validar rol.
- Validar campaña.
- Validar permisos.
- Validar estado actual de la donación.
- Validar reglas de asignación.
- Validar datos obligatorios.
- Validar que la operación siga siendo válida al momento de procesarla.

Las reglas actuales de Donaty-EC deben mantenerse.

Si una operación ya no es válida, devolver un error controlado que permita a Flutter marcarla como REQUIERE VALIDACIÓN.

## 4. FECHAS Y TRAZABILIDAD

Conservar:
- Fecha de creación local informada por Flutter.
- Fecha de recepción en el servidor.
- Fecha efectiva de procesamiento.
- Usuario responsable.
- Identificador de operación.

No confiar en el reloj del dispositivo para determinar permisos ni autorizar cambios de estado.

No reemplazar la fecha oficial del servidor con la fecha local.

## 5. SINCRONIZACIÓN DE ARCHIVOS

Revisar el sistema actual de subida de evidencias.

Permitir reintentos sin duplicar archivos.

Verificar:
- Identificador de evidencia.
- Relación con la donación.
- Usuario responsable.
- Integridad del archivo.
- Confirmación de almacenamiento.

Mantener compatibilidad con el mecanismo actual de subida multipart.

## 6. AUTENTICACIÓN

Revisar el comportamiento de los tokens JWT.

Si el token expira mientras el usuario está offline:
- Flutter debe conservar las operaciones pendientes.
- El backend debe seguir exigiendo autenticación válida.
- No aceptar operaciones sin autenticación.
- No crear mecanismos que permitan saltarse la expiración del JWT.

Revisar si existe un mecanismo seguro de renovación de tokens.

Si no existe, presentar una propuesta compatible con la autenticación actual.

IMPORTANTE: Los 30 minutos de inactividad se controlan desde Flutter. No confundirlos con la expiración del token del servidor.

## 7. RESPUESTAS DE SINCRONIZACIÓN

Las respuestas deben permitir a Flutter distinguir:

- Operación creada correctamente.
- Operación ya procesada anteriormente.
- Operación inválida.
- Permisos insuficientes.
- Conflicto con datos existentes.
- Token expirado.
- Error temporal del servidor.

Incluir el identificador de operación para relacionar la respuesta con la cola local.

## 8. PRUEBAS

Verificar:
- Envío de una operación offline.
- Reenvío de una operación ya procesada.
- Ausencia de duplicados.
- Identificadores de operaciones de distintos usuarios.
- Token expirado.
- Usuario sin permisos.
- Cambio de estado no permitido.
- Conflictos de sincronización.
- Subida repetida de evidencias.
- Conservación de trazabilidad.

## 9. RESTRICCIONES

- Trabajar exclusivamente en backend.
- No modificar Flutter.
- No modificar frontend web.
- No eliminar endpoints existentes.
- No debilitar JWT ni permisos.
- No cambiar las reglas de negocio de Donaty-EC.
- No realizar migraciones destructivas.
- No desplegar en producción.

## ENTREGA

Presentar:
1. Archivos modificados.
2. Endpoints que admiten sincronización.
3. Mecanismo de idempotencia implementado.
4. Validaciones realizadas.
5. Estructura JSON de respuestas.
6. Pruebas y resultados.
7. Cambios que debe realizar Flutter para consumir correctamente el backend.