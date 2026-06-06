const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const {
  getAllUsers,
  getUserById,
  getAllOrders,
  getOrderById,
  confirmOrder,
  assignDriver,
  getLowStock,
  getDepletionRisk,
} = require('../controllers/admin.controllers')

const router = Router()
router.use(verifyToken, requireRole('admin'))

// Usuarios
router.get('/users', getAllUsers)
router.get('/users/:id', getUserById)

// Pedidos
router.get('/orders', getAllOrders)
router.get('/orders/:id', getOrderById)
router.patch('/orders/:id/confirm', confirmOrder)
router.patch('/orders/:id/assign', assignDriver)

// Inventario / ML
router.get('/inventory/low-stock', getLowStock)
router.get('/inventory/depletion-risk', getDepletionRisk)

module.exports = router
