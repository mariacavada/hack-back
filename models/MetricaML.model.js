const { Schema, model } = require('mongoose')

const MetricaMLSchema = new Schema({
  modelo: { type: String, required: true },
  tipo: String,
  version: String,
  precision: Number,
  recall: Number,
  f1_score: Number,
  rmse: Number,
  mae: Number,
  muestras: Number,
  fecha: { type: Date, default: Date.now },
})

MetricaMLSchema.index({ modelo: 1, fecha: -1 })

module.exports = model('MetricaML', MetricaMLSchema)
