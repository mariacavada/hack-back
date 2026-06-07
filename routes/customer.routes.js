const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const Customer = require('../models/Customer.model')

const router = Router()
router.use(verifyToken, requireRole('customer'))

// GET /api/customer/me
router.get('/me', async (req, res) => {
  try {
    const customer = await Customer.findById(req.decoded.id)
      .select('-password_hash').lean()
    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' })
    res.json(customer)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
})

// PATCH /api/customer/me/location
// Body: { lat, lng, direccion?, municipio? }
router.patch('/me/location', async (req, res) => {
  try {
    const { lat, lng, direccion, municipio } = req.body
    if (lat == null || lng == null) {
      return res.status(400).json({ message: 'lat y lng son requeridos' })
    }

    const customer = await Customer.findByIdAndUpdate(
      req.decoded.id,
      { ubicacion: { lat, lng, direccion: direccion || null, municipio: municipio || null } },
      { new: true, returnDocument: 'after' }
    ).select('nombre_negocio ubicacion')

    if (!customer) return res.status(404).json({ message: 'Cliente no encontrado' })
    res.json({ message: 'Ubicación actualizada', ubicacion: customer.ubicacion })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
})

module.exports = router
