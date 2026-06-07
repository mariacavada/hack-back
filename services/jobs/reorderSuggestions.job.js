/**
 * Job diario de sugerencias de recompra.
 *
 * Recorre a todos los clientes con historial de pedidos, recalcula sus
 * patrones de reorden por SKU (modelo reorder-pattern/customer) y deja que
 * computeReorderPattern() cree la notificación tipo "reorder_suggestion"
 * cuando el próximo pedido predicho cae dentro de los próximos 3 días
 * (con dedupe por customer_id+sku+proximo_reorden, así que correrlo varias
 * veces al día no genera spam).
 *
 * Se agenda desde index.js con setInterval (no hay cron en el proyecto).
 */

const Order = require('../../models/Order.model')
const { computeAllPatternsForCustomer } = require('../ml/reorderPattern.service')

async function runReorderSuggestionsJob() {
  const customerIds = await Order.distinct('customer_id')
  console.log(`[reorder-job] revisando patrones de recompra de ${customerIds.length} cliente(s)...`)

  let notificaciones = 0
  let clientesConError = 0

  for (const customer_id of customerIds) {
    try {
      const results = await computeAllPatternsForCustomer(String(customer_id))
      notificaciones += results.filter((r) => r.notificado).length
    } catch (e) {
      clientesConError++
      console.error(`[reorder-job] cliente ${customer_id} falló:`, e.message)
    }
  }

  console.log(`[reorder-job] terminado — ${notificaciones} sugerencia(s) de recompra creada(s), ${clientesConError} cliente(s) con error`)
  return { clientes: customerIds.length, notificaciones, clientesConError }
}

module.exports = { runReorderSuggestionsJob }
