# Análisis de imagen de donación

## Endpoint

`POST /api/donacion/analizar-imagen`

Requiere `Authorization: Bearer <token>` y `Content-Type: multipart/form-data`. Pueden usarlo los roles `donante` y `recolector`. El endpoint solo analiza la imagen: no crea, actualiza ni guarda una donación.

## Solicitud

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `imagen` | archivo | Sí | Una imagen JPG/JPEG, PNG o WebP, hasta 5 MB. |
| `campanaId` | texto | Sí | ID de una campaña existente y activa. |
| `categoriaId` | texto | No | ID de una categoría activa permitida por la campaña. |

El backend obtiene del catálogo de esa campaña las categorías permitidas, subcategorías activas y campos dinámicos activos. Flutter no debe enviar `categorias` ni `camposCategoria`; el servidor es la fuente de verdad.
`categoriaId` limita las sugerencias a una categoría activa de la campaña; el backend valida que pertenezca a ella. Además del nombre y la descripción, solo se pueden sugerir campos activos editables de tipo `shortText`, `longText`, `integer`, `decimal` o `unit` sin opciones (valor numérico). Los campos de selección (`dropdown`, `multiSelect`, `unit` con opciones y `yesNo`) y los campos de fecha no se rellenan desde la imagen.

## Respuesta 200

Los campos no identificados, fuera de rango o no válidos se omiten. Las sugerencias de texto/número solo usan claves activas configuradas en la categoría solicitada. No se asigna ni se infiere la cantidad general de la donación.

```json
{
  "success": true,
  "descripcion": "Cuadernos nuevos con tapas azules",
  "sugerencias": {
    "nombreBien": "Cuadernos",
    "descripcion": "Cuadernos nuevos",
    "campos": {
      "material": "papel",
      "unidades_visibles": 3
    }
  },
  "confianza": {
    "nombreBien": 0.94,
    "descripcion": 0.94,
    "campos": {
      "material": 0.76,
      "unidades_visibles": 0.82
    }
  },
  "camposRequierenRevision": [
    "nombreBien",
    "descripcion",
    "material",
    "unidades_visibles"
  ],
  "camposNoIdentificados": [],
  "requiereRevision": true
}
```

`camposRequierenRevision` y `camposNoIdentificados` identifican, respectivamente, los valores sugeridos que requieren revisión y los campos editables sin sugerencia. Las confianzas son estimaciones del modelo entre 0 y 1, no garantías. Una sugerencia omitida debe mostrarse vacía en el formulario. La app debe mantener los controles editables y solicitar confirmación explícita antes de llamar al endpoint de creación de donación.


## Errores

Los errores propios del análisis usan `{ "error": { "code": "...", "message": "..." } }`. Los middleware compartidos de autenticación/roles conservan el formato existente `{ "msg": "..." }`.

| HTTP | `code` | Causa |
| --- | --- | --- |
| 400 | `IMAGE_REQUIRED` | Falta el archivo `imagen` o se envió más de uno. |
| 400 | `INVALID_CAMPAIGN_ID` | `campanaId` no es un ObjectId válido. |
| 400 | `INVALID_CATEGORY_ID` | `categoriaId` no es un ObjectId válido. |
| 400 | `CAMPAIGN_INACTIVE` | La campaña está inactiva. |
| 401 | `UNAUTHENTICATED` | Token ausente o inválido. |
| 403 | `FORBIDDEN` | El rol no es `donante` ni `recolector`. |
| 404 | `CAMPAIGN_NOT_FOUND` | No existe la campaña indicada. |
| 404 | `CATEGORY_NOT_FOUND` | La categoría no pertenece a la campaña activa. |
| 413 | `IMAGE_TOO_LARGE` | La imagen supera 5 MB. |
| 415 | `UNSUPPORTED_IMAGE_TYPE` | Formato distinto de JPG, PNG o WebP. |
| 429 | `RATE_LIMITED` | Más de 10 análisis por usuario en una ventana de 60 segundos; revisar `Retry-After`. |
| 400 | `VISION_BAD_REQUEST` | Groq rechazó el formato o contenido de la solicitud. |
| 502 | `VISION_PROVIDER_AUTH_ERROR` | La clave del proveedor fue rechazada; revisar solo en el backend. |
| 502 | `VISION_PROVIDER_FORBIDDEN` | La cuenta no tiene acceso al proveedor o modelo. |
| 502 | `VISION_MODEL_NOT_FOUND` | El modelo configurado no está disponible para la API. |
| 429 | `VISION_RATE_LIMITED` | Groq rechazó temporalmente la solicitud por límite de cuota. |
| 502 | `VISION_PROVIDER_ERROR` | El proveedor de visión rechazó la solicitud o no estuvo disponible. |
| 502 | `INVALID_VISION_RESPONSE` | Respuesta del proveedor no válida. |
| 503 | `VISION_NOT_CONFIGURED` | Falta configurar proveedor, clave o modelo en el backend. |
| 504 | `VISION_TIMEOUT` | El proveedor excedió el tiempo máximo de espera de 60 segundos. |
| 500 | `INTERNAL_ERROR` | Error interno no clasificado. |

