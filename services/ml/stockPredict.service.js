/**
 * ML Módulo 1 — Predicción de agotamiento de stock
 *
 * Flujo:
 * 1. Toma el stock actual y los movimientos recientes de inventario
 * 2. Envía contexto a Gemini (incluyendo el lead time del proveedor)
 * 3. Guarda resultado en StockPredict (incluye para cuándo hay que pedir)
 * 4. Si nivel es "critico" o "bajo" → avisa a los admins por WhatsApp con
 *    cuánto pedir y para cuándo, considerando que el reabastecimiento del
 *    proveedor tarda entre 3 y 5 días en llegar.
 */

const { askGemini } = require('../../utils/gemini')
const StockPredict = require('../../models/StockPredict.model')
const InventoryMvt = require('../../models/InventoryMvt.model')
const InventarioCedis = require('../../models/InventarioCedis.model')
const Admin = require('../../models/Admin.model')
const { sendWhatsAppMessage } = require('../whatsapp.service')

// Lead time real del proveedor: tarda entre 3 y 5 días en surtir un reorden.
// Usamos el valor más conservador (el más largo) para los cálculos de "para
// cuándo hay que pedir" y de "cuánto colchón necesito mientras llega" — así
// nunca nos quedamos sin stock esperando el camión.
const TIEMPO_ENTREGA_MIN_DIAS = 3
const TIEMPO_ENTREGA_MAX_DIAS = 5
const TIEMPO_ENTREGA_DIAS = TIEMPO_ENTREGA_MAX_DIAS

/**
 * Predice agotamiento para un producto en un cedis específico.
 * @param {string} cedis_id
 * @param {string} sku
 * @returns {Promise<object>} resultado guardado en StockPredict
 */
