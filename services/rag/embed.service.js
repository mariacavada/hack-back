const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

/**
 * Convierte un texto en un vector de 768 dimensiones usando Gemini.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  const result = await model.embedContent(text)
  return result.embedding.values
}

/**
 * Embeds múltiples textos en paralelo (máx 5 simultáneos para no saturar la API).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const results = []
  const BATCH_SIZE = 5
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const embeddings = await Promise.all(batch.map(embedText))
    results.push(...embeddings)
  }
  return results
}

module.exports = { embedText, embedBatch }
