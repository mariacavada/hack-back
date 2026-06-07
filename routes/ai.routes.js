const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const { getProducts, getUserOrders, getOrderStatus } = require('../controllers/ai.controllers')

const router = Router()
router.use(verifyToken)

// GET /api/ai/products — todos los productos (cualquier rol)
router.get('/products', getProducts)

// POST /api/ai/get-user-orders — pedidos de un cliente (admin)
router.post('/get-user-orders', requireRole('admin'), getUserOrders)

// POST /api/ai/get-order-status — status de un pedido (admin, customer, driver)
router.post('/get-order-status', requireRole('admin', 'customer', 'driver'), getOrderStatus)

module.exports = router
