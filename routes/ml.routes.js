const { Router } = require('express')
const { trainCustomer, trainAll, getNextOrder } = require('../controllers/ml.controllers')

const router = Router()

router.post('/train/all', trainAll)
router.post('/train/:customerId', trainCustomer)
router.get('/next-order/:customerId', getNextOrder)

module.exports = router
