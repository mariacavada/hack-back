const { Schema, model } = require('mongoose')

const DashCacheSchema = new Schema(
  {
    tipo: { type: String, required: true },
    cedis_id: { type: String, default: 'global' },
    datos: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { updatedAt: 'updated_at' } }
)

DashCacheSchema.index({ tipo: 1, cedis_id: 1 }, { unique: true })

module.exports = model('DashCache', DashCacheSchema)
