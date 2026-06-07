/**
 * ML Módulo 3 — Sustitución inteligente personalizada
 *
 * Flujo:
 * 1. El producto original está sin stock
 * 2. Se consultan los logs históricos de sustitución (qué aceptó/rechazó este cliente)
 * 3. Se consultan los productos disponibles en el mismo cedis y categoría
 * 4. Gemini ranquea las opciones considerando el perfil del cliente
 * 5. Se devuelven máximo 3 sugerencias ordenadas por afinidad
 * 6. Se crea notificación "product_unavailable" con las opciones
 */

const { askGemini } = require('../../utils/gemini')
const SubstitutionLog = require('../../models/SubstitutionLog.model')
const Product = require('../../models/Product.model')
const Notification = require('../../models/Notification.model')
const Customer = require('../../models/Customer.model')

/**
 * Sugiere sustitutos para un producto agotado, personalizado por cliente.
 * @param {string} customer_id
 * @param {string} original_sku
 * @param {string} cedis_id
 * @param {string} order_id  - para asociar la notificación
 */
async function suggestSubstitutes(customer_id, original_sku, cedis_id, order_id = null) {
  const InventarioCedis = require('../../models/InventarioCedis.model')

  // 1. Historial de sustituciones del cliente
  const historial = await SubstitutionLog.find({ customer_id, original_sku })
    .select('substitute_sku substitute_name accepted_by_user logged_at').lean()

  // 2. Producto original
  const productoOriginal = await Product.findOne({ sku: original_sku })
    .select('nombre categoria precio_unitario').lean()

  // 3. Productos del mismo cedis con stock disponible (misma categoría preferida)
  const skusConStock = await InventarioCedis.find({
    cedis_id,
    stock_disponible: { $gt: 0 },
    sku: { $ne: original_sku },
  }).select('sku stock_disponible').lean()

  const skus = skusConStock.map(i => i.sku)
  const candidatos = await Product.find({
    sku: { $in: skus },
    estado: 'activo',
    categoria: productoOriginal?.categoria,
  }).select('sku nombre categoria precio_unitario').limit(10).lean()

  // Si no hay de la misma categoría, traer de cualquier categoría
  const fallback = candidatos.length === 0
    ? await Product.find({ sku: { $in: skus }, estado: 'activo' }).select('sku nombre categoria precio_unitario').limit(10).lean()
    : candidatos

  if (fallback.length === 0) {
    return { sugerencias: [], mensaje: 'No hay sustitutos disponibles en este cedis.' }
  }

  // 4. Nombre del cliente para personalizar
  const cliente = await Customer.findById(customer_id).select('nombre_negocio').lean()

  // 5. Prompt a Gemini
  const prompt = `
Eres un asistente de sustitución de productos para una distribuidora de bebidas FEMSA en México.

Producto original agotado:
- SKU: ${original_sku}
- Nombre: ${productoOriginal?.nombre ?? 'Desconocido'}
- Categoría: ${productoOriginal?.categoria ?? 'N/A'}
- Precio: $${productoOriginal?.precio_unitario ?? 0}

Cliente: ${cliente?.nombre_negocio ?? 'Cliente'}

Historial de sustituciones previas de este cliente para este producto:
${historial.length > 0 ? historial.map(h => `- ${h.substitute_name}: ${h.accepted_by_user ? 'ACEPTÓ' : 'RECHAZÓ'}`).join('\n') : 'Sin historial previo.'}

Productos disponibles como sustituto:
${fallback.map(p => `- SKU: ${p.sku} | ${p.nombre} | $${p.precio_unitario} | ${p.categoria}`).join('\n')}

Instrucciones:
- Prioriza productos que el cliente haya ACEPTADO antes
- Descarta productos que haya RECHAZADO
- Considera similitud de nombre, categoría y precio
- Si no hay historial, ranquea por similitud y precio más cercano
- Máximo 3 sugerencias

Responde ÚNICAMENTE con JSON válido (sin markdown):
{
  "sugerencias": [
    { "sku": "string", "nombre": "string", "precio": number, "score": number, "razon": "1 oración en español" }
  ],
  "mensaje": "Mensaje amigable en español para el cliente explicando la sustitución"
}
`

  const result = await askGemini(prompt)

  // 6. Notificar al cliente
  await Notification.create({
    customer_id: String(customer_id),
    titulo: '⚠️ Novedad en tu pedido',
    mensaje: result.mensaje || `El producto ${productoOriginal?.nombre} no está disponible. Te sugerimos una alternativa.`,
    tipo: 'sustitucion',
    prioridad: 'alta',
    metadata: { original_sku, order_id, sugerencias: result.sugerencias },
  })

  return result
}

/**
 * Después de que el usuario acepta/rechaza, actualiza el log.
 * Llamar desde el endpoint PATCH /orders/:id/substitution/:sku
 */
async function recordSubstitutionFeedback({
  order_id,
  customer_id,
  original_sku,
  original_name,
  substitute_sku,
  substitute_name,
  accepted,
  suggested_by = 'gemini',
  reason_unavailable = 'sin_stock',
}) {
  return SubstitutionLog.create({
    order_id,
    customer_id,
    original_sku,
    original_name,
    substitute_sku,
    substitute_name,
    suggested_by,
    accepted_by_user: accepted,
    reason_unavailable,
    logged_at: new Date(),
  })
}

module.exports = { suggestSubstitutes, recordSubstitutionFeedback }
