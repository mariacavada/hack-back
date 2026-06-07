const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

/**
 * Sube un buffer de imagen a Cloudinary y devuelve { url, public_id }.
 * @param {Buffer} buffer - el archivo en memoria (req.file.buffer con multer)
 * @param {string} folder - carpeta dentro de Cloudinary, ej. 'productos'
 */
function uploadImage(buffer, folder = 'productos') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => {
        if (err) return reject(err)
        resolve({ url: result.secure_url, public_id: result.public_id })
      }
    )
    stream.end(buffer)
  })
}

/**
 * Borra una imagen de Cloudinary por su public_id (útil al reemplazar/eliminar).
 */
function deleteImage(public_id) {
  if (!public_id) return Promise.resolve()
  return cloudinary.uploader.destroy(public_id)
}

module.exports = { uploadImage, deleteImage }
