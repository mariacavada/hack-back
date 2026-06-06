const { Schema, model } = require('mongoose')

const SubstitutionLogSchema = new Schema({
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  customer_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  original_sku: { type: String, required: true },
  original_name: String,
  substitute_sku: { type: String, required: true },
  substitute_name: String,
  suggested_by: { type: String, enum: ['gemini', 'repartidor', 'admin'] },
  accepted_by_user: { type: Boolean, default: null },
  reason_unavailable: { type: String, enum: ['sin_stock', 'dañado', 'otro'], default: 'sin_stock' },
  logged_at: { type: Date, default: Date.now },
})

SubstitutionLogSchema.index({ original_sku: 1, accepted_by_user: 1 })

module.exports = model('SubstitutionLog', SubstitutionLogSchema)
