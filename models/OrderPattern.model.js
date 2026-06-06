const { Schema, model } = require('mongoose')

const OrderPatternSchema = new Schema(
  {
    customer_id: { type: String, required: true, index: true },
    sku: { type: String, required: true, default: '__timing__' },
    model_type: { type: String, enum: ['timing', 'quantity'], default: 'timing' },
    cedis_id: String,
    gap_promedio_dias: Number,
    cantidad_promedio: Number,
    proximo_reorden: { type: Date, default: null },
    confianza: { type: Number, min: 0, max: 1 },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

OrderPatternSchema.index({ customer_id: 1, sku: 1 }, { unique: true })
OrderPatternSchema.index({ proximo_reorden: 1 })

module.exports = model('OrderPattern', OrderPatternSchema)
