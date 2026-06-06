/**
 * Middleware de autorización por rol.
 * Requiere que verifyToken corra primero (pone req.decoded).
 * Uso: router.get('/ruta', verifyToken, requireRole('admin'), handler)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.decoded) return res.status(401).json({ message: 'No autenticado' })
  // El JWT usa "rol" (no "role")
  const userRole = req.decoded.rol || req.decoded.role
  if (!roles.includes(userRole)) {
    return res.status(403).json({ message: `Acceso denegado. Se requiere rol: ${roles.join(' o ')}` })
  }
  next()
}

module.exports = requireRole
