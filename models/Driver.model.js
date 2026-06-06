const { Schema, model } = require('mongoose')

const DriverSchema = new Schema(
  {
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, required: true, select: false },
    telefono: String,
    cedis_id: { type: String, index: true },
    vehiculo_placa: String,
    calificacion_promedio: { type: Number, default: 0 },
    ubicacion_actual: { lat: Number, lng: Number },
    estado: { type: String, default: 'activo' },
    last_login: Date,
  },
  { timestamps: { createdAt: 'created_at' } }
)

module.exports = model('Driver', DriverSchema)
