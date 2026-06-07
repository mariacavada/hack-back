/**
 * ML Módulo 2 — Patrones de reorden por cliente
 *
 * Flujo:
 * 1. Busca el historial de órdenes del cliente para un SKU
 * 2. Envía a Gemini para que calcule el patrón y prediga el próximo reorden
 * 3. Guarda en OrderPattern
 * 4. Si la fecha predicha es <= 3 días → crea notificación "es momento de pedir"
 */

const { askGemini } = require('../../utils/gemini')
const Order = require('../../models/Order.model')
const OrderDetail = require('../../models/OrderDetail.model')
const OrderPattern = require('../../models/OrderPattern.model')
const Notification = require('../../models/Notification.model')

/**
 * Calcula el patrón de reorden de un cliente para un SKU específico.
 * @param {string} customer_id
 * @param {string} sku
 * @param {string} sku_name
 */
async function computeReorderPattern(customer_id, sku, sku_name = '') {
  // 1. Buscar todas las órdenes del cliente que incluyan este SKU
  const detalles = await OrderDetail.find({ sku_solicitado: sku })
    .select('id_pedido cantidad_solicitada fecha_pedido status')
    .sort({ fecha_pedido: 1 })

  // Filtrar solo las del cliente
  const pedidosIds = detalles.map((d) => d.id_pedido)
  const ordenes = await Order.find({
    customer_id,
    id_pedido: { $in: pedidosIds },
    status_final: { $in: ['entregado', 'incompleto'] },
  }).select('id_pedido fecha_pedido')

  if (ordenes.length < 2) {
    return null // No hay suficientes datos para predecir
  }

  const historial = ordenes.map((o) => {
    const detalle = detalles.find((d) => d.id_pedido === o.id_pedido)
    return {
      fecha: o.fecha_pedido,
      cantidad: detalle?.cantidad_solicitada ?? 0,
    }
  })

  // 2. Gemini calcula el patrón
  const hoy = new Date().toISOString().split('T')[0]
  const prompt = `
Eres un sistema de análisis de comportamiento de compra para una distribuidora de bebidas en México.

Historial de compras del cliente para el producto "${sku_name || sku}":
${JSON.stringify(historial, null, 2)}

Hoy es: ${hoy}

Analiza el patrón de compra y calcula:
1. gap_promedio_dias: promedio de días entre cada pedido
2. cantidad_promedio: cantidad promedio que pide cada vez
3. proximo_reorden: fecha ISO del próximo pedido predicho
4. confianza: número 0-1 (más alto = más regular el patrón)
5. tendencia: "estable" | "creciente" | "decreciente"

Responde ÚNICAMENTE con JSON válido:
{
  "gap_promedio_dias": number,
  "cantidad_promedio": number,
  "proximo_reorden": "YYYY-MM-DD",
  "confianza": number,
  "tendencia": "estable" | "creciente" | "decreciente"
}
`

  const result = await askGemini(prompt)

  // 3. Guardar en MongoDB
  const pattern = await OrderPattern.findOneAndUpdate(
    { customer_id, sku },
    {
      customer_id,
      sku,
      gap_promedio_dias: result.gap_promedio_dias,
      cantidad_promedio: result.cantidad_promedio,
      proximo_reorden: new Date(result.proximo_reorden),
      confianza: result.confianza,
    },
    { upsert: true, new: true }
  )

  // 4. Notificar si el reorden es en los próximos 3 días
  const diasRestantes = Math.ceil(
    (new Date(result.proximo_reorden) - new Date()) / (1000 * 60 * 60 * 24)
  )

  // Antes este create() usaba campos que no existen en el schema
  // (user_id/type/title/body/channel) → Notification.create() tronaba por
  // validación cada vez que se intentaba notificar. Además, evitamos
  // duplicar la sugerencia si ya existe una para esta misma predicción
  // (el job diario recalcula todos los patrones cada 24h).
  let notificado = false
  if (diasRestantes >= 0 && diasRestantes <= 3) {
    const yaExiste = await Notification.findOne({
      customer_id,
      sku,
      tipo: 'reorder_suggestion',
      'metadata.proximo_reorden': result.proximo_reorden,
    })
    if (!yaExiste) {
      await Notification.create({
        customer_id,
        tipo: 'reorder_suggestion',
        titulo: '🛒 ¡Es momento de pedir!',
        mensaje: `Basado en tu historial, sueles pedir "${sku_name || sku}" cada ${Math.round(result.gap_promedio_dias)} días. ¡Ya casi es tu momento de volver a pedir!`,
        sku,
        prioridad: 'media',
        metadata: { patron_id: pattern._id, proximo_reorden: result.proximo_reorden },
      })
      notificado = true
    }
  }

  return { ...pattern.toObject(), tendencia: result.tendencia, dias_restantes: diasRestantes, notificado }
}

/**
 * Recalcula patrones para TODOS los SKUs de un cliente.
 * @param {string} customer_id
 */
async function computeAllPatternsForCustomer(customer_id) {
  // Obtener todos los SKUs distintos que ha pedido el cliente
  const ordenes = await Order.find({ customer_id }).select('id_pedido')
  const ids = ordenes.map((o) => o.id_pedido)
  const detalles = await OrderDetail.find({ id_pedido: { $in: ids } }).distinct('sku_solicitado')

  const results = []
  for (const sku of detalles) {
    try {
      const r = await computeReorderPattern(customer_id, sku)
      if (r) results.push({ sku, proximo_reorden: r.proximo_reorden, notificado: r.notificado })
    } catch (err) {
      results.push({ sku, error: err.message })
    }
  }
  return results
}

module.exports = { computeReorderPattern, computeAllPatternsForCustomer }
