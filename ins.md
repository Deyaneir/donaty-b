CORRIGE ESTE ERROR DE VALIDACIÓN EN LA CREACIÓN DE CAMPAÑAS.

Actualmente, al crear una campaña, configuro que un punto de recolección necesita 1 recolector y selecciono a una persona como recolector principal. Sin embargo, al guardar, el backend indica que faltan recolectores.

ESTO ES INCORRECTO.

La regla obligatoria es:

- La cantidad de recolectores requerida incluye al recolector principal.
- El recolector principal cuenta como 1.
- Los recolectores secundarios completan los cupos restantes.
- Si se requieren 1 recolector y existe 1 principal, la asignación está completa.
- Si se requieren 2 y existe 1 principal, falta 1 secundario.
- Si se requieren 3 y existe 1 principal, faltan 2 secundarios.

Ejemplo obligatorio:

recolectoresRequeridos = 1
recolectorPrincipal = recolector válido
recolectoresSecundarios = []

RESULTADO: VALIDACIÓN CORRECTA. PERMITIR CREAR LA CAMPAÑA.

Debes revisar la validación real en los controladores y servicios de creación y edición de campañas.

IMPORTANTE:

1. Identifica exactamente qué condición está provocando el mensaje de que faltan recolectores.
2. Comprueba si el principal se está excluyendo del conteo.
3. Comprueba si se está exigiendo al menos un recolector secundario aunque la cantidad requerida sea 1.
4. Corrige el cálculo para cada punto de recolección, no globalmente para toda la campaña.
5. Evita contar dos veces al principal.
6. Conserva las validaciones de recolectores activos, roles y duplicados.
7. No elimines la validación de cupos.
8. No cambies campos ni contratos sin revisar primero sus dependencias.
9. No modifiques el frontend en esta tarea.

PRUEBAS OBLIGATORIAS:

- 1 requerido + 1 principal + 0 secundarios = válido.
- 2 requeridos + 1 principal + 0 secundarios = falta 1.
- 2 requeridos + 1 principal + 1 secundario = válido.
- 3 requeridos + 1 principal + 2 secundarios = válido.
- Sin principal = inválido, si el modelo exige un principal.
- Principal duplicado en secundarios = inválido.

Ejecuta npm test.

Al terminar, explícame qué condición causaba el error, qué archivo modificaste y muestra los resultados reales de las pruebas.

No te limites a explicar la solución: corrige el código.
