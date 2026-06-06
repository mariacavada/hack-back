const { Schema, model } = require('mongoose')

const ResultadoSchema = new Schema(
  {
    id_businessunit: Number,
    id_linea: { type: String, index: true },
    id_pedido: { type: String, index: true },
    sku_solicitado: { type: String, index: true },
    sku_solicitado_hash: String,
    nombre_sku_solicitado: String,
    sku_solicitado_cambio: String,
    sku_solicitado_cambio_hash: String,
    nombre_sku_solicitado_cambio: String,
    notificado_al_cliente: { type: Boolean, default: false },
    respuesta_cliente: String,
    resultado: String,
    features_ml: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'created_at' } }
)

ResultadoSchema.index({ sku_solicitado: 1, respuesta_cliente: 1 })

module.exports = model('Resultado', ResultadoSchema)
