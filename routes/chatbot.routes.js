const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const {
  sendMessage,
  getMySessions,
  getSession,
  indexOrderEndpoint,
  indexProductsEndpoint,
  indexFAQEndpoint,
  indexSubstitutionsEndpoint,
} = require('../controllers/chatbot.controllers')

const router = Router()
router.use(verifyToken)

// ── CHATBOT (customer) ────────────────────────────────────────────────────────

// Enviar mensaje → respuesta RAG
router.post('/message', requireRole('customer'), sendMessage)

// Historial de sesiones
router.get('/sessions', requireRole('customer'), getMySessions)
router.get('/sessions/:id', requireRole('customer'), getSession)

// ── INDEXING (admin) ──────────────────────────────────────────────────────────

router.post('/index/order/:order_id', requireRole('admin'), indexOrderEndpoint)
router.post('/index/products', requireRole('admin'), indexProductsEndpoint)
router.post('/index/faq', requireRole('admin'), indexFAQEndpoint)
router.post('/index/customer/:customer_id/substitutions', requireRole('admin'), indexSubstitutionsEndpoint)

module.exports = router
