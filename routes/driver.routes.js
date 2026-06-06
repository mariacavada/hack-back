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
} = require('../controllers/driver.controllers')

const router = Router()
router.use(verifyToken, requireRole('driver'))

// Pedidos
router.get('/orders', getAssignedOrders)
router.patch('/orders/:id/status', updateOrderStatus)

// Incidencias
router.post('/orders/:id/incident', reportIncident)

// Ruta del día
router.post('/route/start', startDayRoute)
router.get('/route/today', getTodayRoute)
router.patch('/route/:ruta_id/stop/:stop_number/complete', completeStop)

module.exports = router
