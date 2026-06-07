const { Schema, model } = require('mongoose')

const TrackingPedidoSchema = new Schema(
  {
    id_pedido: { type: String, required: true, unique: true },
    customer_id: { type: String, index: true },
    eventos: [
      {
        event_type: {
          type: String,
          enum: ['asignado', 'cargando_camion', 'pedido_faltante', 'salio_centro', 'en_camino', 'entregado', 'cancelado'],
        },
        status:      String,
        descripcion: String,
        timestamp:   { type: Date, default: Date.now },
        driver_id:   { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
        coords:      { lat: Number, lng: Number },
        note:        String,
      },
    ],
    status_actual: { type: String, default: 'pendiente' },
    localizacion_actual: { lat: Number, lng: Number },
    eta_entrega: { type: Date, default: null },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

module.exports = model('TrackingPedido', TrackingPedidoSchema)
