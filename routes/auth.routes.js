const { Router } = require('express')
const { register, login, me } = require('../controllers/auth.controllers')
const { verifyToken } = require('../middleware/auth.middleware')

const router = Router()

// Public
router.post('/register', register)
router.post('/login',    login)

// Protected — returns current user data from token
router.get('/me', verifyToken, me)

module.exports = router