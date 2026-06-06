const { Schema, model } = require('mongoose')

const StockPredictSchema = new Schema(
  {
    cedis_id: { type: String, required: true },
    sku: { type: String, required: true },
    stock_actual: { type: Number, default: 0 },
    rotacion_diaria_real: Number,
    demanda_diaria_predicha: Number,
    dias_estimados_agotamiento: Number,
    fecha_agotamiento_predicha: { type: Date, default: null },
    cantidad_reorden_sugerida: { type: Number, default: 0 },
    nivel_alerta: {
      type: String,
      enum: ['ok', 'bajo', 'critico'],
      default: 'ok',
    },
    confianza: { type: Number, min: 0, max: 1 },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

StockPredictSchema.index({ cedis_id: 1, sku: 1 }, { unique: true })
StockPredictSchema.index({ nivel_alerta: 1 })

module.exports = model('StockPredict', StockPredictSchema)
