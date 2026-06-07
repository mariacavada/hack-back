const { Schema, model } = require('mongoose')

const NotificationSchema = new Schema(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    id_pedido: { type: String, index: true },
    tipo: {
      type: String,
      enum: [
        'product_unavailable',
        'reorder_reminder',
        'substitution_suggestion',
        'sustitucion',
        'incidencia',
        'order_status',
        'low_stock',
        'depletion_alert',
      ],
      required: true,
    },
    titulo: { type: String, required: true },
    mensaje: { type: String, required: true },
    canales: { type: Schema.Types.Mixed, default: { in_app: true } },
    estado: { type: String, enum: ['pendiente', 'enviada', 'leida'], default: 'pendiente' },
    prioridad: { type: String, enum: ['baja', 'media', 'alta'], default: 'media' },
    expiracion: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'created_at' } }
)

NotificationSchema.index({ customer_id: 1, estado: 1, created_at: -1 })

module.exports = model('Notification', NotificationSchema)
