const { Schema, model } = require('mongoose')

const ChatbotSessionSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  messages: [
    {
      role: { type: String, enum: ['user', 'assistant'], required: true },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  context: { type: Schema.Types.Mixed, default: {} },
  started_at: { type: Date, default: Date.now },
  ended_at: { type: Date, default: null },
})

module.exports = model('ChatbotSession', ChatbotSessionSchema)
