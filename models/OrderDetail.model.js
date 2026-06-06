const { Schema, model } = require('mongoose')

const OrderDetailSchema = new Schema({
  id_linea: { type: String, unique: true, sparse: true },
  id_pedido: { type: String, required: true, index: true },
  sku_solicitado: { type: String, index: true },
  nombre_sku_solicitado: String,
  quantity: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ['registrado', 'entregado', 'faltante', 'sustituido'],
    default: 'registrado',
  },
})

OrderDetailSchema.index({ id_pedido: 1, sku_solicitado: 1 })

module.exports = model('OrderDetail', OrderDetailSchema)
