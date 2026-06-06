const { Schema, model } = require('mongoose')

const CedisSchema = new Schema(
  {
    cedis_id: { type: String, required: true, unique: true },
    nombre: String,
    pais: String,
    ciudad: String,
    direccion: String,
    telefono: String,
    id_businessunit: Number,
    estado: { type: String, default: 'activo' },
  },
  { timestamps: { createdAt: 'created_at' } }
)

module.exports = model('Cedis', CedisSchema)
