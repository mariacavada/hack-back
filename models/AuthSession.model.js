const { Schema, model } = require('mongoose')

const AuthSessionSchema = new Schema(
  {
    rol: { type: String, enum: ['customer', 'admin', 'driver'], required: true },
    ref_id: { type: Schema.Types.ObjectId, required: true, index: true },
    jwt_token: { type: String },
    refresh_token: String,
    expires_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: 'created_at' } }
)

AuthSessionSchema.index({ jwt_token: 1 }, { unique: true, sparse: true })

module.exports = model('AuthSession', AuthSessionSchema)
