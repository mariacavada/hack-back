require('dotenv').config()
const mongoose = require('mongoose')
const Order = require('../models/Order.model')
const { indexOrder } = require('../services/rag/indexer.service')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function indexWithRetry(orderId, label, maxRetries = 6) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await indexOrder(orderId)
      return true
    } catch (e) {
      const isRateLimit = e.message?.includes('429') || e.message?.includes('Too Many Requests')
      if (isRateLimit && attempt < maxRetries) {
        const wait = 8000 * attempt
        console.log(`   ⏳ ${label}: rate limit, reintento ${attempt}/${maxRetries} en ${wait / 1000}s...`)
        await sleep(wait)
        continue
      }
      console.error(`   ❌ ${label}: ${e.message}`)
      return false
    }
  }
  return false
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  const customerId = '6a24e60dcb3e0fe4969bb98d'
  const orders = await Order.find({ customer_id: customerId }).select('_id id_pedido').lean()
  console.log(`📦 Pedidos de La Fe a indexar: ${orders.length}`)

  let ok = 0
  let fail = 0
  for (const order of orders) {
    const success = await indexWithRetry(order._id, order.id_pedido)
    if (success) {
      ok++
      console.log(`   ✅ ${order.id_pedido} (${ok}/${orders.length})`)
    } else {
      fail++
    }
    await sleep(1500)
  }

  console.log(`\n✅ Listo: ${ok} pedidos indexados, ${fail} con error`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
