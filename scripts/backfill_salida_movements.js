/**
 * backfill_salida_movements.js
 *
 * Genera registros retroactivos de tipo_movimiento: 'salida' en InventoryMvt
 * a partir del historial de pedidos YA ENTREGADOS — para que el modelo de
 * predicción de agotamiento (stockPredict.service) tenga "rotación real"
 * desde el día uno, en lugar de ver la colección vacía y reportar 0.
 *
 * Es NO destructivo e IDEMPOTENTE: si un id_pedido ya generó su movimiento de
 * salida (ej. porque se corrió antes), lo salta — no duplica.
 *
 * Para cada línea de cada pedido 'entregado':
 *   - cedis_id  → del pedido
 *   - sku       → sku_solicitado de la línea
 *   - cantidad  → quantity de la línea
 *   - timestamp → delivered_at del pedido (o fecha_pedido si no hay)
 *   - id_pedido → para trazabilidad
 *
 * Uso: node scripts/backfill_salida_movements.js
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const InventoryMvt = require('../models/InventoryMvt.model')

function resolverFecha(order) {
  if (order.delivered_at) return new Date(order.delivered_at)
  if (order.fecha_pedido) {
    const d = new Date(order.fecha_pedido)
    if (!isNaN(d.getTime())) return d
  }
  return order.created_at ? new Date(order.created_at) : new Date()
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  const orders = await Order.find({ status_final: 'entregado' })
    .select('id_pedido cedis_id fecha_pedido delivered_at created_at')
    .lean()
  console.log(`📦 Pedidos entregados encontrados: ${orders.length}`)

  // Idempotencia: averiguamos qué id_pedido ya tienen su 'salida' generada
  const yaGenerados = new Set(
    await InventoryMvt.distinct('id_pedido', {
      tipo_movimiento: 'salida',
      motivo: 'Backfill desde historial de pedidos entregados',
    })
  )
  console.log(`↩️  Pedidos que ya tenían backfill (se saltan): ${yaGenerados.size}`)

  const pendientes = orders.filter((o) => !yaGenerados.has(o.id_pedido))
  console.log(`🆕 Pedidos a procesar: ${pendientes.length}`)

  if (!pendientes.length) {
    console.log('Nada que hacer — todo ya estaba generado.')
    process.exit(0)
  }

  const idsPendientes = pendientes.map((o) => o.id_pedido)
  const detalles = await OrderDetail.find({ id_pedido: { $in: idsPendientes } })
    .select('id_pedido sku_solicitado quantity')
    .lean()

  const detallesPorPedido = new Map()
  for (const d of detalles) {
    if (!d.sku_solicitado || !d.quantity || d.quantity <= 0) continue
    if (!detallesPorPedido.has(d.id_pedido)) detallesPorPedido.set(d.id_pedido, [])
    detallesPorPedido.get(d.id_pedido).push(d)
  }

  const movimientos = []
  for (const order of pendientes) {
    const lineas = detallesPorPedido.get(order.id_pedido) || []
    if (!lineas.length || !order.cedis_id) continue
    const fecha = resolverFecha(order)

    for (const linea of lineas) {
      movimientos.push({
        cedis_id: order.cedis_id,
        sku: linea.sku_solicitado,
        tipo_movimiento: 'salida',
        cantidad: linea.quantity,
        id_pedido: order.id_pedido,
        timestamp: fecha,
        motivo: 'Backfill desde historial de pedidos entregados',
      })
    }
  }

  if (movimientos.length) {
    await InventoryMvt.insertMany(movimientos)
  }

  console.log(`\n✅ Listo: ${movimientos.length} movimientos de 'salida' generados`)
  console.log('   Ahora /api/ml/stock-predict (o un nuevo pedido) verá rotación real ≠ 0')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
