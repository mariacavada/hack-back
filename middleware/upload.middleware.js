const multer = require('multer')

// Guarda el archivo en memoria (req.file.buffer) en vez de en disco,
// para subirlo directo a Cloudinary sin tocar el filesystem.
const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máx
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten archivos de imagen'))
    }
    cb(null, true)
  },
})

module.exports = upload
