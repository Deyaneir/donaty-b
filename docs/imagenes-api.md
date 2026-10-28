# Imagenes de campañas y donaciones

Los endpoints existentes conservan sus URLs. Para enviar una imagen, usa `multipart/form-data`, conserva los campos actuales como partes de formulario y agrega opcionalmente un archivo llamado `imagen`.

| Metodo | Endpoint | Imagen |
| --- | --- | --- |
| POST | `/api/campanas` | Opcional `imagen` |
| PATCH | `/api/campanas/:id` | Opcional `imagen`; si se omite, conserva la imagen actual |
| POST | `/api/donacion` | Opcional `imagen` |
| POST | `/api/donacion/registrar-por-recolector` | Opcional `imagen` |
| PATCH | `/api/donacion/:id` | Opcional `imagen`; reemplaza la imagen actual |

Las rutas conservan sus permisos y sus campos de texto existentes. En actualizaciones, no enviar `imagen` deja intacta la imagen actual. Al reemplazarla, se elimina de Cloudinary la imagen anterior después de guardar correctamente el documento. Las eliminaciones existentes de donaciones también eliminan su imagen asociada.

Se aceptan JPG, PNG y WebP hasta 5 MB. El servidor usa las credenciales ya configuradas por `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`, almacenando los archivos en `donaty/campanas` y `donaty/donaciones`. La respuesta del recurso contiene `imagenUrl` y `imagenPublicId`; el cliente debe mostrar `imagenUrl` y no debe modificar `imagenPublicId`.

Ejemplo cURL de creación de donación (mantén el resto de campos que exige tu flujo):

```sh
curl -X POST "$API_URL/api/donacion" \
  -H "Authorization: Bearer $TOKEN" \
  -F "tipo=fisica" \
  -F "campana=<campaign-id>" \
  -F "categoria=<category-id>" \
  -F "descripcion=Chaqueta en buen estado" \
  -F "direccionEntrega=Av. Ejemplo 123" \
  -F "telefonoContacto=0990000000" \
  -F "imagen=@./chaqueta.jpg;type=image/jpeg"
```

Las credenciales reales no se incluyen en el repositorio ni se devuelven en las respuestas. MongoDB y Cloudinary deben estar configurados en el entorno de ejecución para probar persistencia y carga real.