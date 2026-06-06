const { Router } = require('express')
const { predictStockDepletion, predictAllStockForCedis } = require('../services/ml/stockPredict.service')
const { computeReorderPattern, computeAllPatternsForCustomer } = require('../services/ml/reorderPattern.service')
const { suggestSubstitutes } = require('../services/ml/substitution.service')

const router = Router()

// POST /api/ml/stock-predict  — Body: { cedis_id, sku }
router.post('/stock-predict', async (req, res) => {
  try {
    const { cedis_id, sku } = req.body
    if (!cedis_id || !sku) return res.status(400).json({ error: 'cedis_id y sku son requeridos' })
    const result = await predictStockDepletion(cedis_id, sku)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ml/stock-predict/cedis  — Body: { cedis_id }
router.post('/stock-predict/cedis', async (req, res) => {
  try {
    const { cedis_id } = req.body
    if (!cedis_id) return res.status(400).json({ error: 'cedis_id es requerido' })
    const results = await predictAllStockForCedis(cedis_id)
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ml/reorder-pattern  — Body: { customer_id, sku, sku_name? }
router.post('/reorder-pattern', async (req, res) => {
  try {
    const { customer_id, sku, sku_name } = req.body
    if (!customer_id || !sku) return res.status(400).json({ error: 'customer_id y sku son requeridos' })
    const result = await computeReorderPattern(customer_id, sku, sku_name)
    if (!result) return res.status(200).json({ mensaje: 'Datos insuficientes para predecir (mínimo 2 pedidos)' })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ml/reorder-pattern/customer  — Body: { customer_id }
router.post('/reorder-pattern/customer', async (req, res) => {
  try {
    const { customer_id } = req.body
    if (!customer_id) return res.status(400).json({ error: 'customer_id es requerido' })
    const results = await computeAllPatternsForCustomer(customer_id)
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ml/substitution/suggest  — Body: { customer_id, original_sku, cedis_id, order_id? }
router.post('/substitution/suggest', async (req, res) => {
  try {
    const { customer_id, original_sku, cedis_id, order_id } = req.body
    if (!customer_id || !original_sku || !cedis_id) {
      return res.status(400).json({ error: 'customer_id, original_sku y cedis_id son requeridos' })
    }
    const result = await suggestSubstitutes(customer_id, original_sku, cedis_id, order_id)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
