/**
 * backfill_index_orders.js
 *
 * Indexa retroactivamente todos los pedidos existentes en KnowledgeChunk
 * (vector index del chatbot RAG) — hasta ahora indexOrder() solo se
 * disparaba a mano vía el endpoint admin, así que cualquier pedido creado
 * antes de conectar ese hook a createOrder/updateOrderStatusAdmin/markDelivered
 * es invisible para el chatbot ("no encontré tus pedidos pasados").
 *
 * indexOrder() ya hace upsert sobre KnowledgeChunk, así que correr este
 * script más de una vez es seguro (no duplica).
 *
 * Uso: node scripts/backfill_index_orders.js
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Order = require('../models/Order.model')
const { indexOrder } = require('../services/rag/indexer.service')

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  const orders = await Order.find().select('_id id_pedido').lean()
  console.log(`📦 Pedidos encontrados: ${orders.length}`)

  let ok = 0
  let fail = 0
  for (const order of orders) {
    try {
      await indexOrder(order._id)
      ok++
      process.stdout.write(`\r   indexados: ${ok}/${orders.length}`)
    } catch (e) {
      fail++
      console.error(`\n❌ ${order.id_pedido}: ${e.message}`)
    }
  }

  console.log(`\n\n✅ Listo: ${ok} pedidos indexados, ${fail} con error`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
