const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const { createOrder, getMyOrders, getOrderDetail, respondSubstitution, getOrderStatus, updateOrderStatusAdmin, markDelivered } = require('../controllers/order.controllers')

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

// Estado resumido del pedido (customer)
router.get('/:id/status', requireRole('customer', 'admin', 'driver'), getOrderStatus)

// Admin actualiza estado
router.patch('/:id/status', requireRole('admin'), updateOrderStatusAdmin)

// Repartidor marca entrega
router.patch('/:id/deliver', requireRole('driver'), markDelivered)

module.exports = router
