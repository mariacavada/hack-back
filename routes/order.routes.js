const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const { createOrder, getMyOrders, getOrderDetail, respondSubstitution } = require('../controllers/order.controllers')

const router = Router()
router.use(verifyToken)

// Crear pedido (customer)
router.post('/', requireRole('customer'), createOrder)

// Mis pedidos + tracking (customer)
router.get('/my', requireRole('customer'), getMyOrders)

// Detalle de pedido (customer, admin, driver)
router.get('/:id', requireRole('customer', 'admin', 'driver'), getOrderDetail)

// Responder sustitución (customer)
router.patch('/:id/substitution', requireRole('customer'), respondSubstitution)

module.exports = router
