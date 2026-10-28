# Catalogo de categorias

Las rutas se montan con `app.use("/api", router)` en `src/server.js`; el router registra `/campanas` y `/categorias`. Por tanto, los prefijos reales son `/api/campanas` y `/api/categorias`.

## Rutas

| Metodo | Ruta | Acceso | Uso |
| --- | --- | --- | --- |
| GET | `/api/campanas/:campanaId/categorias` | Admin, donante, recolector | Lista categorias de esa campaña. Admin ve inactivas; los demás solo activas. |
| POST | `/api/campanas/:campanaId/categorias` | Admin | Crea una categoria perteneciente a esa campaña. |
| GET | `/api/categorias?campana=:campanaId` | Publico | Compatibilidad: lista categorias activas de una campaña activa. |
| GET | `/api/categorias/:id` | Admin, donante, recolector | Consulta el detalle de una categoria. |
| GET | `/api/categorias/:id/subcategorias` | Publico | Lista subcategorias activas de una categoria activa. |
| GET | `/api/categorias/:id/donaciones` | Admin, donante, recolector | Consulta historial filtrado por categoria y campaña, dentro del alcance del rol. |
| GET | `/api/categorias/admin/lista` | Admin | Lista todas las categorias, incluidas las inactivas y legacy. |
| POST | `/api/categorias` | Admin | Alternativa compatible; requiere `campana` en el JSON. |
| PATCH | `/api/categorias/:id` | Admin | Actualiza nombre, descripcion, icono o estado. No permite moverla a otra campaña. |
| DELETE | `/api/categorias/:id` | Admin | Elimina solo cuando no tiene donaciones asociadas; si las tiene, devuelve `409`. |

Las rutas de administracion requieren `Authorization: Bearer <access-token>` con rol `admin`.
Los nombres siguen siendo unicos por nombre normalizado, como define el indice unico existente; cada categoria, aun asi, queda asociada a una sola campaña. El backend no copia categorias entre campañas.

## Ejemplos

Crear categoria:

```http
POST /api/campanas/<campaign-id>/categorias
Authorization: Bearer <admin-token>
Content-Type: application/json
```

```json
{
  "nombre": "Ropa",
  "descripcion": "Prendas limpias y en buen estado",
  "iconKey": "shirt",
  "subcategorias": [
    { "nombre": "Abrigos", "iconKey": "coat" },
    { "nombre": "Calzado" }
  ]
}
```

La campaña se toma del path. El campo `campana` no debe enviarse para cambiar la pertenencia de una categoria.

Respuesta `201` (identificadores abreviados):

```json
{
  "categoria": {
    "_id": "<category-id>",
    "campana": "<campaign-id>",
    "nombre": "Ropa",
    "descripcion": "Prendas limpias y en buen estado",
    "iconKey": "shirt",
    "activa": true,
    "subcategorias": [
      { "_id": "<subcategory-id>", "nombre": "Abrigos", "activa": true },
      { "_id": "<subcategory-id>", "nombre": "Calzado", "activa": true }
    ]
  }
}
```

Consultar categorias:

```http
GET /api/categorias
```

Respuesta `200`:

```json
{
  "total": 1,
  "categorias": [
    {
      "_id": "<category-id>",
      "campana": "<campaign-id>",
      "nombre": "Ropa",
      "descripcion": "Prendas limpias y en buen estado",
      "iconKey": "shirt",
      "activa": true,
      "subcategorias": [
        { "_id": "<subcategory-id>", "nombre": "Abrigos", "iconKey": "coat", "activa": true }
      ]
    }
  ]
}
```

Donaciones nuevas pueden enviar el nombre o ID de la categoria. La subcategoria tambien acepta nombre o ID y debe pertenecer a esa categoria:

```json
{
  "tipo": "fisica",
  "campana": "<campaign-id>",
  "categoria": "<category-id>",
  "subcategoria": "<subcategory-id>",
  "descripcion": "Chaqueta en buen estado",
  "direccionEntrega": "Av. Ejemplo 123",
  "telefonoContacto": "0990000000"
}
```

La respuesta de donacion conserva `categoria` y `subcategoria` como nombres de texto e incluye `categoriaRef` para los registros nuevos. El campo historico `categoria` no cambia de tipo. Donantes consultan solo sus propias donaciones; recolectores consultan las asignadas o las que registraron; administradores consultan todas las de esa categoria.

Ejemplo de consulta del historial:

```http
GET /api/categorias/<category-id>/donaciones
Authorization: Bearer <access-token>
```

```json
{
  "categoria": { "_id": "<category-id>", "nombre": "Ropa" },
  "total": 1,
  "donaciones": [
    {
      "_id": "<donation-id>",
      "campana": "<campaign-id>",
      "categoria": "Ropa",
      "categoriaRef": "<category-id>",
      "estado": "pendiente",
      "descripcion": "Chaqueta en buen estado"
    }
  ]
}
```

Si hay donaciones asociadas, `DELETE /api/categorias/:id` responde `409` y conserva el historial. En ese caso el administrador puede desactivar con `PATCH` y `{"activa": false}`. Los nombres anteriores se conservan para mantener consultables los registros historicos cuyo campo categoria aun es texto.

## Compatibilidad de campañas

`categoriasPermitidas` es el campo preexistente de campañas y se mantiene por compatibilidad. Crear una categoria desde la ruta de la campaña la añade a esa lista. Las donaciones nuevas validan tanto la pertenencia `categoria.campana` como esa lista cuando no esta vacia.

```json
{
  "nombre": "Campaña de abrigo",
  "categoriasPermitidas": ["<category-id-1>", "<category-id-2>"]
}
```

Para Flutter, usa `GET /api/campanas/:campanaId/categorias` como fuente de opciones; no infieras la pertenencia desde `categoriasPermitidas` únicamente.

## Migracion opcional

Para asociar nombres existentes de donaciones a una campaña, ejecuta manualmente:

```sh
npm run migrate:categories
```

El script agrupa los nombres por sus campañas. Solo crea o asigna una categoria cuando los registros apuntan a una sola campaña existente; los nombres usados en varias campañas se omiten y se informan para resolucion manual. Tambien informa las donaciones sin campaña, que requieren asignacion manual. No elimina ni modifica donaciones. Requiere MongoDB disponible en `MONGODB_URI`; no se ejecuta automaticamente.