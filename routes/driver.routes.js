const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const {
  getAssignedOrders,
  updateOrderStatus,
  reportIncident,
  startDayRoute,
  completeStop,
  getTodayRoute,
  getCedis,
  getCustomerLocation,
} = require('../controllers/driver.controllers')

const router = Router()
router.use(verifyToken, requireRole('driver'))

// Cedis del repartidor
router.get('/cedis', getCedis)

// Pedidos
router.get('/orders', getAssignedOrders)
router.get('/orders/:id/customer-location', getCustomerLocation)
router.patch('/orders/:id/status', updateOrderStatus)

// Incidencias
router.post('/orders/:id/incident', reportIncident)

// Ruta del día
router.post('/route/start', startDayRoute)
router.get('/route/today', getTodayRoute)
router.patch('/route/:ruta_id/stop/:stop_number/complete', completeStop)

module.exports = router
