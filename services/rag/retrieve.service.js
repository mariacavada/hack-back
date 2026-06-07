/**
 * Retriever — busca los chunks más relevantes usando MongoDB Atlas Vector Search.
 *
 * IMPORTANTE: Antes de usar, crear el índice en Atlas:
 * Ver instrucciones al final de este archivo.
 */

const { embedText } = require('./embed.service')
const KnowledgeChunk = require('../../models/KnowledgeChunk.model')

/**
 * Busca los chunks más similares a la pregunta del usuario.
 * @param {string} query - Pregunta del usuario
 * @param {object} opts
 * @param {string} opts.customer_id - Filtra chunks del cliente (opcional)
 * @param {number} opts.limit       - Cuántos chunks retornar (default 5)
 * @param {string[]} opts.sources   - Filtrar por tipo: ['order','product','faq',...]
 */
async function retrieve(query, { customer_id, limit = 5, sources } = {}) {
  const queryEmbedding = await embedText(query)

  // Filtro de pre-filtrado (reduce el espacio de búsqueda)
  const preFilter = {}
  if (sources?.length) preFilter.source = { $in: sources }
  if (customer_id) {
    // Chunks del cliente O chunks globales (productos, FAQ)
    preFilter.$or = [
      { customer_id: String(customer_id) },
      { source: { $in: ['product', 'faq'] } },
    ]
  }

  const pipeline = [
    {
      $vectorSearch: {
        index: 'knowledge_vector_index',   // nombre del índice en Atlas
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: limit * 10,         // candidatos a evaluar (mayor = más preciso)
        limit,
        ...(Object.keys(preFilter).length ? { filter: preFilter } : {}),
      },
    },
    {
      $project: {
        text: 1,
        source: 1,
        source_id: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
        _id: 0,
      },
    },
  ]

  const results = await KnowledgeChunk.aggregate(pipeline)
  return results
}

module.exports = { retrieve }

/*
 * ─── INSTRUCCIONES PARA CREAR EL ÍNDICE EN ATLAS ──────────────────────────────
 *
 * 1. Ve a MongoDB Atlas → tu cluster → "Atlas Search" tab
 * 2. Click "Create Search Index"
 * 3. Selecciona "Atlas Vector Search" (no "Atlas Search")
 * 4. Collection: order_rescue.knowledgechunks
 * 5. Pega este JSON como definición del índice:
 *
 * {
 *   "fields": [
 *     {
 *       "type": "vector",
 *       "path": "embedding",
 *       "numDimensions": 3072,
 *       "similarity": "cosine"
 *     },
 *     {
 *       "type": "filter",
 *       "path": "source"
 *     },
 *     {
 *       "type": "filter",
 *       "path": "customer_id"
 *     }
 *   ]
 * }
 *
 * 6. Nombre del índice: knowledge_vector_index
 * 7. Click "Create" → tarda ~2 minutos en activarse
 * ──────────────────────────────────────────────────────────────────────────────
 */
