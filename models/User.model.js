const { Schema, model } = require('mongoose')

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: String,
    name: { type: String, required: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['usuario', 'admin', 'repartidor'], required: true },

    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      coords: { lat: Number, lng: Number },
    },
    substitution_profile: [
      {
        original_sku: String,
        preferred_substitutes: [
          { sku: String, name: String, times_accepted: Number, times_rejected: Number },
        ],
        last_updated: Date,
      },
    ],
    purchase_patterns: [
      {
        sku: String,
        name: String,
        avg_quantity: Number,
        avg_days_between_orders: Number,
        last_ordered: Date,
        next_predicted_order: Date,
      },
    ],
    notification_prefs: {
      reorder_reminder: { type: Boolean, default: true },
      substitution_alert: { type: Boolean, default: true },
      order_tracking: { type: Boolean, default: true },
    },

    vehicle: String,
    cedis: String,
    current_location: { lat: Number, lng: Number },
    is_available: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

module.exports = model('User', UserSchema)
