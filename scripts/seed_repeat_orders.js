/**
 * seed_repeat_orders.js
 *
 * Genera pedidos de REPETICIÓN realistas para clientes existentes, sin borrar
 * nada — el objetivo es darle al modelo global de cantidad (Modelo B / XGBoost)
 * suficiente historial: cada cliente necesita pedir el MISMO sku varias veces
 * a lo largo del tiempo para que se generen ejemplos de entrenamiento.
 *
 * Para cada cliente:
 *  - Elige 3-6 SKUs "favoritos" (los que va a repetir)
 *  - Genera 6-9 pedidos espaciados ~7-21 días, con cantidades que varían un
 *    poco alrededor de un promedio propio del cliente (+ tendencia leve)
 *  - Marca todo como 'entregado' con fecha_pedido en el pasado
 *  - Crea Order + OrderDetail (+ TrackingPedido básico)
 *
 * Uso: node scripts/seed_repeat_orders.js [num_clientes]
 *      node scripts/seed_repeat_orders.js 10   → solo los primeros 10 clientes
 */

require('dotenv').config()
const mongoose = require('mongoose')

const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const Customer = require('../models/Customer.model')
const Product = require('../models/Product.model')
const Cedis = require('../models/Cedis.model')

const NUM_PEDIDOS_MIN = 6
const NUM_PEDIDOS_MAX = 9
const SKUS_FAVORITOS_MIN = 3
const SKUS_FAVORITOS_MAX = 6
const GAP_DIAS_MIN = 7
const GAP_DIAS_MAX = 21

function rand(min, max) {
  return Math.random() * (max - min) + min
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1))
}
function pickRandom(arr, n) {
  const copia = [...arr]
  const elegidos = []
  for (let i = 0; i < n && copia.length; i++) {
    const idx = randInt(0, copia.length - 1)
    elegidos.push(copia.splice(idx, 1)[0])
  }
  return elegidos
}

let pedidoCounter = Date.now()
function nextIdPedido() {
  pedidoCounter += 1
  return `PED-SEED-${pedidoCounter}`
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  const limite = Number(process.argv[2]) || null

  const cedis = await Cedis.findOne({ estado: 'activo' }) || await Cedis.findOne()
  if (!cedis) throw new Error('No hay ningún CEDIS en la base de datos')
  const cedis_id = cedis.cedis_id
  console.log(`🏭 Usando CEDIS: ${cedis_id} (${cedis.nombre})`)

  let customers = await Customer.find().select('_id nombre')
  if (limite) customers = customers.slice(0, limite)
  console.log(`👥 Clientes a procesar: ${customers.length}`)

  const products = await Product.find({ estado: 'activo' }).select('sku nombre precio_unitario')
  if (products.length < SKUS_FAVORITOS_MAX) throw new Error('No hay suficientes productos activos')
  console.log(`📦 Catálogo disponible: ${products.length} productos`)

  // Punto de partida: hace ~7 meses, para tener suficiente "historia" hacia atrás
  const HOY = new Date()
  const INICIO = new Date(HOY.getTime() - 210 * 24 * 60 * 60 * 1000)

  let totalPedidos = 0
  let totalLineas = 0

  for (const customer of customers) {
    const numFavoritos = randInt(SKUS_FAVORITOS_MIN, SKUS_FAVORITOS_MAX)
    const favoritos = pickRandom(products, numFavoritos).map((p) => ({
      ...p.toObject(),
      // cantidad "base" propia de este cliente para este producto (con algo
      // de variación entre pedidos, simulando demanda real)
      base: randInt(2, 25),
    }))

    const numPedidos = randInt(NUM_PEDIDOS_MIN, NUM_PEDIDOS_MAX)

    let fecha = new Date(INICIO.getTime() + randInt(0, 10) * 24 * 60 * 60 * 1000)

    for (let i = 0; i < numPedidos; i++) {
      if (fecha > HOY) break // no generar pedidos "futuros"

      const id_pedido = nextIdPedido()

      // En cada pedido, el cliente pide sus favoritos (con cantidad variable
      // alrededor de su "base" + leve tendencia creciente) y a veces 1 extra
      const items = favoritos.map((p) => {
        const variacion = rand(-0.25, 0.25)
        const tendencia = (i / numPedidos) * rand(0, 0.3) // leve crecimiento en el tiempo
        const cantidad = Math.max(1, Math.round(p.base * (1 + variacion + tendencia)))
        return { sku: p.sku, nombre: p.nombre, cantidad, precio: p.precio_unitario || 15 }
      })

      if (Math.random() < 0.4) {
        const extra = pickRandom(products, 1)[0]
        items.push({ sku: extra.sku, nombre: extra.nombre, cantidad: randInt(1, 8), precio: extra.precio_unitario || 15 })
      }

      const subtotal = items.reduce((s, it) => s + it.cantidad * it.precio, 0)
      const fechaISO = fecha.toISOString()

      await Order.create({
        id_pedido,
        customer_id: String(customer._id),
        cedis_id,
        status_final: 'entregado',
        fecha_pedido: fechaISO,
        delivered_at: fecha,
        subtotal: +subtotal.toFixed(2),
        total: +subtotal.toFixed(2),
        valor_pedido: +subtotal.toFixed(2),
        notes: 'Generado por seed_repeat_orders.js (datos de prueba para Modelo B)',
      })

      const detalles = items.map((it, idx) => ({
        id_linea: `${id_pedido}-${idx + 1}`,
        id_pedido,
        sku_solicitado: it.sku,
        nombre_sku_solicitado: it.nombre,
        quantity: it.cantidad,
        status: 'entregado',
      }))
      await OrderDetail.insertMany(detalles)

      await TrackingPedido.create({
        id_pedido,
        customer_id: String(customer._id),
        status_actual: 'entregado',
        eventos: [
          { status: 'pendiente', descripcion: 'Pedido recibido', timestamp: fecha },
          { status: 'entregado', descripcion: 'Pedido entregado (datos de prueba)', timestamp: fecha },
        ],
      })

      totalPedidos += 1
      totalLineas += detalles.length

      // siguiente pedido, espaciado de forma realista
      fecha = new Date(fecha.getTime() + randInt(GAP_DIAS_MIN, GAP_DIAS_MAX) * 24 * 60 * 60 * 1000)
    }

    console.log(`  ✓ ${customer.nombre || customer._id} → ${numPedidos} pedidos, ${numFavoritos} SKUs favoritos`)
  }

  console.log(`\n✅ Listo: ${totalPedidos} pedidos creados, ${totalLineas} líneas de detalle`)
  console.log('   Ahora puedes correr POST /train-global en el ml-service')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
