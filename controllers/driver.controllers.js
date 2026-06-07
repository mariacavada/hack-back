const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const DeliveryRoute = require('../models/DeliveryRoute.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const Notification = require('../models/Notification.model')
const Driver = require('../models/Driver.model')
const Customer = require('../models/Customer.model')
const { askGemini } = require('../utils/gemini')
const { sendWhatsAppMessage } = require('../services/whatsapp.service')

// GET /api/driver/orders
// Ver pedidos asignados al repartidor logueado
const getAssignedOrders = async (req, res) => {
  try {
    const mongoose = require('mongoose')
    const driverId = mongoose.Types.ObjectId.isValid(req.decoded.id)
      ? new mongoose.Types.ObjectId(req.decoded.id)
      : req.decoded.id

    const orders = await Order.find({
      driver_id: driverId,
      status_final: { $in: ['asignado', 'en_camino', 'entregado', 'incompleto'] },
    }).sort({ created_at: 1 })

    // Adjuntar detalles de cada pedido
    const withDetails = await Promise.all(
      orders.map(async (o) => {
        const detalles = await OrderDetail.find({ id_pedido: o.id_pedido })
        const tracking = await TrackingPedido.findOne({ id_pedido: o.id_pedido })
          .select('status_actual eta_entrega localizacion_actual')
        return { ...o.toObject(), detalles, tracking }
      })
    )

    res.json(withDetails)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/driver/orders/:id/status
// Cambiar estado: en_camino | entregado | incompleto
const updateOrderStatus = async (req, res) => {
  try {
    const { status, coords, notas } = req.body
    const allowed = ['recibido', 'preparando', 'en_camino', 'entregado', 'incompleto']
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Estado inválido. Opciones: ${allowed.join(', ')}` })
    }

    const mongoose = require('mongoose')
    const driverId = mongoose.Types.ObjectId.isValid(req.decoded.id)
      ? new mongoose.Types.ObjectId(req.decoded.id)
      : req.decoded.id

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, driver_id: driverId },
      {
        status_final: status,
        ...(status === 'entregado' || status === 'incompleto' ? { delivered_at: new Date() } : {}),
      },
      { new: true }
    )
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado o no asignado a ti' })

    const descripciones = {
      recibido:   'El repartidor recibió el pedido',
      preparando: 'El pedido se está preparando',
      en_camino:  'El repartidor está en camino',
      entregado:  'Pedido entregado exitosamente',
      incompleto: `Pedido entregado con diferencias. ${notas || ''}`,
    }

    const titulos = {
      recibido:   '📦 Pedido recibido por el repartidor',
      preparando: '🔄 Preparando tu pedido',
      en_camino:  '🚀 Tu pedido está en camino',
      entregado:  '✅ ¡Pedido entregado!',
      incompleto: '⚠️ Pedido entregado con diferencias',
    }

    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        $push: { eventos: { status, descripcion: descripciones[status], coords: coords || null } },
        status_actual: status,
        localizacion_actual: coords || null,
        ...(status === 'entregado' || status === 'incompleto' ? { eta_entrega: new Date() } : {}),
      },
      { upsert: true }
    )

    await Notification.create({
      customer_id: String(order.customer_id),
      id_pedido: order.id_pedido,
      tipo: 'order_status',
      titulo: titulos[status],
      mensaje: descripciones[status],
      prioridad: status === 'incompleto' ? 'alta' : 'media',
    })

    // WhatsApp al cliente
    setImmediate(async () => {
      try {
        const customer = await Customer.findById(order.customer_id).select('telefono nombre_negocio').lean()
        if (customer?.telefono) {
          const wa = `${titulos[status]}\n\n${descripciones[status]}\n\nPedido: ${order.id_pedido}`
          await sendWhatsAppMessage(customer.telefono, wa)
        }
      } catch (e) {
        console.error('[WA status]', e.message)
      }
    })

    res.json({ message: 'Estado actualizado', status, order })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/driver/orders/:id/incident
// Reportar incidencia en un pedido
// Body: { tipo, descripcion, items_afectados?, coords? }
const reportIncident = async (req, res) => {
  try {
    const { tipo, descripcion, items_afectados, coords } = req.body

    const tiposValidos = ['producto_faltante', 'producto_dañado', 'cliente_ausente', 'direccion_incorrecta', 'otro']
    if (!tipo || !tiposValidos.includes(tipo)) {
      return res.status(400).json({ message: `tipo inválido. Opciones: ${tiposValidos.join(', ')}` })
    }
    if (!descripcion) return res.status(400).json({ message: 'descripcion es requerida' })

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, driver_id: req.decoded.id },
      {
        $push: {
          'feedback_cliente.incidencias': {
            tipo,
            descripcion,
            items_afectados: items_afectados || [],
            coords: coords || null,
            reportado_por: req.decoded.id,
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    )
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado o no asignado a ti' })

    // Agregar evento al tracking
    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        $push: {
          eventos: {
            status: 'incidencia',
            descripcion: `[${tipo.toUpperCase()}] ${descripcion}`,
            coords: coords || null,
          },
        },
      },
      { upsert: true }
    )

    // Notificar al cliente si es producto dañado (sin sustitución)
    if (tipo === 'producto_dañado') {
      await Notification.create({
        user_id: String(order.customer_id),
        user_model: 'Customer',
        id_pedido: order.id_pedido,
        tipo: 'incidencia',
        titulo: '⚠️ Novedad en tu pedido',
        mensaje: descripcion,
        prioridad: 'alta',
      })
    }

    // Si hay productos faltantes, lanzar sustitución con Gemini en background
    if (tipo === 'producto_faltante' && items_afectados?.length > 0) {
      const { suggestSubstitutes } = require('../services/ml/substitution.service')
      setImmediate(async () => {
        for (const item of items_afectados) {
          const sku = item.sku || item
          try {
            await suggestSubstitutes(order.customer_id, sku, order.cedis_id, order._id)
          } catch (e) {
            console.error(`[Substitution] SKU ${sku}:`, e.message)
          }
        }
      })
    }

    res.status(201).json({ message: 'Incidencia reportada', incidencia: { tipo, descripcion, items_afectados } })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/driver/route/start
// Iniciar ruta del día: toma los pedidos asignados, Gemini calcula orden óptimo
// Body: { cedis_id?, fecha? }
const startDayRoute = async (req, res) => {
  try {
    const driver_id = req.decoded.id
    const fecha = req.body.fecha ? new Date(req.body.fecha) : new Date()
    const fechaStr = fecha.toISOString().split('T')[0]

    // Verificar si ya existe ruta para hoy
    const rutaExistente = await DeliveryRoute.findOne({ driver_id, fecha: { $gte: new Date(fechaStr) } })
    if (rutaExistente) return res.status(409).json({ message: 'Ya tienes una ruta iniciada para hoy', ruta: rutaExistente })

    // Obtener pedidos asignados del día
    const orders = await Order.find({
      driver_id,
      status_final: 'asignado',
    })

    if (!orders.length) return res.status(400).json({ message: 'No tienes pedidos asignados para iniciar ruta' })

    // Obtener ubicación actual del repartidor
    const driver = await Driver.findById(driver_id).select('ubicacion_actual cedis_id nombre')
    const origen = driver?.ubicacion_actual || { lat: 19.4284, lng: -99.1277 }

    // Construir lista de paradas con datos de clientes
    const paradas_raw = await Promise.all(
      orders.map(async (o) => {
        const cliente = await Customer.findById(o.customer_id).select('nombre_negocio')
        return {
          id_pedido: o.id_pedido,
          order_id: o._id,
          cliente: cliente?.nombre_negocio || o.customer_id,
          direccion: 'Sin dirección',
          coords: null,
          total: o.total,
        }
      })
    )

    // Gemini calcula el orden óptimo de entrega
    const prompt = `
Eres un optimizador de rutas de entrega para una distribuidora de bebidas en México.

Punto de inicio (CEDIS / ubicación actual del repartidor):
${JSON.stringify(origen)}

Pedidos a entregar hoy (${paradas_raw.length} paradas):
${JSON.stringify(paradas_raw, null, 2)}

Ordena las paradas para minimizar la distancia total recorrida.
Considera la cercanía geográfica entre coords y un recorrido lógico.
Si alguna parada no tiene coords, ponla al final.

Responde ÚNICAMENTE con JSON válido:
{
  "orden_optimo": [
    {
      "stop_number": 1,
      "id_pedido": "string",
      "direccion": "string",
      "coords": { "lat": number, "lng": number } | null,
      "razon": "string breve en español"
    }
  ],
  "distancia_total_estimada_km": number,
  "tiempo_estimado_total_min": number,
  "resumen": "string breve en español"
}
`

    const geminiResult = await askGemini(prompt)

    // Construir paradas finales con ETAs aproximadas
    let etaBase = new Date()
    const paradas = geminiResult.orden_optimo.map((p, i) => {
      etaBase = new Date(etaBase.getTime() + (i === 0 ? 15 : 20) * 60 * 1000) // 15 min primera, 20 min entre paradas
      const rawParada = paradas_raw.find((r) => r.id_pedido === p.id_pedido)
      return {
        id_pedido: p.id_pedido,
        stop_number: p.stop_number,
        direccion: p.direccion,
        coords: p.coords || rawParada?.coords || null,
        eta: new Date(etaBase),
        llegada_real: null,
        status: 'pendiente',
      }
    })

    // Guardar ruta en DB
    const ruta = await DeliveryRoute.create({
      driver_id,
      cedis_id: req.body.cedis_id || driver?.cedis_id,
      fecha,
      estado: 'en_progreso',
      paradas,
      metricas_ruta: {
        distancia_total_km: geminiResult.distancia_total_estimada_km,
        tiempo_estimado_min: geminiResult.tiempo_estimado_total_min,
        total_paradas: paradas.length,
        optimizado_por: 'gemini',
        resumen: geminiResult.resumen,
      },
    })

    // Marcar pedidos como en_camino
    await Order.updateMany(
      { driver_id, status_final: 'asignado' },
      { status_final: 'en_camino' }
    )

    res.status(201).json({
      message: `Ruta del día iniciada con ${paradas.length} paradas`,
      ruta,
      resumen: geminiResult.resumen,
    })
  } catch (err) {
    res.status(500).json({ message: 'Error al iniciar ruta', error: err.message })
  }
}

// PATCH /api/driver/route/:ruta_id/stop/:stop_number/complete
// Marcar una parada como completada y actualizar ETA de las siguientes
const completeStop = async (req, res) => {
  try {
    const { coords } = req.body
    const { ruta_id, stop_number } = req.params

    const ruta = await DeliveryRoute.findOneAndUpdate(
      { _id: ruta_id, driver_id: req.decoded.id, 'paradas.stop_number': Number(stop_number) },
      {
        $set: {
          'paradas.$.status': 'completado',
          'paradas.$.llegada_real': new Date(),
          'paradas.$.coords': coords || null,
        },
      },
      { new: true }
    )
    if (!ruta) return res.status(404).json({ message: 'Ruta o parada no encontrada' })

    // Verificar si todas las paradas están completas
    const todasCompletas = ruta.paradas.every((p) => p.status === 'completado')
    if (todasCompletas) {
      await DeliveryRoute.findByIdAndUpdate(ruta_id, { estado: 'completada' })
    }

    res.json({ message: 'Parada completada', todasCompletas, ruta })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/driver/route/today
// Ver la ruta del día actual del repartidor
const getTodayRoute = async (req, res) => {
  try {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)

    const ruta = await DeliveryRoute.findOne({
      driver_id: req.decoded.id,
      fecha: { $gte: hoy },
    })

    if (!ruta) return res.status(404).json({ message: 'No hay ruta activa para hoy' })
    res.json(ruta)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = {
  getAssignedOrders,
  updateOrderStatus,
  reportIncident,
  startDayRoute,
  completeStop,
  getTodayRoute,
}
