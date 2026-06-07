/**
 * Chatbot RAG — orquesta el pipeline completo:
 * pregunta → retrieve → prompt → Gemini → respuesta
 */

const { retrieve } = require('./retrieve.service')
const { askGeminiText } = require('../../utils/gemini')
const ChatbotSession = require('../../models/ChatbotSession.model')
const Order = require('../../models/Order.model')

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

  // 3.5. Si el cliente no especificó un pedido (ej. "¿dónde está mi pedido?"
  // sin dar número/ID), el vector search puede traer chunks de varios pedidos
  // distintos y dejar al modelo sin saber a cuál se refiere → termina
  // pidiendo el ID en vez de responder. Le damos un "pedido de referencia"
  // explícito: el activo más reciente (o, si no tiene ninguno en curso, el
  // último que hizo) — así puede responder directo salvo que el cliente
  // aclare que se refiere a otro.
  let pedidoReferencia = null
  if (!order_id) {
    // "en curso" = todavía puede moverse (no es un estado terminal). 'incompleto'
    // y 'cancelado' ya están resueltos — un 'incompleto' de hace semanas no debe
    // ganarle a un pedido 'entregado' de hoy como referencia de "mi pedido".
    pedidoReferencia =
      (await Order.findOne({ customer_id, status_final: { $in: ['pendiente', 'confirmado', 'asignado', 'en_camino'] } })
        .sort({ fecha_pedido: -1 })
        .select('id_pedido status_final fecha_pedido fecha_entrega')
        .lean()) ||
      (await Order.findOne({ customer_id })
        .sort({ fecha_pedido: -1 })
        .select('id_pedido status_final fecha_pedido fecha_entrega')
        .lean())
  }

  const referenciaTexto = pedidoReferencia
    ? `\nPEDIDO DE REFERENCIA (el más relevante de este cliente ahorita mismo — úsalo cuando pregunte por "mi pedido" sin dar un número, salvo que el contexto recuperado claramente apunte a otro):\nID: ${pedidoReferencia.id_pedido}\nEstado: ${pedidoReferencia.status_final}${pedidoReferencia.fecha_entrega ? `\nFecha de entrega: ${new Date(pedidoReferencia.fecha_entrega).toISOString().slice(0, 10)}` : ''}\n`
    : ''

  // 4. Construir prompt con contexto recuperado
  const prompt = `
Eres un asistente amigable de Order Rescue, una app de distribución de bebidas en México.
Responde en español, de forma concisa y útil. Si no tienes información suficiente, dilo honestamente.
No inventes datos que no están en el contexto.

CONTEXTO RECUPERADO DE LA BASE DE DATOS:
${contexto || 'No se encontró información específica para esta pregunta.'}
${referenciaTexto}
${historialTexto ? `CONVERSACIÓN PREVIA:\n${historialTexto}\n` : ''}

PREGUNTA DEL CLIENTE: ${question}

Responde de forma natural y útil. Si el cliente pregunta de forma genérica por "mi pedido"
sin dar un número específico, usa el PEDIDO DE REFERENCIA (si lo hay) para responder
directamente con su estado — no le pidas el ID si ya tienes uno de referencia.
Si el contexto tiene información del pedido, úsala para dar una respuesta precisa.
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
