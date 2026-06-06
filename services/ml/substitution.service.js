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
  // 1. Historial de sustituciones del cliente para este SKU
  const historial = await SubstitutionLog.find({
    customer_id,
    original_sku,
  }).select('substitute_sku substitute_name accepted_by_user logged_at')

  // 2. Producto original (para saber categoría y precio)
  const productoOriginal = await Product.findOne({ sku: original_sku })
    .select('name category business_unit price')

  // 3. Productos disponibles en el cedis de la misma categoría
  const candidatos = await Product.find({
    cedis_id,
    category: productoOriginal?.category,
    sku: { $ne: original_sku },
    stock: { $gt: 0 },
    is_available: true,
  }).select('sku name price stock').limit(20)

  if (candidatos.length === 0) {
    return { sugerencias: [], mensaje: 'No hay sustitutos disponibles en este cedis.' }
  }

  // 4. Perfil del cliente (nombre para personalizar mensaje)
  const cliente = await Customer.findById(customer_id).select('name')

  // 5. Prompt a Gemini
  const prompt = `
Eres un asistente de sustitución de productos para una distribuidora de bebidas en México.

Producto original agotado:
- SKU: ${original_sku}
- Nombre: ${productoOriginal?.name ?? 'Desconocido'}
- Categoría: ${productoOriginal?.category ?? 'N/A'}
- Precio: $${productoOriginal?.price ?? 0}

Historial de sustituciones del cliente para este producto:
${historial.length > 0 ? JSON.stringify(historial) : 'Sin historial previo.'}

Candidatos disponibles en el mismo cedis:
${JSON.stringify(candidatos)}

Instrucciones:
- Prioriza productos que el cliente haya ACEPTADO antes (accepted_by_user: true)
- Descarta productos que haya RECHAZADO (accepted_by_user: false)
- Considera similitud de nombre, categoría y precio
- Si no hay historial, ranquea por similitud de nombre y precio más cercano
- Devuelve máximo 3 sugerencias

Responde ÚNICAMENTE con JSON válido:
{
  "sugerencias": [
    {
      "sku": "string",
      "name": "string",
      "price": number,
      "score_afinidad": number,
      "razon": "string en español, 1 oración"
    }
  ],
  "mensaje": "Mensaje amigable en español para el cliente explicando la situación"
}
`

  const result = await askGemini(prompt)

  // 6. Notificar al usuario
  await Notification.create({
    user_id: customer_id,
    user_role: 'usuario',
    type: 'product_unavailable',
    title: `⚠️ Producto no disponible`,
    body: result.mensaje,
    metadata: {
      original_sku,
      order_id,
      sugerencias: result.sugerencias,
    },
    channel: 'in_app',
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
