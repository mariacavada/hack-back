const { Router } = require('express')
const {
  trainCustomer, trainAll, getNextOrder,
  suggestCustomer, getSuggestion, trainFull,
} = require('../controllers/ml.controllers')

const router = Router()

// Modelo A — cuándo
router.post('/train/all', trainAll)
router.post('/train/:customerId', trainCustomer)
router.get('/next-order/:customerId', getNextOrder)

// Modelo B — qué y cuánto
router.post('/suggest/:customerId', suggestCustomer)
router.get('/suggest/:customerId', getSuggestion)

// Combo — ambos a la vez
router.post('/train-full/:customerId', trainFull)

module.exports = router
