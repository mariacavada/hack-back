const { Schema, model } = require('mongoose')

const ProductSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true },
    nombre: { type: String, required: true },
    linea: String,
    id_businessunit: Number,
    categoria: String,
    presentacion: String,
    precio_unitario: { type: Number, required: true, default: 0 },
    sustitutos_compatibles: [String],
    estado: { type: String, default: 'activo' },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

ProductSchema.index({ categoria: 1, estado: 1 })
ProductSchema.index({ id_businessunit: 1 })

module.exports = model('Product', ProductSchema)
