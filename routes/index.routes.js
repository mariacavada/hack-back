const { Router } = require('express')
const { getHealth, getPing } = require('../controllers/index.controllers')

const router = Router()

router.get('/', getHealth)
router.get('/ping', getPing)

module.exports = router
