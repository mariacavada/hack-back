require('dotenv').config()
const mongoose = require('mongoose')
const KnowledgeChunk = require('../models/KnowledgeChunk.model')
const Order = require('../models/Order.model')

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  const customerId = '6a24e60dcb3e0fe4969bb98d'

  const orders = await Order.find({ customer_id: customerId }).select('_id id_pedido').lean()
  console.log(`Pedidos totales de La Fe: ${orders.length}`)

  const chunks = await KnowledgeChunk.find({ source: 'order', customer_id: customerId }).select('order_id').lean()
  const indexedIds = new Set(chunks.map(c => String(c.order_id)))
  console.log(`Pedidos indexados (chunks únicos): ${indexedIds.size}`)

  const missing = orders.filter(o => !indexedIds.has(String(o._id)))
  console.log(`Faltan por indexar: ${missing.length}`)
  missing.forEach(o => console.log(`  - ${o.id_pedido} (${o._id})`))

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
