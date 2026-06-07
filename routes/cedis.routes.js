const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const { getAllCedis, getCedisStock } = require('../controllers/cedis.controllers')

const router = Router()
router.use(verifyToken)

// GET /api/cedis  — lista todos los CEDIS activos (cualquier usuario logueado)
router.get('/', getAllCedis)

// GET /api/cedis/:cedis_id/stock  — stock disponible de un CEDIS específico
router.get('/:cedis_id/stock', getCedisStock)

module.exports = router
