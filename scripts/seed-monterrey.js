/**
 * seed-monterrey.js
 * 20 órdenes de Bebidas del cedis 3501 (Zona Metropolitana de Monterrey)
 * + clientes con nombre, ubicación real ZMM
 * + cedis con coordenadas reales
 * + 5 repartidores distribuidos por zona
 */

require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const bcrypt   = require('bcrypt')
const { parse } = require('csv-parse/sync')

const Order       = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const Product     = require('../models/Product.model')
const Customer    = require('../models/Customer.model')
const Driver      = require('../models/Driver.model')
const Cedis       = require('../models/Cedis.model')

const CSV_DIR = path.join(process.env.HOME, 'Desktop/hack/hack-web')

// ── Helpers ────────────────────────────────────────────────────────────────
function sciToStr(val) {
  if (!val || val === 'NULL' || val === '') return null
  const n = parseFloat(val)
  if (isNaN(n)) return String(val).trim()
  return n.toFixed(0)
}
function mapStatus(s) {
  return { entregado: 'entregado', registrado: 'pendiente' }[(s || '').toLowerCase()] || 'pendiente'
}
function mapDetailStatus(s) {
  return { entregado: 'entregado', registrado: 'registrado', faltante: 'faltante', sustituido: 'sustituido' }[(s || '').toLowerCase()] || 'registrado'
}
function inferCategoria(nombre) {
  const n = nombre.toLowerCase()
  if (n.includes('coca') || n.includes('fanta') || n.includes('sprite') || n.includes('fresca') || n.includes('joya') || n.includes('inca') || n.includes('sidral') || n.includes('delaware') || n.includes('frutsi') || n.includes('pulpy') || n.includes('fury') || n.includes('mundet')) return 'Refresco'
  if (n.includes('agua') || n.includes('ciel') || n.includes('topo') || n.includes('dasani')) return 'Agua'
  if (n.includes('powerade') || n.includes('monster')) return 'Bebida Deportiva'
  if (n.includes('fuze tea') || n.includes(' tea')) return 'Té'
  if (n.includes('del valle') || n.includes('valle frut')) return 'Jugos y Néctares'
  if (n.includes('yogurt') || n.includes('gelatina') || n.includes('leche saborizada') || n.includes('manjar')) return 'Lácteos Toni'
  if (n.includes('leche') || n.includes('santa clara') || n.includes('avena')) return 'Lácteos'
  if (n.includes('caffe') || n.includes('café')) return 'Café'
  if (n.includes('whisky') || n.includes('vodka') || n.includes('johnnie') || n.includes('smirnoff')) return 'Licores'
  if (n.includes('telefonía') || n.includes('tarjeta')) return 'Telecomunicaciones'
  if (n.includes('sal ') || n.includes('sopa') || n.includes('atole') || n.includes('mostaza')) return 'Abarrotes'
  if (n.includes('en ') || n.includes('familia')) return 'Combo'
  return 'Bebidas'
}
function inferPrecio(nombre) {
  const n = nombre.toLowerCase()
  if (n.includes('en ') || n.includes('familia') || n.includes('12un') || n.includes('10un') || n.includes('6un')) return +(80 + Math.random() * 120).toFixed(2)
  if (n.includes('johnnie') || n.includes('vodka') || n.includes('smirnoff')) return +(350 + Math.random() * 200).toFixed(2)
  if (n.includes('monster')) return +(38 + Math.random() * 12).toFixed(2)
  if (n.includes('950') || n.includes('900') || n.includes('1l') || n.includes('1.0')) return +(24 + Math.random() * 8).toFixed(2)
  if (n.includes('110') || n.includes('120') || n.includes('92')) return +(9 + Math.random() * 4).toFixed(2)
  if (n.includes('tarjeta')) return +(15 + Math.random() * 85).toFixed(2)
  if (n.includes('agua') || n.includes('ciel') || n.includes('topo') || n.includes('dasani')) return +(11 + Math.random() * 7).toFixed(2)
  return +(14 + Math.random() * 8).toFixed(2)
}

// ── Datos reales ZMM ───────────────────────────────────────────────────────

