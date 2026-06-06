/**
 * Middleware de autorización por rol.
 * Requiere que verifyToken corra primero (pone req.decoded).
 * Uso: router.get('/ruta', verifyToken, requireRole('admin'), handler)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.decoded) return res.status(401).json({ message: 'No autenticado' })
  if (!roles.includes(req.decoded.role)) {
    return res.status(403).json({ message: `Acceso denegado. Se requiere rol: ${roles.join(' o ')}` })
  }
  next()
}

module.exports = requireRole