El rate limit es por proceso del servidor; en despliegues con varias instancias debe aplicarse también en un gateway o almacenamiento compartido para que el límite sea global.

## Privacidad y configuración

La imagen no se sube a Cloudinary ni se persiste en la base de datos. Se procesa como archivo temporal del backend, se envía al proveedor configurado para visión y el archivo temporal se elimina al terminar la solicitud. El backend no puede garantizar la retención del proveedor: revisar y configurar la política/retención del proveedor elegido antes de producción. No registrar imágenes, base64 ni claves en logs.

Para conservar la foto como evidencia, la app debe mantener el archivo original y enviarlo otra vez en `imagen` al endpoint existente `POST /api/donacion` cuando la persona confirme. Ese endpoint ya lo sube a Cloudinary y guarda `imagenUrl` e `imagenPublicId` junto con la donación. La eliminación del temporal del análisis no borra el archivo original que mantiene la app ni la evidencia de Cloudinary.

Configuración del backend para una API compatible con OpenAI Chat Completions y entrada de imágenes:

```env
GROQ_API_KEY=<secreto solo del servidor>
GROQ_MODEL=qwen/qwen3.8-27b
GROQ_API_URL=https://api.groq.com/openai/v1/chat/completions
```

El proveedor debe aceptar Chat Completions con entrada de imagen. El backend usa Groq por defecto y envía la clave en `Authorization: Bearer`. La aplicación móvil nunca debe recibir `GROQ_API_KEY`.

## Ejemplo Flutter

```dart
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$baseUrl/api/donacion/analizar-imagen'),
)
  ..headers['Authorization'] = 'Bearer $token'
  ..fields['campanaId'] = campanaId
  ..fields['categoriaId'] = categoryId
  ..files.add(await http.MultipartFile.fromPath('imagen', imagePath));

final response = await request.send().timeout(const Duration(seconds: 30));
final body = jsonDecode(await response.stream.bytesToString());
```
## Ejemplo Flutter con Dio

```dart
final formData = FormData.fromMap({
  'campanaId': campanaId,
  'categoriaId': categoryId,
  'imagen': await MultipartFile.fromFile(
    imagePath,
    filename: path.basename(imagePath),
  ),
});

try {
  final response = await dio.post(
    '$baseUrl/api/donacion/analizar-imagen',
    data: formData,
    options: Options(
      headers: {'Authorization': 'Bearer $accessToken'},
      contentType: 'multipart/form-data',
      sendTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 75),
    ),
  );
  final suggestions = response.data['sugerencias'];
} on DioException catch (error) {
  debugPrint('Error de análisis: ${error.response?.statusCode} ${error.response?.data}');
  rethrow;
}
```

En Android físico, `baseUrl` debe apuntar a la IPv4 de la computadora en la red local
(por ejemplo, `http://192.168.100.43:4000`) y el dispositivo debe poder abrir
`http://<IP_DEL_PC>:4000/health`. El token debe ser el access token JWT del usuario,
no el refresh token. No se debe colocar `GROQ_API_KEY` en Flutter.

## Pruebas

1. Inicia el backend con `npm start` y verifica `GET /health`.
2. Usa un `campanaId` activo y un JWT de rol `donante` o `recolector`.
3. Envía una imagen real menor de 5 MB:

```bash
curl -X POST "http://localhost:4000/api/donacion/analizar-imagen" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "campanaId=$CAMPANA_ID" \
  -F "categoriaId=$CATEGORIA_ID" \
  -F "imagen=@./foto.jpg"
```

4. Comprueba que la respuesta sea `200`, contenga `sugerencias`, `confianza` y
   `requiereRevision: true`. Si Groq rechaza la petición, revisa la consola del
   backend: se registra el estado y cuerpo del proveedor sin registrar la clave ni
   la imagen.