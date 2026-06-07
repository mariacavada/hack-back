/**
 * Indexer — convierte documentos de MongoDB en chunks con embeddings.
 *
 * Flujo:
 * 1. Lee los documentos originales (pedidos, productos, sustituciones)
 * 2. Los convierte a texto legible (chunks)
 * 3. Genera embeddings con Gemini
 * 4. Guarda en KnowledgeChunk
 *
 * Llamar cuando:
 * - Se crea/actualiza un pedido  → indexOrder(order_id)
 * - Se acepta/rechaza sustitución → indexSubstitution(log_id)
 * - Se actualiza el catálogo      → indexAllProducts()
 */

const { embedText, embedBatch } = require('./embed.service')
const KnowledgeChunk = require('../../models/KnowledgeChunk.model')
const Order = require('../../models/Order.model')
const OrderDetail = require('../../models/OrderDetail.model')
const Product = require('../../models/Product.model')
const SubstitutionLog = require('../../models/SubstitutionLog.model')
const TrackingPedido = require('../../models/TrackingPedido.model')

// ── PEDIDOS ───────────────────────────────────────────────────────────────────

/**
 * Indexa un pedido específico con su tracking y detalles.
 */
async function indexOrder(order_id) {
  const order = await Order.findById(order_id)
  if (!order) return

  const detalles = await OrderDetail.find({ id_pedido: order.id_pedido })
  const tracking = await TrackingPedido.findOne({ id_pedido: order.id_pedido })

  const itemsTexto = detalles
    .map((d) => `- ${d.nombre_sku_solicitado || d.sku_solicitado}: ${d.quantity} unidades (${d.status})`)
    .join('\n')

  const eventosTexto = tracking?.eventos
    ?.map((e) => `[${new Date(e.timestamp).toLocaleString('es-MX')}] ${e.status}: ${e.descripcion}`)
    .join('\n') || 'Sin eventos aún'

  const text = `
Pedido: ${order.id_pedido}
Estado actual: ${order.status_final}
Fecha pedido: ${order.fecha_pedido}
Total: $${order.total}
Productos:
${itemsTexto}
Historial de seguimiento:
${eventosTexto}
  `.trim()

  const embedding = await embedText(text)

  await KnowledgeChunk.findOneAndUpdate(
    { source: 'order', source_id: order.id_pedido, customer_id: String(order.customer_id) },
    {
      source: 'order',
      source_id: order.id_pedido,
      customer_id: String(order.customer_id),
      text,
      metadata: {
        id_pedido: order.id_pedido,
        status: order.status_final,
        total: order.total,
      },
      embedding,
      updated_at: new Date(),
    },
    { upsert: true }
  )

  console.log(`[RAG] Pedido indexado: ${order.id_pedido}`)
}

// ── PRODUCTOS ─────────────────────────────────────────────────────────────────

/**
 * Indexa todos los productos del catálogo.
 */
async function indexAllProducts() {
  const products = await Product.find({ estado: 'activo' })
  if (!products.length) return

  const texts = products.map((p) =>
    `Producto: ${p.nombre}
SKU: ${p.sku}
Categoría: ${p.categoria || 'N/A'}
Línea: ${p.linea || 'N/A'}
Precio unitario: $${p.precio_unitario}
Sustitutos compatibles: ${p.sustitutos_compatibles?.join(', ') || 'ninguno'}`.trim()
  )

  const embeddings = await embedBatch(texts)

  const ops = products.map((p, i) => ({
    updateOne: {
      filter: { source: 'product', source_id: p.sku },
      update: {
        $set: {
          source: 'product',
          source_id: p.sku,
          text: texts[i],
          metadata: { sku: p.sku, nombre: p.nombre, precio: p.precio_unitario },
          embedding: embeddings[i],
          updated_at: new Date(),
        },
      },
      upsert: true,
    },
  }))

  await KnowledgeChunk.bulkWrite(ops)
  console.log(`[RAG] ${products.length} productos indexados`)
}

// ── SUSTITUCIONES ─────────────────────────────────────────────────────────────

/**
 * Indexa el historial de sustituciones de un cliente.
 */
async function indexCustomerSubstitutions(customer_id) {
  const logs = await SubstitutionLog.find({ customer_id }).sort({ logged_at: -1 }).limit(50)
  if (!logs.length) return

  const text = `Historial de sustituciones del cliente:
${logs.map((l) =>
    `- Pedido ${l.order_id}: "${l.original_name}" → "${l.substitute_name}" | ${l.accepted_by_user ? 'ACEPTADO ✓' : l.accepted_by_user === false ? 'RECHAZADO ✗' : 'PENDIENTE'}`
  ).join('\n')}`

  const embedding = await embedText(text)

  await KnowledgeChunk.findOneAndUpdate(
    { source: 'substitution', customer_id: String(customer_id) },
    {
      source: 'substitution',
      source_id: String(customer_id),
      customer_id: String(customer_id),
      text,
      metadata: { total_sustituciones: logs.length },
      embedding,
      updated_at: new Date(),
    },
    { upsert: true }
  )

  console.log(`[RAG] Sustituciones indexadas para cliente: ${customer_id}`)
}

// ── FAQ / CONTEXTO GENERAL ────────────────────────────────────────────────────

/**
 * Indexa preguntas frecuentes y contexto de la app.
 * Correr una sola vez al arrancar.
 */
async function indexFAQ() {
  const faqs = [
    {
      id: 'estados_pedido',
      text: `Estados de un pedido:
- pendiente: el pedido fue recibido y está esperando confirmación
- confirmado: el equipo confirmó el pedido y se está preparando
- asignado: se asignó un repartidor
- en_camino: el repartidor ya salió con el pedido
- entregado: el pedido fue entregado exitosamente
- incompleto: el pedido fue entregado pero con faltantes o sustituciones
- cancelado: el pedido fue cancelado`,
    },
    {
      id: 'sustituciones',
      text: `Sustituciones: cuando un producto no está disponible, el sistema sugiere alternativas similares. El cliente puede aceptar o rechazar la sustitución. Si la acepta, el producto sustituto se entrega en su lugar.`,
    },
    {
      id: 'tracking',
      text: `Tracking de pedido: puedes ver el estado de tu pedido en tiempo real. Cada cambio de estado genera un evento con fecha y hora. El repartidor actualiza la ubicación conforme avanza la entrega.`,
    },
    {
      id: 'reorden',
      text: `Reorden automático: el sistema analiza tus patrones de compra y te notifica cuando es momento de hacer un nuevo pedido basándose en tu historial.`,
    },
  ]

  const embeddings = await embedBatch(faqs.map((f) => f.text))

  const ops = faqs.map((f, i) => ({
    updateOne: {
      filter: { source: 'faq', source_id: f.id },
      update: {
        $set: {
          source: 'faq',
          source_id: f.id,
          text: f.text,
          metadata: { faq_id: f.id },
          embedding: embeddings[i],
          updated_at: new Date(),
        },
      },
      upsert: true,
    },
  }))

  await KnowledgeChunk.bulkWrite(ops)
  console.log('[RAG] FAQs indexadas')
}

module.exports = { indexOrder, indexAllProducts, indexCustomerSubstitutions, indexFAQ }
