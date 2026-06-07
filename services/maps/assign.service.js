/**
 * Asignación inteligente de repartidor usando Gemini.
 * Considera: distancia, ETA, calificación y carga actual de pedidos.
 */

const { calcularETAs } = require('./distance.service')
const { askGeminiText } = require('../../utils/gemini')
const Driver = require('../../models/Driver.model')
const Order  = require('../../models/Order.model')

/**
 * Asigna el mejor repartidor disponible a un pedido.
 * @param {object} order        - Documento Order con customer_id ya populado
 * @param {{ lat, lng, direccion, municipio }} ubicacionCliente
 * @returns {{ driver, razon, eta_minutos, distancia_km }}
 */
async function asignarRepartidor(order, ubicacionCliente) {
  // 1. Obtener repartidores activos del mismo cedis
  const repartidores = await Driver.find({
    cedis_id: order.cedis_id,
    estado:   'activo',
  }).lean()

  if (!repartidores.length) throw new Error('No hay repartidores disponibles en este cedis')

  // 2. Calcular pedidos activos por repartidor (carga de trabajo)
  const cargaPorDriver = {}
  const pedidosActivos = await Order.find({
    driver_id:    { $in: repartidores.map(r => r._id) },
    status_final: { $in: ['asignado', 'en_camino'] },
  }).lean()
  pedidosActivos.forEach(p => {
    const key = String(p.driver_id)
    cargaPorDriver[key] = (cargaPorDriver[key] || 0) + 1
  })

  // 3. Calcular distancias y ETAs
  const opciones = calcularETAs(ubicacionCliente, repartidores).map(o => ({
    ...o,
    pedidos_activos: cargaPorDriver[o.driver_id] || 0,
  }))

  // 4. Construir prompt para Gemini
  const prompt = `
Eres un sistema de asignación de repartidores para una empresa de distribución de bebidas en Monterrey, México.

PEDIDO A ASIGNAR:
- ID: ${order.id_pedido}
- Destino: ${ubicacionCliente.direccion || 'Zona Metropolitana de Monterrey'}
- Municipio: ${ubicacionCliente.municipio || 'Monterrey'}
- Total del pedido: $${order.total} MXN

REPARTIDORES DISPONIBLES:
${opciones.map((o, i) => `
${i + 1}. ${o.nombre}
   - Distancia desde su posición actual: ${o.distancia_km} km
   - ETA estimado: ${o.eta_minutos} minutos
   - Calificación promedio: ${o.calificacion}/5.0
   - Pedidos activos en este momento: ${o.pedidos_activos}
`).join('')}

CRITERIOS DE DECISIÓN (en orden de prioridad):
1. Menor tiempo de llegada al cliente (ETA)
2. Menor carga de trabajo (pedidos activos)
3. Mayor calificación promedio

Responde EXACTAMENTE en este formato (sin nada más):
REPARTIDOR: [nombre exacto del repartidor elegido]
RAZÓN: [explicación breve en 1-2 oraciones en español]
ETA: [número de minutos]
DISTANCIA: [número de km]
`

  const respuesta = await askGeminiText(prompt)

  // 5. Parsear respuesta de Gemini
  const lines = respuesta.split('\n').map(l => l.trim()).filter(Boolean)
  const get = (prefix) => {
    const line = lines.find(l => l.toUpperCase().startsWith(prefix.toUpperCase()))
    return line ? line.split(':').slice(1).join(':').trim() : null
  }

  const nombreElegido = get('REPARTIDOR')
  const razon         = get('RAZÓN') || get('RAZON')
  const etaGemini     = parseInt(get('ETA')) || null
  const distGemini    = parseFloat(get('DISTANCIA')) || null

  // Buscar el driver que coincide con el nombre
  const driverElegido = repartidores.find(r =>
    nombreElegido && r.nombre.toLowerCase().includes(nombreElegido.toLowerCase().split(' ')[0])
  ) || repartidores[0]

  const opcionElegida = opciones.find(o => o.driver_id === String(driverElegido._id)) || opciones[0]

  return {
    driver:       driverElegido,
    razon:        razon || 'Mejor balance entre distancia y disponibilidad',
    eta_minutos:  etaGemini  || opcionElegida.eta_minutos,
    distancia_km: distGemini || opcionElegida.distancia_km,
    todas_opciones: opciones,
  }
}

module.exports = { asignarRepartidor }
