const { Router } = require('express')
const verifyToken  = require('../utils/jwt')
const requireRole  = require('../middleware/requireRole')
const {
  getMapOverview,
  assignDriver,
  getDriversLocation,
  updateDriverLocation,
} = require('../controllers/map.controllers')

const router = Router()
router.use(verifyToken)

// Vista general del mapa (admin)
router.get('/overview', requireRole('admin'), getMapOverview)

// Asignar repartidor con Gemini (admin)
router.post('/assign-driver', requireRole('admin'), assignDriver)

// Ubicaciones de repartidores (admin, driver)
router.get('/drivers', requireRole('admin', 'driver'), getDriversLocation)

// Repartidor actualiza su posición (driver)
router.patch('/driver/location', requireRole('driver'), updateDriverLocation)

module.exports = router
