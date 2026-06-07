/**
 * Asignación inteligente de repartidor usando Gemini.
 *
 * REDISEÑO: en vez de elegir "quién está más cerca AHORA MISMO" (que tiene
 * sentido para delivery inmediato pero no para pedidos agendados con días de
 * anticipación), la asignación se basa en:
 *
 *   1. La FECHA DE ENTREGA que eligió el cliente — buscamos qué repartidores
 *      ya tienen otras entregas agendadas ESE MISMO DÍA.
 *   2. La UBICACIÓN del cliente — comparada contra el "clúster" de entregas
 *      que cada repartidor ya tiene para ese día (no contra su posición GPS
 *      actual, que para un pedido de dentro de varios días es irrelevante).
 *
 * La idea: si el Repartidor A ya tiene 3 entregas agendadas en la colonia X
 * para el jueves, y el nuevo pedido también es en la colonia X para el
 * jueves, conviene asignárselo a A — su ruta de ese día sigue siendo
 * compacta y eficiente — aunque ahora mismo esté del otro lado de la ciudad.
 *
 * Si un repartidor todavía no tiene nada agendado ese día, usamos la
 * ubicación del CEDIS como punto de referencia (su ruta "empieza" ahí).
 */

const { distanciaKm } = require('./distance.service')
const { askGeminiText } = require('../../utils/gemini')
const Driver   = require('../../models/Driver.model')
const Order    = require('../../models/Order.model')
const Customer = require('../../models/Customer.model')
const Cedis    = require('../../models/Cedis.model')

const ESTADOS_ACTIVOS = ['confirmado', 'asignado', 'en_camino']

/** Devuelve el rango [inicio, fin) del día (UTC) que contiene `fecha`. */
function rangoDelDia(fecha) {
  const d = new Date(fecha)
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0))
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000)
  return { inicio, fin }
}

/**
 * Calcula, para cada repartidor candidato, el "clúster" de entregas que ya
 * tiene agendadas para `fechaEntrega` y qué tan cerca está el nuevo pedido
 * de ese clúster (o del CEDIS, si todavía no tiene nada agendado ese día).
 */
async function construirOpcionesPorRuta(repartidores, ubicacionCliente, fechaEntrega, cedis_id) {
  const { inicio, fin } = rangoDelDia(fechaEntrega)

  const pedidosDelDia = await Order.find({
    driver_id: { $in: repartidores.map((r) => r._id) },
    fecha_entrega: { $gte: inicio, $lt: fin },
    status_final: { $in: ESTADOS_ACTIVOS },
  }).select('driver_id customer_id').lean()

  // Agrupar customer_ids por repartidor
  const clientesPorDriver = {}
  for (const p of pedidosDelDia) {
    const key = String(p.driver_id)
    if (!clientesPorDriver[key]) clientesPorDriver[key] = new Set()
    clientesPorDriver[key].add(String(p.customer_id))
  }

  // Resolver ubicaciones de todos esos clientes de una sola vez
  const idsUnicos = [...new Set(pedidosDelDia.map((p) => String(p.customer_id)))]
  const customers = idsUnicos.length
    ? await Customer.find({ _id: { $in: idsUnicos } }).select('ubicacion').lean()
    : []
  const ubicacionPorCliente = {}
  customers.forEach((c) => { ubicacionPorCliente[String(c._id)] = c.ubicacion })

  const cedis = await Cedis.findOne({ cedis_id }).select('ubicacion nombre').lean()
  const ubicacionCedis = cedis?.ubicacion?.lat ? cedis.ubicacion : null

  return repartidores.map((r) => {
    const key = String(r._id)
    const idsClientesDelDia = [...(clientesPorDriver[key] || [])]
    const ubicacionesCluster = idsClientesDelDia
      .map((id) => ubicacionPorCliente[id])
      .filter((u) => u?.lat != null && u?.lng != null)

    let distancia_ruta_km, referencia
    if (ubicacionesCluster.length) {
      const distancias = ubicacionesCluster.map((u) =>
        distanciaKm(ubicacionCliente.lat, ubicacionCliente.lng, u.lat, u.lng)
      )
      distancia_ruta_km = +(distancias.reduce((a, b) => a + b, 0) / distancias.length).toFixed(2)
      referencia = `${ubicacionesCluster.length} entrega(s) ya agendada(s) ese día — distancia promedio a esa zona`
    } else if (ubicacionCedis) {
      distancia_ruta_km = +distanciaKm(ubicacionCliente.lat, ubicacionCliente.lng, ubicacionCedis.lat, ubicacionCedis.lng).toFixed(2)
      referencia = 'sin entregas agendadas ese día — distancia desde el CEDIS (inicio de su ruta)'
    } else {
      distancia_ruta_km = null
      referencia = 'sin entregas agendadas ese día y sin ubicación de CEDIS — sin referencia de distancia'
    }

    return {
      driver_id: key,
      nombre: r.nombre,
      calificacion: r.calificacion_promedio || 0,
      entregas_agendadas_ese_dia: idsClientesDelDia.length,
      distancia_ruta_km,
      referencia,
    }
  })
}

