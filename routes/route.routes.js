const { Router } = require('express')
const verifyToken  = require('../utils/jwt')
const requireRole  = require('../middleware/requireRole')
const {
  createRoute, getRoute, updateRoute,
  addRouteEvent, markLoading, markDeparture, markMissing,
} = require('../controllers/route.controllers')

const router = Router()
router.use(verifyToken)

// Admin: crear y ver rutas
router.post('/',    requireRole('admin'),           createRoute)
router.get('/:id',  requireRole('admin', 'driver'), getRoute)
router.patch('/:id',requireRole('admin', 'driver'), updateRoute)

// Repartidor: lifecycle de la ruta
router.post('/:routeId/events',   requireRole('driver'), addRouteEvent)
router.patch('/:routeId/load',    requireRole('driver'), markLoading)
router.patch('/:routeId/depart',  requireRole('driver'), markDeparture)
router.patch('/:routeId/missing', requireRole('driver'), markMissing)

module.exports = router
