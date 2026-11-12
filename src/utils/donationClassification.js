const classificationError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const parseProducts = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw classificationError("Los productos clasificados no tienen un formato válido");
  }
};

const normalizeProduct = (product, index, recolector, fecha, { legacy = false } = {}) => {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw classificationError(`El producto clasificado ${index + 1} no es válido`);
  }
  const categoria = String(product.categoria ?? "").trim();
  const producto = String(product.producto ?? "").trim();
  const nombreBien = String(product.nombreBien ?? "").trim();
  if (!categoria || categoria.length > 160) {
    throw classificationError(`La categoría del producto ${index + 1} es obligatoria`);
  }
  if (!producto || producto.length > 160) {
    throw classificationError(`El producto ${index + 1} es obligatorio`);
  }
  if (!nombreBien || nombreBien.length > 255) {
    throw classificationError(`El nombre del bien ${index + 1} es obligatorio`);
  }

  const rawQuantity = product.cantidad;
  let cantidad = null;
  if (rawQuantity !== undefined && rawQuantity !== null && rawQuantity !== "") {
    cantidad = typeof rawQuantity === "number"
      ? rawQuantity
      : Number(String(rawQuantity).trim());
    if (!Number.isSafeInteger(cantidad) || cantidad < 1) {
      throw classificationError(`La cantidad del producto ${index + 1} debe ser un entero positivo`);
    }
  } else if (!legacy) {
    throw classificationError(`La cantidad del producto ${index + 1} es obligatoria`);
  }

  return {
    categoria,
    producto,
    nombreBien,
    cantidad,
    recolector,
    fecha,
  };
};

const normalizeClassifiedProducts = (
  value,
  donation,
  recolector,
  fecha = new Date()
) => {
  const parsed = parseProducts(value);
  const legacy = parsed === undefined || parsed === null;
  const source = legacy
    ? [{
        categoria: donation.subcategoria || donation.categoria,
        producto: donation.nombreBien,
        nombreBien: donation.nombreBien,
        cantidad: donation.metadata?.cantidad,
      }]
    : parsed;
  if (!Array.isArray(source) || source.length === 0) {
    throw classificationError("Debes clasificar al menos un producto");
  }

  const products = source.map((product, index) =>
    normalizeProduct(product, index, recolector, fecha, { legacy })
  );
  const productKeys = products.map((product) =>
    [
      product.categoria,
      product.producto,
      product.nombreBien,
      product.cantidad ?? "",
    ].map((part) => String(part).trim().toLocaleLowerCase()).join("\u0000")
  );
  if (new Set(productKeys).size !== productKeys.length) {
    throw classificationError("No repitas productos clasificados idénticos", 409);
  }
  return products;
};

const buildClassificationByPoint = (donations, points) => {
  const pointById = new Map(
    (points || []).map((point) => [String(point._id), point])
  );
  const groups = new Map();

  for (const donation of donations || []) {
    const pointId = String(donation.puntoRecoleccionRef ?? "");
    const point = pointById.get(pointId);
    if (!point) continue;

    let pointGroup = groups.get(pointId);
    if (!pointGroup) {
      pointGroup = {
        puntoRecoleccion: { _id: pointId, nombre: point.nombre ?? "" },
        categorias: new Map(),
      };
      groups.set(pointId, pointGroup);
    }

    const donor = donation.donante || donation.donanteExterno || {
      nombre: donation.nombreDonante ?? "",
      apellido: "",
    };
    const productos = donation.productosClasificados || [];
    for (const product of productos) {
      const categoryName = String(product.categoria ?? "").trim();
      const categoryKey = categoryName.toLocaleLowerCase();
      if (!categoryKey) continue;

      let category = pointGroup.categorias.get(categoryKey);
      if (!category) {
        category = {
          categoria: categoryName,
          cantidadTotal: 0,
          detalles: [],
        };
        pointGroup.categorias.set(categoryKey, category);
      }

      const quantity = Number.isSafeInteger(product.cantidad) && product.cantidad > 0
        ? product.cantidad
        : 0;
      category.cantidadTotal += quantity;
      category.detalles.push({
        donacionId: String(donation._id),
        donante: {
          nombre: donor.nombre ?? "",
          apellido: donor.apellido ?? "",
        },
        producto: product.producto ?? "",
        nombreBien: product.nombreBien ?? "",
        cantidad: product.cantidad ?? null,
      });
    }
  }

  return [...groups.values()].map((pointGroup) => ({
    puntoRecoleccion: pointGroup.puntoRecoleccion,
    categorias: [...pointGroup.categorias.values()],
  }));
};

export { buildClassificationByPoint, normalizeClassifiedProducts };
