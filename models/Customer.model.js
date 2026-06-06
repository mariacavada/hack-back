const { Schema, model } = require('mongoose')

const CustomerSchema = new Schema(
  {
    customer_id: { type: String, unique: true, sparse: true },
    nombre_negocio: String,
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, required: true, select: false },
    telefono: String,
    tipo_cliente: String,
    pais: String,
    id_businessunit: Number,
    business_unit: String,
    cedis_asignado: { type: String, index: true },
    estado: { type: String, default: 'activo' },
    preferencias_notificacion: { type: Schema.Types.Mixed, default: {} },
    patrones_preferencia: { type: Schema.Types.Mixed, default: {} },
    last_login: Date,
  },
  { timestamps: { createdAt: 'created_at' } }
)

CustomerSchema.index({ cedis_asignado: 1, estado: 1 })

module.exports = model('Customer', CustomerSchema)
