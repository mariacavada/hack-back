const { Schema, model } = require('mongoose')

/**
 * Colección que almacena los chunks de texto con sus embeddings.
 * Gemini text-embedding-004 produce vectores de 768 dimensiones.
 */
const KnowledgeChunkSchema = new Schema({
  // De dónde viene este chunk
  source: {
    type: String,
    enum: ['product', 'order', 'substitution', 'customer', 'faq'],
    required: true,
    index: true,
  },
  source_id: String,       // _id o id_pedido del documento original
  customer_id: String,     // para filtrar chunks por cliente

  // Texto legible que se manda a Gemini como contexto
  text: { type: String, required: true },

  // Metadata útil para el response
  metadata: { type: Schema.Types.Mixed, default: {} },

  // Vector de 768 dimensiones generado por Gemini text-embedding-004
  embedding: { type: [Number], required: true },

  updated_at: { type: Date, default: Date.now },
})

// Índice para búsqueda exacta por fuente/cliente
KnowledgeChunkSchema.index({ source: 1, customer_id: 1 })

module.exports = model('KnowledgeChunk', KnowledgeChunkSchema)