// 20 clientes con nombres mexicanos y ubicaciones reales en la ZMM
const CLIENTES_ZMM = [
  { nombre: 'Abarrotes La Esperanza',    email: 'laesperanza@zmm.com',    telefono: '8112340001', colonia: 'Col. Independencia',       municipio: 'Monterrey',            lat: 25.6650, lng: -100.3180 },
  { nombre: 'Tienda Don Ramón',           email: 'donramon@zmm.com',       telefono: '8112340002', colonia: 'Col. Mitras Centro',        municipio: 'Monterrey',            lat: 25.6890, lng: -100.3420 },
  { nombre: 'Mini Super Lupita',          email: 'lupita@zmm.com',         telefono: '8112340003', colonia: 'Col. Linda Vista',          municipio: 'Guadalupe',            lat: 25.6780, lng: -100.2630 },
  { nombre: 'Abarrotes El Norteño',      email: 'elnorteno@zmm.com',      telefono: '8112340004', colonia: 'Col. Las Puentes',          municipio: 'San Nicolás',          lat: 25.7480, lng: -100.2870 },
  { nombre: 'Depósito La Paloma',         email: 'lapaloma@zmm.com',       telefono: '8112340005', colonia: 'Col. Del Prado',            municipio: 'Monterrey',            lat: 25.6720, lng: -100.3050 },
  { nombre: 'Tienda La Loma',             email: 'lalom@zmm.com',          telefono: '8112340006', colonia: 'Col. Loma Larga',           municipio: 'Monterrey',            lat: 25.6600, lng: -100.3290 },
  { nombre: 'Super Beto',                 email: 'superbeto@zmm.com',      telefono: '8112340007', colonia: 'Fracc. Las Américas',       municipio: 'Ecobedo',              lat: 25.7950, lng: -100.3200 },
  { nombre: 'Refresquería El Güero',      email: 'elguero@zmm.com',        telefono: '8112340008', colonia: 'Col. Cumbres',              municipio: 'Monterrey',            lat: 25.7320, lng: -100.3670 },
  { nombre: 'Abarrotes La Bendición',    email: 'labendicion@zmm.com',    telefono: '8112340009', colonia: 'Col. Contry',               municipio: 'Monterrey',            lat: 25.6560, lng: -100.2800 },
  { nombre: 'Mini Mercado San José',      email: 'sanjose@zmm.com',        telefono: '8112340010', colonia: 'Col. Apodaca Centro',       municipio: 'Apodaca',              lat: 25.7800, lng: -100.1880 },
  { nombre: 'Depósito Los Compadres',     email: 'loscompadres@zmm.com',   telefono: '8112340011', colonia: 'Col. San Bernabé',          municipio: 'Monterrey',            lat: 25.7100, lng: -100.3800 },
  { nombre: 'Abarrotes Garza Hnos.',     email: 'garzahnos@zmm.com',      telefono: '8112340012', colonia: 'Col. Terminal',             municipio: 'Monterrey',            lat: 25.6700, lng: -100.2950 },
  { nombre: 'Tienda Doña Carmen',         email: 'donacarmen@zmm.com',     telefono: '8112340013', colonia: 'Col. Moderna',              municipio: 'Guadalupe',            lat: 25.6730, lng: -100.2540 },
  { nombre: 'Mini Super El Cerro',        email: 'elcerro@zmm.com',        telefono: '8112340014', colonia: 'Col. Sierra Ventana',       municipio: 'San Pedro',            lat: 25.6400, lng: -100.4200 },
  { nombre: 'Bodeguita La Central',       email: 'lacentral@zmm.com',      telefono: '8112340015', colonia: 'Col. Industrial Vallejo',   municipio: 'San Nicolás',          lat: 25.7550, lng: -100.3000 },
  { nombre: 'Depósito El Parque',         email: 'elparque@zmm.com',       telefono: '8112340016', colonia: 'Col. Nuevo Repueblo',       municipio: 'Monterrey',            lat: 25.6580, lng: -100.3000 },
  { nombre: 'Abarrotes El Roble',        email: 'elroble@zmm.com',        telefono: '8112340017', colonia: 'Col. Valle del Roble',      municipio: 'San Nicolás',          lat: 25.7400, lng: -100.3100 },
  { nombre: 'Mini Super La Cruz',         email: 'lacruz@zmm.com',         telefono: '8112340018', colonia: 'Col. Roma',                 municipio: 'Monterrey',            lat: 25.6820, lng: -100.3350 },
  { nombre: 'Tienda Los Pinos',           email: 'lospinos@zmm.com',       telefono: '8112340019', colonia: 'Col. Santa Rosa',           municipio: 'Santa Catarina',       lat: 25.6740, lng: -100.4580 },
  { nombre: 'Abarrotes La Fe',           email: 'lafe@zmm.com',           telefono: '8112340020', colonia: 'Col. Vista Hermosa',        municipio: 'Monterrey',            lat: 25.7050, lng: -100.3520 },
]

