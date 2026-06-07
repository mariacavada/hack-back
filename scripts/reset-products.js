/**
 * Borra todos los productos, pedidos y orderdetails,
 * y crea los 20 productos reales del cedis 3501.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const Product     = require('../models/Product.model')
const Order       = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const InventarioCedis = require('../models/InventarioCedis.model')

const CEDIS_ID = '3501'

const PRODUCTOS = [
  { sku: '6267870000000000000', nombre: 'Coca-Cola Original',           categoria: 'Refrescos',    precio_unitario: 18 },
  { sku: '1861550000000000000', nombre: 'Coca-Cola Original 6UN 1L',    categoria: 'Refrescos',    precio_unitario: 95 },
  { sku: '8982250000000000000', nombre: 'Coca-Cola Original 120UN 300ML',categoria: 'Refrescos',   precio_unitario: 320 },
  { sku: '6529950000000000000', nombre: 'Coca-Cola Original 10UN 1.25L', categoria: 'Refrescos',   precio_unitario: 145 },
  { sku: '7389380000000000000', nombre: 'Coca-Cola TA SA',               categoria: 'Refrescos',    precio_unitario: 22 },
  { sku: '6915420000000000000', nombre: 'Ciel Agua Purificada',          categoria: 'Aguas',        precio_unitario: 12 },
  { sku: '4009890000000000000', nombre: 'Topo Chico Agua Mineral',       categoria: 'Aguas',        precio_unitario: 17 },
  { sku: '2681880000000000000', nombre: 'Topo Chico Sangría',            categoria: 'Aguas',        precio_unitario: 19 },
  { sku: '3346100000000000000', nombre: 'Fanta Naranja',                 categoria: 'Refrescos',    precio_unitario: 16 },
  { sku: '8424430000000000000', nombre: 'Sprite Lima Limón',             categoria: 'Refrescos',    precio_unitario: 16 },
  { sku: '5909570000000000000', nombre: 'Fresca Toronja',                categoria: 'Refrescos',    precio_unitario: 16 },
  { sku: '2918430000000000000', nombre: 'Sidral Mundet Manzana',         categoria: 'Refrescos',    precio_unitario: 16 },
  { sku: '3319840000000000000', nombre: 'Familia Coca-Cola',             categoria: 'Refrescos',    precio_unitario: 85 },
  { sku: '1760730000000000000', nombre: 'Del Valle Guayaba',             categoria: 'Jugos',        precio_unitario: 14 },
  { sku: '5349290000000000000', nombre: 'Del Valle Mango',               categoria: 'Jugos',        precio_unitario: 14 },
  { sku: '1728590000000000000', nombre: 'Del Valle Durazno 6UN 250ML',   categoria: 'Jugos',        precio_unitario: 72 },
  { sku: '990479000000000000',  nombre: 'Valle Frut Citrus Punch',       categoria: 'Jugos',        precio_unitario: 13 },
  { sku: '4491520000000000000', nombre: 'Powerade Moras',                categoria: 'Deportivas',   precio_unitario: 22 },
  { sku: '2490270000000000000', nombre: 'Joya Manzana',                  categoria: 'Jugos',        precio_unitario: 13 },
  { sku: '2918430000000000000', nombre: 'Sidral Mundet Manzana 2L',      categoria: 'Refrescos',    precio_unitario: 28 },
]

// Deduplicar por SKU
const uniqueProds = [...new Map(PRODUCTOS.map(p => [p.sku, p])).values()]

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Conectado a MongoDB')

  // 1. Borrar todo
  await Promise.all([
    Product.deleteMany({}),
    Order.deleteMany({ id_pedido: /^PED-/ }),  // solo pedidos nuevos
    OrderDetail.deleteMany({ id_pedido: /^PED-/ }),
    TrackingPedido.deleteMany({ id_pedido: /^PED-/ }),
    InventarioCedis.deleteMany({}),
  ])
  // Borrar también las órdenes del seed numérico
  await Order.deleteMany({})
  await OrderDetail.deleteMany({})
  await TrackingPedido.deleteMany({})
  console.log('Colecciones limpiadas')

  // 2. Crear productos
  const docs = uniqueProds.map(p => ({
    ...p,
    estado: 'activo',
    sustitutos_compatibles: [],
  }))
  await Product.insertMany(docs)
  console.log('Productos creados:', docs.length)

  // 3. Crear inventario para cada producto
  const inv = docs.map(p => ({
    cedis_id: CEDIS_ID,
    sku: p.sku,
    stock_disponible: Math.floor(Math.random() * 200) + 50,
    stock_reservado:  Math.floor(Math.random() * 10),
    stock_minimo:     20,
    stock_critico:    10,
    stock_maximo:     500,
    ultima_entrada:   new Date(Date.now() - Math.random() * 7 * 86400000),
    ultima_salida:    new Date(Date.now() - Math.random() * 3 * 86400000),
  }))
  await InventarioCedis.insertMany(inv)
  console.log('Inventario creado:', inv.length)

  console.log('\n✅ Listo. Productos finales:')
  docs.forEach((p,i) => console.log(`  ${i+1}. ${p.nombre} | $${p.precio_unitario} | ${p.categoria}`))

  mongoose.disconnect()
}

run().catch(e => { console.error(e.message); process.exit(1) })
