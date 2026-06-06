const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const { getMyNotifications, markAsRead, markAllAsRead } = require('../controllers/notification.controllers')

const router = Router()
router.use(verifyToken)

router.get('/', getMyNotifications)
router.patch('/read-all', markAllAsRead)   // antes de /:id para evitar conflicto
router.patch('/:id/read', markAsRead)

module.exports = router
