const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const { createOrder, getMyOrders, getOrderDetail, respondSubstitution } = require('../controllers/order.controllers')

const router = Router()
router.use(verifyToken)

// Crear pedido (usuario)
router.post('/', requireRole('usuario'), createOrder)

// Mis pedidos + tracking (usuario)
router.get('/my', requireRole('usuario'), getMyOrders)

// Detalle de pedido (usuario, admin, repartidor)
router.get('/:id', requireRole('usuario', 'admin', 'repartidor'), getOrderDetail)

// Responder sustitución (usuario)
router.patch('/:id/substitution', requireRole('usuario'), respondSubstitution)

module.exports = router
