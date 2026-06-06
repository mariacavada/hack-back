const { Schema, model } = require('mongoose')

const DemandForecastSchema = new Schema({
  cedis_id: { type: String, required: true, index: true },
  sku: { type: String, required: true, index: true },
  modelo: String,
  horizonte_dias: { type: Number, default: 30 },
  predicciones: [{ fecha: String, demanda: Number }],
  demanda_diaria_predicha: Number,
  demanda_semanal_predicha: Number,
  demanda_mensual_predicha: Number,
  temporada: String,
  confianza: { type: Number, min: 0, max: 1 },
  fecha_calculo: { type: Date, default: Date.now },
  valid_hasta: Date,
})

DemandForecastSchema.index({ cedis_id: 1, sku: 1, fecha_calculo: -1 })

module.exports = model('DemandForecast', DemandForecastSchema)
