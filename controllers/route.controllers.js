const DeliveryRoute  = require('../models/DeliveryRoute.model')
const Order          = require('../models/Order.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const Notification   = require('../models/Notification.model')
const Customer       = require('../models/Customer.model')

// ── Helpers ────────────────────────────────────────────────────────────────
async function pushTrackingEvent(id_pedido, event_type, descripcion, driver_id, note) {
  await TrackingPedido.findOneAndUpdate(
    { id_pedido },
    {
      status_actual: event_type,
      $push: { eventos: { event_type, status: event_type, descripcion, driver_id: driver_id || null, note: note || null, timestamp: new Date() } },
    },
    { upsert: true }
  )
}

// POST /api/routes
// Crear ruta manualmente (admin)
// Body: { driver_id, route_date, order_ids[] }
const createRoute = async (req, res) => {
  try {
    const { driver_id, route_date, order_ids, cedis_id } = req.body
    if (!driver_id || !order_ids?.length) return res.status(400).json({ message: 'driver_id y order_ids son requeridos' })

    const fecha = route_date ? new Date(route_date) : new Date()

    // Construir paradas desde los pedidos
    const orders = await Order.find({ _id: { $in: order_ids } }).lean()
    const paradas = await Promise.all(orders.map(async (o, i) => {
      const cliente = await Customer.findById(o.customer_id).select('nombre_negocio ubicacion').lean()
      return {
        id_pedido:   o.id_pedido,
        stop_number: i + 1,
        direccion:   cliente?.ubicacion?.direccion || 'Sin dirección',
        coords:      cliente?.ubicacion ? { lat: cliente.ubicacion.lat, lng: cliente.ubicacion.lng } : null,
        eta:         null,
        status:      'pendiente',
      }
    }))

    const ruta = await DeliveryRoute.create({
      driver_id,
      cedis_id: cedis_id || orders[0]?.cedis_id,
      fecha,
      current_status: 'programado',
      estado:         'pendiente',
      paradas,
      metricas_ruta:  { total_paradas: paradas.length },
    })

    // Asignar driver_id a los pedidos
    await Order.updateMany({ _id: { $in: order_ids } }, { driver_id, status_final: 'asignado', assigned_at: new Date() })

    res.status(201).json({ message: 'Ruta creada', ruta })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/routes/:id
// Detalle completo de una ruta
const getRoute = async (req, res) => {
  try {
    const ruta = await DeliveryRoute.findById(req.params.id)
      .populate('driver_id', 'nombre email telefono vehiculo_placa ubicacion_actual')
      .lean()
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })
    res.json(ruta)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/routes/:id
// Actualizar estado general de la ruta (admin/driver)
// Body: { current_status }
const updateRoute = async (req, res) => {
  try {
    const { current_status } = req.body
    const allowed = ['programado', 'cargando', 'faltante', 'salio', 'en_camino', 'entregado', 'cancelado']
    if (!allowed.includes(current_status)) return res.status(400).json({ message: `Estado inválido. Opciones: ${allowed.join(', ')}` })

    const ruta = await DeliveryRoute.findByIdAndUpdate(req.params.id, { current_status }, { new: true })
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })
    res.json({ message: 'Estado actualizado', current_status, ruta })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/routes/:routeId/events
// Registrar un evento en la ruta (driver)
// Body: { event_type, order_id?, comment }
const addRouteEvent = async (req, res) => {
  try {
    const { event_type, order_id, comment } = req.body
    const allowed = ['asignado', 'cargando_camion', 'pedido_faltante', 'salio_centro', 'en_camino', 'entregado', 'cancelado']
    if (!allowed.includes(event_type)) return res.status(400).json({ message: `event_type inválido. Opciones: ${allowed.join(', ')}` })

    const ruta = await DeliveryRoute.findById(req.params.routeId)
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })

    // Si el evento aplica a un pedido específico, actualizar su tracking
    if (order_id) {
      const order = await Order.findOne({ id_pedido: order_id }).lean()
      if (order) {
        await pushTrackingEvent(order_id, event_type, comment || event_type, req.decoded.id)
        // Notificar al cliente
        await Notification.create({
          customer_id: order.customer_id,
          id_pedido:   order_id,
          tipo:        'order_status',
          titulo:      `📦 Actualización de tu pedido`,
          mensaje:     comment || `Tu pedido está en estado: ${event_type}`,
          prioridad:   event_type === 'pedido_faltante' ? 'alta' : 'media',
        })
      }
    }

    // Mapear event_type a current_status de la ruta
    const statusMap = { cargando_camion: 'cargando', salio_centro: 'salio', en_camino: 'en_camino', entregado: 'entregado', pedido_faltante: 'faltante' }
    if (statusMap[event_type]) {
      ruta.current_status = statusMap[event_type]
      await ruta.save()
    }

    res.status(201).json({ message: 'Evento registrado', event_type, comment })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/routes/:routeId/load
// Repartidor marca que está cargando el camión
const markLoading = async (req, res) => {
  try {
    const ruta = await DeliveryRoute.findByIdAndUpdate(
      req.params.routeId,
      { current_status: 'cargando', loaded_at: new Date() },
      { new: true }
    )
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })
    res.json({ message: '🚛 Cargando camión marcado', loaded_at: ruta.loaded_at })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/routes/:routeId/depart
// Repartidor marca que salió del cedis
const markDeparture = async (req, res) => {
  try {
    const ruta = await DeliveryRoute.findByIdAndUpdate(
      req.params.routeId,
      { current_status: 'salio', departed_at: new Date(), started_at: new Date() },
      { new: true }
    )
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })

    // Notificar a todos los clientes de la ruta
    const pedidosIds = ruta.paradas.map(p => p.id_pedido)
    const orders = await Order.find({ id_pedido: { $in: pedidosIds } }).lean()
    await Promise.all(orders.map(o =>
      Notification.create({
        customer_id: o.customer_id,
        id_pedido:   o.id_pedido,
        tipo:        'order_status',
        titulo:      '🚛 Tu pedido salió del centro de distribución',
        mensaje:     'El repartidor está en camino. Pronto recibirás tu pedido.',
        prioridad:   'media',
      })
    ))

    res.json({ message: '🚀 Salida del cedis marcada', departed_at: ruta.departed_at })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/routes/:routeId/missing
// Marcar que hay pedidos faltantes en la ruta
// Body: { notes }
const markMissing = async (req, res) => {
  try {
    const { notes } = req.body
    const ruta = await DeliveryRoute.findByIdAndUpdate(
      req.params.routeId,
      { missing_orders: true, current_status: 'faltante', comments: notes || null },
      { new: true }
    )
    if (!ruta) return res.status(404).json({ message: 'Ruta no encontrada' })
    res.json({ message: '⚠️ Faltante registrado en la ruta', notes })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = { createRoute, getRoute, updateRoute, addRouteEvent, markLoading, markDeparture, markMissing }
