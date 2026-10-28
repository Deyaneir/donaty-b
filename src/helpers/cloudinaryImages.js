import { v2 as cloudinary } from "cloudinary";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadImage = async (file, folder) => {
  if (!file) return null;
  if (Array.isArray(file) || !file.tempFilePath) {
    const error = new Error("Debes enviar un único archivo de imagen válido");
    error.statusCode = 400;
    throw error;
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    const error = new Error("La imagen debe ser JPG, PNG o WebP");
    error.statusCode = 400;
    throw error;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const error = new Error("La imagen no puede superar 5 MB");
    error.statusCode = 400;
    throw error;
  }
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    const error = new Error("La carga de imágenes no está configurada");
    error.statusCode = 503;
    throw error;
  }

  const result = await cloudinary.uploader.upload(file.tempFilePath, {
    folder,
    resource_type: "image",
  });
  return { imagenUrl: result.secure_url, imagenPublicId: result.public_id };
};

const deleteImage = async (publicId) => {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
};

export { uploadImage, deleteImage };