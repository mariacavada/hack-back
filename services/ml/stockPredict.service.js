/**
 * ML Módulo 1 — Predicción de agotamiento de stock
 *
 * Flujo:
 * 1. Toma el stock actual y los movimientos recientes de inventario
 * 2. Envía contexto a Gemini
 * 3. Guarda resultado en StockPredict
 * 4. Si nivel es "critico" o "bajo" → crea Notification para admins
 */

const { askGemini } = require('../../utils/gemini')
const StockPredict = require('../../models/StockPredict.model')
const InventoryMvt = require('../../models/InventoryMvt.model')
const InventarioCedis = require('../../models/InventarioCedis.model')
const Notification = require('../../models/Notification.model')
const Admin = require('../../models/Admin.model')

/**
 * Predice agotamiento para un producto en un cedis específico.
 * @param {string} cedis_id
 * @param {string} sku
 * @returns {Promise<object>} resultado guardado en StockPredict
 */
async function predictStockDepletion(cedis_id, sku) {
  // 1. Stock actual
  const inventario = await InventarioCedis.findOne({ cedis_id, sku })
  const stock_actual = inventario?.stock_actual ?? 0

  // 2. Últimos 30 días de movimientos (salidas)
  const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const movimientos = await InventoryMvt.find({
    cedis_id,
    sku,
    tipo: 'salida',
    fecha: { $gte: hace30Dias },
  }).select('fecha cantidad')

  const totalSalidas = movimientos.reduce((s, m) => s + m.cantidad, 0)
  const rotacion_diaria_real = totalSalidas / 30

  // 3. Prompt a Gemini
  const prompt = `
Eres un sistema de predicción de inventario para una empresa de distribución de bebidas en México.

Datos del producto:
- SKU: ${sku}
- CEDIS: ${cedis_id}
- Stock actual: ${stock_actual} unidades
- Salidas en los últimos 30 días: ${totalSalidas} unidades
- Rotación diaria real: ${rotacion_diaria_real.toFixed(2)} unidades/día
- Movimientos recientes (últimas 10): ${JSON.stringify(movimientos.slice(-10))}

Calcula:
1. demanda_diaria_predicha: promedio esperado considerando tendencias
2. dias_estimados_agotamiento: días hasta que llegue a 0
3. fecha_agotamiento_predicha: fecha ISO en que se agotará
4. cantidad_reorden_sugerida: cuántas unidades pedir para cubrir 30 días más
5. nivel_alerta: "ok" si >14 días, "bajo" si 7-14 días, "critico" si <7 días
6. confianza: número entre 0 y 1 según calidad de los datos
7. razon: explicación breve en español de 1 oración

Responde ÚNICAMENTE con JSON válido con exactamente estas claves:
{
  "demanda_diaria_predicha": number,
  "dias_estimados_agotamiento": number,
  "fecha_agotamiento_predicha": "ISO string",
  "cantidad_reorden_sugerida": number,
  "nivel_alerta": "ok" | "bajo" | "critico",
  "confianza": number,
  "razon": "string"
}
`

  const geminiResult = await askGemini(prompt)

  // 4. Guardar en MongoDB
  const prediction = await StockPredict.findOneAndUpdate(
    { cedis_id, sku },
    {
      cedis_id,
      sku,
      stock_actual,
      rotacion_diaria_real,
      demanda_diaria_predicha: geminiResult.demanda_diaria_predicha,
      dias_estimados_agotamiento: geminiResult.dias_estimados_agotamiento,
      fecha_agotamiento_predicha: new Date(geminiResult.fecha_agotamiento_predicha),
      cantidad_reorden_sugerida: geminiResult.cantidad_reorden_sugerida,
      nivel_alerta: geminiResult.nivel_alerta,
      confianza: geminiResult.confianza,
    },
    { upsert: true, new: true }
  )

  // 5. Notificar a admins si el nivel es preocupante
  if (geminiResult.nivel_alerta !== 'ok') {
    const admins = await Admin.find({}).select('_id')
    const notifs = admins.map((a) => ({
      user_id: a._id,
      user_role: 'admin',
      type: geminiResult.nivel_alerta === 'critico' ? 'depletion_alert' : 'low_stock',
      title:
        geminiResult.nivel_alerta === 'critico'
          ? `🔴 Stock CRÍTICO: SKU ${sku}`
          : `🟡 Stock bajo: SKU ${sku}`,
      body: `${geminiResult.razon} Se agotan en ~${geminiResult.dias_estimados_agotamiento} días. Reorden sugerido: ${geminiResult.cantidad_reorden_sugerida} unidades.`,
      metadata: { cedis_id, sku, prediction_id: prediction._id },
      channel: 'in_app',
    }))
    await Notification.insertMany(notifs)
  }

  return prediction
}

/**
 * Corre predicción para todos los productos de un cedis
 * @param {string} cedis_id
 */
async function predictAllStockForCedis(cedis_id) {
  const items = await InventarioCedis.find({ cedis_id }).select('sku')
  const results = []
  for (const item of items) {
    try {
      const r = await predictStockDepletion(cedis_id, item.sku)
      results.push({ sku: item.sku, nivel_alerta: r.nivel_alerta })
    } catch (err) {
      results.push({ sku: item.sku, error: err.message })
    }
  }
  return results
}

module.exports = { predictStockDepletion, predictAllStockForCedis }
