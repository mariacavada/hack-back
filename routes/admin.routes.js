const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const upload = require('../middleware/upload.middleware')
const {
  getAllUsers,
  getUserById,
  getAllOrders,
  getOrderById,
  confirmOrder,
  assignDriver,
  getLowStock,
  getDepletionRisk,
  uploadProductPhoto,
  getDriverById,
  getDriverOrders,
  getDriverTodayRoute,
  getUserOrders,
  restockCedis,
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

// Pedidos por usuario
router.get('/users/:userId/orders', getUserOrders)

// Repartidores
router.get('/drivers/:driverId',            getDriverById)
router.get('/drivers/:driverId/orders',     getDriverOrders)
router.get('/drivers/:driverId/route/today',getDriverTodayRoute)

// Inventario / ML
router.get('/inventory/low-stock', getLowStock)
router.get('/inventory/depletion-risk', getDepletionRisk)
router.post('/inventory/restock', restockCedis)

// Productos
router.post('/products/:id/photo', upload.single('imagen'), uploadProductPhoto)

module.exports = router
