/**
 * Chatbot RAG — orquesta el pipeline completo:
 * pregunta → retrieve → prompt → Gemini → respuesta
 */

const { retrieve } = require('./retrieve.service')
const { askGeminiText } = require('../../utils/gemini')
const ChatbotSession = require('../../models/ChatbotSession.model')

/**
 * Responde una pregunta del usuario usando RAG.
 * @param {string} customer_id
 * @param {string} question
 * @param {string} session_id - ID de sesión existente (opcional)
 * @param {string} order_id   - Pedido específico de contexto (opcional)
 */
async function chat(customer_id, question, session_id = null, order_id = null) {
  // 1. Recuperar o crear sesión
  let session = session_id
    ? await ChatbotSession.findById(session_id)
    : null

  if (!session) {
    session = await ChatbotSession.create({
      user_id: customer_id,
      order_id: order_id || null,
      messages: [],
      context: {},
      started_at: new Date(),
    })
  }

  // 2. Historial reciente (últimas 6 mensajes para no saturar el prompt)
  const historial = session.messages.slice(-6)
  const historialTexto = historial
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`)
    .join('\n')

  // 3. Recuperar chunks relevantes de MongoDB Atlas Vector Search
  const sources = order_id
    ? ['order', 'faq']          // Si hay pedido específico, priorizar pedidos
    : ['order', 'product', 'faq', 'substitution']

  const chunks = await retrieve(question, {
    customer_id,
    limit: 5,
    sources,
  })

  const contexto = chunks.map((c) => c.text).join('\n\n---\n\n')

  // 4. Construir prompt con contexto recuperado
  const prompt = `
Eres un asistente amigable de Order Rescue, una app de distribución de bebidas en México.
Responde en español, de forma concisa y útil. Si no tienes información suficiente, dilo honestamente.
No inventes datos que no están en el contexto.

CONTEXTO RECUPERADO DE LA BASE DE DATOS:
${contexto || 'No se encontró información específica para esta pregunta.'}

${historialTexto ? `CONVERSACIÓN PREVIA:\n${historialTexto}\n` : ''}

PREGUNTA DEL CLIENTE: ${question}

Responde de forma natural y útil. Si el contexto tiene información del pedido, úsala para dar una respuesta precisa.
NO respondas en JSON, responde en texto natural.
`

  const respuesta = await askGeminiText(prompt)

  // 5. Guardar mensajes en la sesión
  const ahora = new Date()
  session.messages.push(
    { role: 'user', content: question, timestamp: ahora },
    { role: 'assistant', content: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta), timestamp: ahora }
  )
  await session.save()

  return {
    session_id: session._id,
    answer: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta),
    sources_used: chunks.map((c) => ({ source: c.source, score: c.score })),
  }
}

module.exports = { chat }