/**
 * Asigna el mejor repartidor para un pedido AGENDADO, priorizando que su
 * ruta de ese día quede compacta (entregas cercanas entre sí) por encima de
 * "quién está más cerca ahora mismo".
 *
 * @param {object} order                - Documento Order (con cedis_id, fecha_entrega, total, id_pedido)
 * @param {{lat,lng,direccion,municipio}} ubicacionCliente
 * @returns {{ driver, razon, distancia_km, entregas_agendadas_ese_dia }}
 */
async function asignarRepartidor(order, ubicacionCliente) {
  const repartidores = await Driver.find({ cedis_id: order.cedis_id, estado: 'activo' }).lean()
  if (!repartidores.length) throw new Error('No hay repartidores disponibles en este cedis')

  const fechaEntrega = order.fecha_entrega || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const opciones = await construirOpcionesPorRuta(repartidores, ubicacionCliente, fechaEntrega, order.cedis_id)

  const fechaTxt = new Date(fechaEntrega).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

  const prompt = `
Eres un sistema de asignación de rutas de entrega para una empresa de distribución de bebidas en Monterrey, México.

PEDIDO A ASIGNAR:
- ID: ${order.id_pedido}
- Fecha de entrega agendada: ${fechaTxt}
- Destino: ${ubicacionCliente.direccion || 'Zona Metropolitana de Monterrey'} (${ubicacionCliente.municipio || 'Monterrey'})
- Total del pedido: $${order.total} MXN

REPARTIDORES DISPONIBLES (evaluados pensando en mantener su ruta de ese día compacta, NO en su posición actual):
${opciones.map((o, i) => `
${i + 1}. ${o.nombre}
   - Entregas que ya tiene agendadas para ese día: ${o.entregas_agendadas_ese_dia}
   - Distancia de referencia del nuevo pedido a su ruta de ese día: ${o.distancia_ruta_km != null ? `${o.distancia_ruta_km} km` : 'sin datos'} (${o.referencia})
   - Calificación promedio: ${o.calificacion}/5.0
`).join('')}

CRITERIOS DE DECISIÓN (en orden de prioridad):
1. Que el nuevo pedido quede CERCA de las otras entregas que ese repartidor ya tiene agendadas para ese día — así su ruta es más corta y eficiente (menor "distancia de referencia")
2. Balancear la carga: no sobrecargar a uno con muchas entregas mientras otro tiene pocas ese mismo día
3. Mayor calificación promedio

Responde EXACTAMENTE en este formato (sin nada más):
REPARTIDOR: [nombre exacto del repartidor elegido]
RAZÓN: [explicación breve en 1-2 oraciones en español, mencionando la cercanía a su ruta de ese día]
`

  // 5. Llamar Gemini con retry y fallback por ruta
  let nombreElegido = null, razon = null

  for (let intento = 1; intento <= 3; intento++) {
    try {
      const respuesta = await askGeminiText(prompt)
      const lines = respuesta.split('\n').map((l) => l.trim()).filter(Boolean)
      const get = (prefix) => {
        const line = lines.find((l) => l.toUpperCase().startsWith(prefix.toUpperCase()))
        return line ? line.split(':').slice(1).join(':').trim() : null
      }
      nombreElegido = get('REPARTIDOR')
      razon         = get('RAZÓN') || get('RAZON')
      break
    } catch (e) {
      if (intento === 3) {
        console.warn('[asignarRepartidor] Gemini no disponible, usando fallback por ruta:', e.message)
      } else {
        await new Promise((r) => setTimeout(r, 1500 * intento))
      }
    }
  }

  // Fallback: elegir la ruta más compacta (menor distancia de referencia y menor carga ese día)
  const mejorOpcion = opciones.slice().sort((a, b) =>
    ((a.distancia_ruta_km ?? Infinity) + a.entregas_agendadas_ese_dia * 5) -
    ((b.distancia_ruta_km ?? Infinity) + b.entregas_agendadas_ese_dia * 5)
  )[0]

  const driverElegido = nombreElegido
    ? repartidores.find((r) => r.nombre.toLowerCase().includes(nombreElegido.toLowerCase().split(' ')[0])) || repartidores.find((r) => String(r._id) === mejorOpcion.driver_id)
    : repartidores.find((r) => String(r._id) === mejorOpcion.driver_id)

  const opcionElegida = opciones.find((o) => o.driver_id === String(driverElegido._id)) || mejorOpcion

  return {
    driver: driverElegido,
    razon: razon || 'Mejor balance entre cercanía a su ruta del día y carga de trabajo',
    distancia_km: opcionElegida.distancia_ruta_km,
    entregas_agendadas_ese_dia: opcionElegida.entregas_agendadas_ese_dia,
    fecha_entrega: fechaEntrega,
    todas_opciones: opciones,
  }
}

module.exports = { asignarRepartidor }
