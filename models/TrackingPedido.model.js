const { Schema, model } = require('mongoose')

const TrackingPedidoSchema = new Schema(
  {
    id_pedido: { type: String, required: true, unique: true },
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    eventos: [
      {
        status: String,
        descripcion: String,
        timestamp: { type: Date, default: Date.now },
        coords: { lat: Number, lng: Number },
      },
    ],
    status_actual: { type: String, default: 'pendiente' },
    localizacion_actual: { lat: Number, lng: Number },
    eta_entrega: { type: Date, default: null },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

module.exports = model('TrackingPedido', TrackingPedidoSchema)
