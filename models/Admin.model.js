const { Schema, model } = require('mongoose')

const AdminSchema = new Schema(
  {
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, required: true, select: false },
    nivel: { type: String, default: 'operador' },
    cedis_asignados: [String],
    permisos: [String],
    last_login: Date,
  },
  { timestamps: { createdAt: 'created_at' } }
)

module.exports = model('Admin', AdminSchema)
