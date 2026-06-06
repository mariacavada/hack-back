const jwt = require('jsonwebtoken')

/**
 * Express middleware — validates Bearer JWT.
 * Attaches decoded payload to req.user.
 */
const verifyToken = (req, res, next) => {
  const header = req.headers['authorization'] ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ message: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT)
    req.user = decoded   // { id, rol, iat, exp }
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

module.exports = { verifyToken }