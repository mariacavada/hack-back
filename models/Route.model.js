const { Schema, model } = require('mongoose')

const RouteSchema = new Schema({
  repartidor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  stops: [
    {
      order_id: { type: Schema.Types.ObjectId, ref: 'Order' },
      stop_number: Number,
      address: {
        street: String,
        coords: { lat: Number, lng: Number },
      },
      estimated_arrival: Date,
      actual_arrival: { type: Date, default: null },
      status: {
        type: String,
        enum: ['pendiente', 'en_camino', 'completado'],
        default: 'pendiente',
      },
    },
  ],
  total_distance_km: Number,
  optimized_at: { type: Date, default: Date.now },
})

RouteSchema.index({ repartidor_id: 1, date: 1 })

module.exports = model('Route', RouteSchema)