// 5 repartidores con zonas de Monterrey
const REPARTIDORES = [
  { nombre: 'Carlos Martínez Vega',      email: 'carlos.martinez@rep3501.com', telefono: '8119000001', placa: 'NL-X4820', lat: 25.6950, lng: -100.2800, zona: 'Norte' },
  { nombre: 'Luis Hernández Treviño',    email: 'luis.hernandez@rep3501.com',  telefono: '8119000002', placa: 'NL-R7743', lat: 25.7100, lng: -100.3600, zona: 'Norponiente' },
  { nombre: 'José Garza Ramírez',        email: 'jose.garza@rep3501.com',      telefono: '8119000003', placa: 'NL-K2291', lat: 25.6600, lng: -100.3200, zona: 'Centro' },
  { nombre: 'Miguel Flores Cantú',       email: 'miguel.flores@rep3501.com',   telefono: '8119000004', placa: 'NL-T5567', lat: 25.6500, lng: -100.4100, zona: 'Sur' },
  { nombre: 'Roberto Sánchez Morales',   email: 'roberto.sanchez@rep3501.com', telefono: '8119000005', placa: 'NL-P3398', lat: 25.7800, lng: -100.1900, zona: 'Oriente' },
]

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Conectado a MongoDB')

  // Limpiar
  await Promise.all([
    Order.deleteMany({}), OrderDetail.deleteMany({}),
    Product.deleteMany({}), Customer.deleteMany({}),
    Driver.deleteMany({}), Cedis.deleteMany({}),
  ])
  console.log('🗑  Colecciones limpiadas')

  // ── Cedis 3501 — Zona Metropolitana de Monterrey ─────────────────────────
  const cedis = await Cedis.create({
    cedis_id:        '3501',
    nombre:          'CEDIS Monterrey Norte',
    pais:            'México',
    ciudad:          'Monterrey',
    direccion:       'Av. Díaz Ordaz 2300, Parque Industrial Monterrey, Apodaca, N.L.',
    telefono:        '8118001000',
    id_businessunit: 1,
    ubicacion: {
      lat:       25.7760,
      lng:       -100.2050,
      direccion: 'Av. Díaz Ordaz 2300, Parque Industrial',
      municipio: 'Apodaca',
    },
    estado: 'activo',
  })
  console.log('🏭 Cedis creado:', cedis.nombre)

  // ── Repartidores ─────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('password123', 10)
  const driversCreados = []
  for (const d of REPARTIDORES) {
    const driver = await Driver.create({
      nombre:              d.nombre,
      email:               d.email,
      password_hash:       hash,
      telefono:            d.telefono,
      cedis_id:            '3501',
      vehiculo_placa:      d.placa,
      calificacion_promedio: +(3.8 + Math.random() * 1.2).toFixed(1),
      ubicacion_actual:    { lat: d.lat, lng: d.lng },
      estado:              'activo',
    })
    driversCreados.push(driver)
    console.log(`🚚 Repartidor: ${d.nombre} (zona ${d.zona})`)
  }

  // ── Leer CSV ──────────────────────────────────────────────────────────────
  const ordersRaw  = parse(fs.readFileSync(path.join(CSV_DIR, 'Orders.csv'), 'utf8').replace(/^﻿/, ''),      { columns: true, skip_empty_lines: true, trim: true })
  const detailsRaw = parse(fs.readFileSync(path.join(CSV_DIR, 'OrderDetails.csv'), 'utf8').replace(/^﻿/, ''), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })

  const top20 = ordersRaw.filter(r => r.cedis === '3501' && r.pais === 'México').slice(0, 20)
  const ids20 = new Set(top20.map(r => sciToStr(r.id_pedido)))
  const detalles20 = detailsRaw.filter(r => ids20.has(sciToStr(r.id_pedido)))

  console.log(`\n📦 Órdenes seleccionadas: ${top20.length} | Items: ${detalles20.length}`)

  // ── Clientes — 1 por orden con datos ZMM ─────────────────────────────────
  const clienteIds = [...new Set(top20.map(r => sciToStr(r.customer_id)))]
  const clientesCreados = {}

  for (let i = 0; i < clienteIds.length; i++) {
    const cid   = clienteIds[i]
    const datos = CLIENTES_ZMM[i]
    const customer = await Customer.create({
      customer_id:     cid,
      nombre_negocio:  datos.nombre,
      email:           datos.email,
      password_hash:   hash,
      telefono:        datos.telefono,
      pais:            'México',
      id_businessunit: 1,
      business_unit:   'Bebidas',
      cedis_asignado:  '3501',
      estado:          'activo',
      ubicacion: {
        lat:       datos.lat,
        lng:       datos.lng,
        direccion: `${datos.colonia}, ${datos.municipio}, N.L.`,
        colonia:   datos.colonia,
        municipio: datos.municipio,
      },
    })
    clientesCreados[cid] = customer._id
  }
  console.log(`👤 ${clienteIds.length} clientes creados con ubicaciones ZMM`)

  // ── Orders ────────────────────────────────────────────────────────────────
  // Asignar repartidor al pedido de forma round-robin por zona
  const orders = top20.map((r, i) => ({
    id_pedido:       sciToStr(r.id_pedido),
    customer_id:     String(clientesCreados[sciToStr(r.customer_id)]),
    pais:            'México',
    id_businessunit: 1,
    business_unit:   'Bebidas',
    cedis_id:        '3501',
    driver_id:       driversCreados[i % driversCreados.length]._id,
    fecha_pedido:    r.fecha_pedido || null,
    fecha_entrega:   (r.fecha_entrega && r.fecha_entrega !== 'NULL') ? r.fecha_entrega : null,
    status_final:    mapStatus(r.status_final),
    valor_pedido:    r.valor_pedido ? Number(r.valor_pedido) : 0,
    subtotal:        r.SubTotal     ? Number(r.SubTotal)     : 0,
    total:           r.Total        ? Number(r.Total)        : 0,
  }))
  await Order.insertMany(orders)
  console.log('✅ Orders:', orders.length)

  // ── OrderDetails ──────────────────────────────────────────────────────────
  const details = detalles20.map(r => ({
    id_linea:              r.id_linea ? String(r.id_linea).trim() : null,
    id_pedido:             sciToStr(r.id_pedido),
    sku_solicitado:        sciToStr(r.sku_solicitado),
    nombre_sku_solicitado: (r.nombre_sku_solicitado || '').trim(),
    quantity:              r.Quantity ? Number(r.Quantity) : 1,
    status:                mapDetailStatus(r.Status),
  }))
  await OrderDetail.insertMany(details, { ordered: false })
  console.log('✅ OrderDetails:', details.length)

  // ── Productos ─────────────────────────────────────────────────────────────
  const skuMap = {}
  for (const d of details) {
    if (d.sku_solicitado && d.nombre_sku_solicitado && !skuMap[d.sku_solicitado])
      skuMap[d.sku_solicitado] = d.nombre_sku_solicitado.trim()
  }
  const productos = Object.entries(skuMap).map(([sku, nombre]) => ({
    sku,
    nombre,
    precio_unitario: inferPrecio(nombre),
    categoria:       inferCategoria(nombre),
    estado:          'activo',
  }))
  await Product.insertMany(productos, { ordered: false })
  console.log('✅ Productos:', productos.length)

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════')
  console.log('🎉 Seed Monterrey completo')
  console.log('─── Accesos ─────────────────────────────')
  console.log('🔑 Contraseña de todos: password123')
  console.log('🏭 Cedis: CEDIS Monterrey Norte (3501)')
  console.log('👤 Clientes: cliente1@zmm.com … laesperanza@zmm.com')
  console.log('🚚 Repartidores: carlos.martinez@rep3501.com … roberto.sanchez@rep3501.com')
  console.log('═══════════════════════════════════════════')

  await mongoose.disconnect()
}

main().catch(err => { console.error('❌', err.message); process.exit(1) })
