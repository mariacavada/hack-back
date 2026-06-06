const { chat } = require('../services/rag/chatbot.service')
const { indexOrder, indexAllProducts, indexCustomerSubstitutions, indexFAQ } = require('../services/rag/indexer.service')
const ChatbotSession = require('../models/ChatbotSession.model')

// POST /api/chatbot/message
// Enviar un mensaje al chatbot
const sendMessage = async (req, res) => {
  try {
    const { question, session_id, order_id } = req.body
    if (!question?.trim()) return res.status(400).json({ message: 'question es requerido' })

    const result = await chat(
      req.decoded.id,
      question.trim(),
      session_id || null,
      order_id || null
    )

    res.json(result)
  } catch (err) {
    console.error('[Chatbot]', err.message)
    res.status(500).json({ message: 'Error en el chatbot', error: err.message })
  }
}

// GET /api/chatbot/sessions
// Ver mis sesiones de chat anteriores
const getMySessions = async (req, res) => {
  try {
    const sessions = await ChatbotSession.find({ user_id: req.decoded.id })
      .sort({ started_at: -1 })
      .limit(20)
      .select('started_at ended_at order_id messages')
    res.json(sessions)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/chatbot/sessions/:id
// Ver historial de una sesión
const getSession = async (req, res) => {
  try {
    const session = await ChatbotSession.findOne({
      _id: req.params.id,
      user_id: req.decoded.id,
    })
    if (!session) return res.status(404).json({ message: 'Sesión no encontrada' })
    res.json(session)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// ── INDEXING (admin/interno) ──────────────────────────────────────────────────

// POST /api/chatbot/index/order/:order_id
const indexOrderEndpoint = async (req, res) => {
  try {
    await indexOrder(req.params.order_id)
    res.json({ message: 'Pedido indexado en el RAG' })
  } catch (err) {
    res.status(500).json({ message: 'Error al indexar', error: err.message })
  }
}

// POST /api/chatbot/index/products
const indexProductsEndpoint = async (req, res) => {
  try {
    await indexAllProducts()
    res.json({ message: 'Productos indexados en el RAG' })
  } catch (err) {
    res.status(500).json({ message: 'Error al indexar', error: err.message })
  }
}

// POST /api/chatbot/index/faq
const indexFAQEndpoint = async (req, res) => {
  try {
    await indexFAQ()
    res.json({ message: 'FAQs indexadas en el RAG' })
  } catch (err) {
    res.status(500).json({ message: 'Error al indexar', error: err.message })
  }
}

// POST /api/chatbot/index/customer/:customer_id/substitutions
const indexSubstitutionsEndpoint = async (req, res) => {
  try {
    await indexCustomerSubstitutions(req.params.customer_id)
    res.json({ message: 'Sustituciones indexadas en el RAG' })
  } catch (err) {
    res.status(500).json({ message: 'Error al indexar', error: err.message })
  }
}

module.exports = {
  sendMessage,
  getMySessions,
  getSession,
  indexOrderEndpoint,
  indexProductsEndpoint,
  indexFAQEndpoint,
  indexSubstitutionsEndpoint,
}
