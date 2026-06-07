const { Schema, model } = require('mongoose')

const DeliveryRouteSchema = new Schema(
  {
    driver_id: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    id_pedido: { type: String, index: true },
    cedis_id: { type: String, index: true },
    current_status: {
      type: String,
      enum: ['programado', 'cargando', 'faltante', 'salio', 'en_camino', 'entregado', 'cancelado'],
      default: 'programado',
      index: true,
    },
    estado: { type: String, default: 'pendiente' },
    started_at:   { type: Date, default: null },
    loaded_at:    { type: Date, default: null },
    departed_at:  { type: Date, default: null },
    finished_at:  { type: Date, default: null },
    missing_orders: { type: Boolean, default: false },
    comments:       { type: String, default: null },
    paradas: [
      {
        id_pedido: String,
        stop_number: Number,
        direccion: String,
        coords: { lat: Number, lng: Number },
        eta: { type: Date, default: null },
        llegada_real: { type: Date, default: null },
        status: {
          type: String,
          enum: ['pendiente', 'en_camino', 'completado'],
          default: 'pendiente',
        },
      },
    ],
    metricas_ruta: { type: Schema.Types.Mixed, default: {} },
    fecha: { type: Date, required: true },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

DeliveryRouteSchema.index({ driver_id: 1, fecha: 1 })

module.exports = model('DeliveryRoute', DeliveryRouteSchema)
