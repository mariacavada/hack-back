const { Schema, model } = require('mongoose')

const InventoryMvtSchema = new Schema({
  cedis_id: { type: String, required: true, index: true },
  sku: { type: String, required: true },
  tipo_movimiento: {
    type: String,
    enum: ['entrada', 'salida', 'reserva', 'liberacion', 'ajuste'],
    required: true,
  },
  cantidad: { type: Number, required: true },
  stock_antes: Number,
  stock_despues: Number,
  id_pedido: String,
  motivo: String,
  timestamp: { type: Date, default: Date.now },
})

InventoryMvtSchema.index({ cedis_id: 1, sku: 1, timestamp: -1 })

module.exports = model('InventoryMvt', InventoryMvtSchema)
