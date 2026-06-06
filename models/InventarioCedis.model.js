const { Schema, model } = require('mongoose')

const InventarioCedisSchema = new Schema(
  {
    cedis_id: { type: String, required: true, index: true },
    sku: { type: String, required: true, index: true },
    stock_disponible: { type: Number, default: 0 },
    stock_reservado: { type: Number, default: 0 },
    stock_minimo: { type: Number, default: 0 },
    stock_critico: { type: Number, default: 0 },
    stock_maximo: Number,
    ultima_entrada: Date,
    ultima_salida: Date,
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

InventarioCedisSchema.index({ cedis_id: 1, sku: 1 }, { unique: true })

module.exports = model('InventarioCedis', InventarioCedisSchema)