async function predictStockDepletion(cedis_id, sku) {
  // 1. Stock actual (disponible — lo que de verdad se puede vender; lo
  //    apartado/reservado ya está comprometido con pedidos existentes)
  const inventario = await InventarioCedis.findOne({ cedis_id, sku })
  const stock_actual = inventario?.stock_disponible ?? 0
  const stock_reservado = inventario?.stock_reservado ?? 0

  // 2. Últimos 30 días de movimientos de salida (incluye apartados por pedidos)
  const hace30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const movimientos = await InventoryMvt.find({
    cedis_id,
    sku,
    tipo_movimiento: { $in: ['salida', 'reserva'] },
    timestamp: { $gte: hace30Dias },
  }).select('timestamp cantidad tipo_movimiento')

  const totalSalidas = movimientos.reduce((s, m) => s + m.cantidad, 0)
  const rotacion_diaria_real = totalSalidas / 30

  // 3. Prompt a Gemini — incluye el lead time del proveedor para que la
  //    sugerencia de "cuánto" y "cuándo" pedir tome en cuenta esos días de espera
  const prompt = `
Eres un sistema de predicción de inventario para una empresa de distribución de bebidas en México.

Datos del producto:
- SKU: ${sku}
- CEDIS: ${cedis_id}
- Stock disponible actual: ${stock_actual} unidades
- Stock ya apartado/reservado por pedidos: ${stock_reservado} unidades
- Salidas (incluye apartados) en los últimos 30 días: ${totalSalidas} unidades
- Rotación diaria real: ${rotacion_diaria_real.toFixed(2)} unidades/día
- Movimientos recientes (últimos 10): ${JSON.stringify(movimientos.slice(-10))}
- Tiempo de entrega (lead time) del proveedor al hacer un reorden: entre ${TIEMPO_ENTREGA_MIN_DIAS} y ${TIEMPO_ENTREGA_MAX_DIAS} días (usa ${TIEMPO_ENTREGA_DIAS} días — el peor caso — para tus cálculos)

Calcula:
1. demanda_diaria_predicha: promedio esperado considerando tendencias
2. dias_estimados_agotamiento: días hasta que el stock disponible llegue a 0 (desde hoy)
3. fecha_agotamiento_predicha: fecha ISO en que se agotará
4. fecha_limite_pedido: fecha ISO LÍMITE para HACER el reorden — debe ser aproximadamente "fecha_agotamiento_predicha" menos ${TIEMPO_ENTREGA_DIAS} días (el lead time), para que el nuevo stock llegue justo ANTES de que se agote. Si esa fecha ya pasó o es hoy/mañana, di que el pedido debe hacerse DE INMEDIATO.
5. cantidad_reorden_sugerida: cuántas unidades pedir — debe alcanzar para cubrir la demanda de los ${TIEMPO_ENTREGA_DIAS} días de espera mientras llega el reorden, MÁS un colchón para ~30 días de operación normal después de eso
6. nivel_alerta: usa estos umbrales pensando en el lead time de ${TIEMPO_ENTREGA_DIAS} días — "ok" si dias_estimados_agotamiento > ${TIEMPO_ENTREGA_DIAS + 9}, "bajo" si está entre ${TIEMPO_ENTREGA_DIAS + 2} y ${TIEMPO_ENTREGA_DIAS + 9}, "critico" si es ≤ ${TIEMPO_ENTREGA_DIAS + 2} (es decir, si pedir HOY apenas alcanzaría a llegar antes de que se agote, o ya ni eso)
7. confianza: número entre 0 y 1 según calidad de los datos
8. razon: explicación breve en español de 1 oración

Responde ÚNICAMENTE con JSON válido con exactamente estas claves:
{
  "demanda_diaria_predicha": number,
  "dias_estimados_agotamiento": number,
  "fecha_agotamiento_predicha": "ISO string",
  "fecha_limite_pedido": "ISO string",
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
      fecha_limite_pedido: geminiResult.fecha_limite_pedido ? new Date(geminiResult.fecha_limite_pedido) : null,
      tiempo_entrega_dias: TIEMPO_ENTREGA_DIAS,
      cantidad_reorden_sugerida: geminiResult.cantidad_reorden_sugerida,
      nivel_alerta: geminiResult.nivel_alerta,
      confianza: geminiResult.confianza,
    },
    { upsert: true, new: true }
  )

  // 5. Avisar a los admins por WhatsApp si el nivel es preocupante.
  //    (Nota: el modelo Notification requiere un customer_id — está pensado
  //    para clientes, no para admins — así que el aviso a admins se manda
  //    directamente por WhatsApp usando su número guardado en Admin.telefono)
  if (geminiResult.nivel_alerta !== 'ok') {
    await alertAdminsWhatsApp(prediction, geminiResult)
  }

  return prediction
}

/**
 * Manda un WhatsApp a cada admin con teléfono registrado, avisando que el
 * stock de un SKU está bajo/crítico, cuánto sugiere pedir y para cuándo
 * (considerando el lead time de ${TIEMPO_ENTREGA_DIAS} días del proveedor).
 */
async function alertAdminsWhatsApp(prediction, geminiResult) {
  const admins = await Admin.find({ telefono: { $exists: true, $nin: [null, ''] } }).select('nombre telefono')
  if (!admins.length) return

  const esCritico = geminiResult.nivel_alerta === 'critico'
  const emoji = esCritico ? '🔴' : '🟡'
  const fechaLimiteTxt = geminiResult.fecha_limite_pedido
    ? new Date(geminiResult.fecha_limite_pedido).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
    : 'lo antes posible'

  const mensaje =
    `${emoji} *Alerta de stock ${esCritico ? 'CRÍTICA' : 'BAJA'}*\n` +
    `SKU: *${prediction.sku}* — CEDIS ${prediction.cedis_id}\n` +
    `Disponible: ${prediction.stock_actual} u. — se agotaría en ~${geminiResult.dias_estimados_agotamiento} días.\n\n` +
    `📦 Sugerencia: pide *${geminiResult.cantidad_reorden_sugerida} unidades* a más tardar el *${fechaLimiteTxt}* ` +
    `(el proveedor tarda ${TIEMPO_ENTREGA_MIN_DIAS}-${TIEMPO_ENTREGA_MAX_DIAS} días en surtir).\n\n` +
    `${geminiResult.razon}`

  await Promise.all(
    admins.map((a) =>
      sendWhatsAppMessage(a.telefono, mensaje).catch((e) =>
        console.error(`[stockPredict] No se pudo avisar por WhatsApp a admin ${a.nombre || a._id}:`, e.message)
      )
    )
  )
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
