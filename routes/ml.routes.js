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
//
// Analizar TODO el catálogo de un CEDIS (puede tener ~130 SKUs) llamando a
// Gemini uno por uno tarda minutos — Railway corta la conexión a los ~30s
// (502 sin headers ⇒ el navegador lo reporta como error de CORS) y además
// se agotaría la cuota gratuita de Gemini (20 requests/día) de inmediato.
//
// Solución: respondemos de inmediato (la ruta nunca expira) y el análisis
// corre en segundo plano. Además, predictAllStockForCedis ya filtra de
// entrada solo los SKUs cuyo stock está cerca de su mínimo — así Gemini
// revisa ~10-20 productos en riesgo en vez del catálogo completo.
//
// Para ver los resultados una vez que termine: GET /api/admin/inventory/depletion-risk?cedis_id=...
router.post('/stock-predict/cedis', (req, res) => {
  const { cedis_id } = req.body
  if (!cedis_id) return res.status(400).json({ error: 'cedis_id es requerido' })

  res.status(202).json({
    message: 'Análisis de inventario iniciado en segundo plano — solo se revisan los SKUs cerca de su stock mínimo. Consulta GET /api/admin/inventory/depletion-risk?cedis_id=... en un momento para ver los resultados.',
    cedis_id,
  })

  predictAllStockForCedis(cedis_id)
    .then((results) => console.log(`[ML background] stock-predict/cedis ${cedis_id} terminó — ${results.length} SKU(s) analizados`))
    .catch((e) => console.error('[ML background] stock-predict/cedis falló:', e.message))
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
