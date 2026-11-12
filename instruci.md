# DONATY-EC — Corrección de fechas, horarios y disponibilidad de campañas

Necesito corregir la lógica de fechas y horarios de las campañas en el backend de Donaty-EC.

IMPORTANTE:
- Revisar primero el modelo de campaña, controladores, rutas, validaciones y servicios relacionados.
- No modificar la aplicación web.
- No inventar campos ni modificar contratos sin comprobar su uso actual en Flutter.
- Mantener la compatibilidad con los demás roles.
- No eliminar funcionalidades existentes.

## 1. Interpretación correcta de fechas y horarios

La campaña tiene cuatro datos independientes:

- Fecha de inicio.
- Fecha de finalización.
- Hora diaria de inicio.
- Hora diaria de finalización.

Las horas representan el horario de atención que se repite cada día durante todo el rango de fechas.

Ejemplo:

Fecha de inicio: 5 de noviembre.
Fecha de finalización: 8 de noviembre.
Hora de inicio: 09:00.
Hora de finalización: 17:00.

Interpretación correcta:

- 5 de noviembre: de 09:00 a 17:00.
- 6 de noviembre: de 09:00 a 17:00.
- 7 de noviembre: de 09:00 a 17:00.
- 8 de noviembre: de 09:00 a 17:00.

La campaña comienza el día 5 a las 09:00 y termina definitivamente el día 8 a las 17:00.

No interpretar la hora de finalización como una hora del mismo día de inicio.

## 2. Validaciones

Implementar las siguientes validaciones:

- La fecha de finalización no puede ser anterior a la fecha de inicio.
- La hora de inicio y finalización deben ser válidas.
- La hora de finalización debe ser posterior a la hora de inicio.
- No permitir horarios invertidos.
- No permitir que una campaña esté disponible antes de su fecha y hora de inicio.
- No permitir que una campaña siga disponible después de su fecha y hora de finalización.

Para campañas que ya existen, comprobar la estructura actual de fechas antes de realizar migraciones o cambios de interpretación.

## 3. Disponibilidad diaria

La disponibilidad debe comprobarse usando la fecha y hora local de Ecuador (America/Guayaquil), evitando diferencias por UTC o conversiones incorrectas.

Una campaña está dentro de su horario de atención cuando:

- La fecha actual está dentro del rango inclusivo de fechas.
- La hora actual está dentro del horario diario definido.
- La campaña no está borrador, cancelada o finalizada.

Respetar los límites de inicio y finalización.

No modificar las reglas de los estados de campaña sin revisar primero su implementación actual.

## 4. Aplicación en los procesos

Verificar la disponibilidad en los procesos donde corresponda:

- Consulta de campañas disponibles.
- Visualización de campañas para el recolector.
- Registro de donaciones.
- Selección de campañas y categorías.
- Operaciones que dependan de que la campaña esté disponible.

No permitir que Flutter sea el único responsable de validar el horario.

## 5. Entrega

- Identificar los archivos modificados.
- Documentar cómo se interpreta ahora el horario.
- Indicar cómo se manejan fechas y zonas horarias.
- Agregar pruebas para inicio, fin, días intermedios, antes del horario, después del horario y límites exactos.
- Verificar que las campañas antiguas sigan funcionando correctamente.

No modificar funcionalidades ajenas a este requerimiento.