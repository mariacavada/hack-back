/**
 * seed-csv.js
 * Carga Orders.csv, OrderDetails.csv y Resultados.csv en MongoDB.
 * Limpia las colecciones antes de insertar.
 *
 * Uso: node scripts/seed-csv.js
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const { parse } = require('csv-parse/sync')

const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const Resultado = require('../models/Resultado.model')

// ── Rutas a los CSV ──────────────────────────────────────────────────────────
const CSV_DIR = path.join(process.env.HOME, 'Desktop/hack/hack-web')
const ORDERS_CSV      = path.join(CSV_DIR, 'Orders.csv')
const DETAILS_CSV     = path.join(CSV_DIR, 'OrderDetails.csv')
const RESULTADOS_CSV  = path.join(CSV_DIR, 'Resultados.csv')

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte notación científica de Excel a string entero (ej: "8.83944E+18" → "8839440000000000000") */
function sciToStr(val) {
  if (!val || val === 'NULL' || val === '') return null
  const n = parseFloat(val)
  if (isNaN(n)) return String(val).trim()
  return n.toFixed(0)
}

/** Mapea status del CSV al enum del modelo */
function mapStatus(s) {
  const map = {
    entregado: 'entregado',
    registrado: 'pendiente',
    pendiente: 'pendiente',
    cancelado: 'cancelado',
    incompleto: 'incompleto',
  }
  return map[(s || '').toLowerCase()] || 'pendiente'
}

/** Mapea status de detalle */
function mapDetailStatus(s) {
  const map = {
    entregado: 'entregado',
    registrado: 'registrado',
    faltante: 'faltante',
    sustituido: 'sustituido',
  }
  return map[(s || '').toLowerCase()] || 'registrado'
}

/** Parsea CSV con csv-parse */
function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  // ── 1. Limpiar colecciones ─────────────────────────────────────────────────
  console.log('🗑  Limpiando colecciones...')
  await Promise.all([
    Order.deleteMany({}),
    OrderDetail.deleteMany({}),
    Resultado.deleteMany({}),
  ])
  console.log('   Listo.')

  // ── 2. Seed Orders ─────────────────────────────────────────────────────────
  console.log('📦 Leyendo Orders.csv...')
  const ordersRaw = readCSV(ORDERS_CSV)
  console.log(`   ${ordersRaw.length} filas`)

  const orders = ordersRaw.map((r) => ({
    id_pedido:       sciToStr(r.id_pedido),
    customer_id:     sciToStr(r.customer_id),
    pais:            r.pais || null,
    id_businessunit: r.id_businessunit ? Number(r.id_businessunit) : null,
    business_unit:   r.business_unit || null,
    cedis_id:        r.cedis ? String(r.cedis).trim() : null,
    fecha_pedido:    r.fecha_pedido || null,
    fecha_entrega:   (r.fecha_entrega && r.fecha_entrega !== 'NULL') ? r.fecha_entrega : null,
    status_final:    mapStatus(r.status_final),
    valor_pedido:    r.valor_pedido ? Number(r.valor_pedido) : 0,
    subtotal:        r.SubTotal ? Number(r.SubTotal) : 0,
    total:           r.Total ? Number(r.Total) : 0,
  }))

  const BATCH = 1000
  for (let i = 0; i < orders.length; i += BATCH) {
    await Order.insertMany(orders.slice(i, i + BATCH), { ordered: false })
    process.stdout.write(`\r   Insertados: ${Math.min(i + BATCH, orders.length)} / ${orders.length}`)
  }
  console.log('\n   ✅ Orders insertados')

  // ── 3. Seed OrderDetails ───────────────────────────────────────────────────
  console.log('📋 Leyendo OrderDetails.csv...')
  const detailsRaw = readCSV(DETAILS_CSV)
  console.log(`   ${detailsRaw.length} filas`)

  const details = detailsRaw.map((r) => ({
    id_linea:              r.id_linea ? String(r.id_linea).trim() : null,
    id_pedido:             sciToStr(r.id_pedido),
    sku_solicitado:        sciToStr(r.sku_solicitado),
    nombre_sku_solicitado: (r.nombre_sku_solicitado || '').trim(),
    quantity:              r.Quantity ? Number(r.Quantity) : 1,
    status:                mapDetailStatus(r.Status),
  }))

  for (let i = 0; i < details.length; i += BATCH) {
    await OrderDetail.insertMany(details.slice(i, i + BATCH), { ordered: false })
    process.stdout.write(`\r   Insertados: ${Math.min(i + BATCH, details.length)} / ${details.length}`)
  }
  console.log('\n   ✅ OrderDetails insertados')

  // ── 4. Seed Resultados ─────────────────────────────────────────────────────
  console.log('📊 Leyendo Resultados.csv...')
  const resultadosRaw = readCSV(RESULTADOS_CSV)
  console.log(`   ${resultadosRaw.length} filas`)

  const resultados = resultadosRaw.map((r) => ({
    id_businessunit:              r.id_businessunit ? Number(r.id_businessunit) : null,
    id_linea:                     r.id_linea ? String(r.id_linea).trim() : null,
    id_pedido:                    sciToStr(r.id_pedido),
    sku_solicitado:               r.sku_solicitado ? String(r.sku_solicitado).trim() : null,
    sku_solicitado_hash:          sciToStr(r.sku_solicitado_hash),
    nombre_sku_solicitado:        (r.nombre_sku_solicitado || '').trim(),
    sku_solicitado_cambio:        r.sku_solicitado_cambio ? String(r.sku_solicitado_cambio).trim() : null,
    sku_solicitado_cambio_hash:   sciToStr(r.sku_solicitado_cambio_hash),
    nombre_sku_solicitado_cambio: (r.nombre_sku_solicitado_cambio || '').trim(),
  }))

  await Resultado.insertMany(resultados, { ordered: false })
  console.log(`   ✅ Resultados insertados (${resultados.length})`)

  console.log('\n🎉 Seed completo.')
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
