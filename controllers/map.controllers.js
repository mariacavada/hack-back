const Order    = require('../models/Order.model')
const Customer = require('../models/Customer.model')
const Driver   = require('../models/Driver.model')
const Cedis    = require('../models/Cedis.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const { asignarRepartidor } = require('../services/maps/assign.service')

// GET /api/map/overview
// Vista completa del mapa: cedis + clientes + repartidores + pedidos activos
const getMapOverview = async (req, res) => {
  try {
    const [cedis, clientes, repartidores, pedidos] = await Promise.all([
      Cedis.find({ estado: 'activo' }).lean(),
      Customer.find({ estado: 'activo', 'ubicacion.lat': { $exists: true } })
        .select('nombre_negocio email telefono ubicacion cedis_asignado')
        .lean(),
      Driver.find({ estado: 'activo' })
        .select('nombre email telefono cedis_id vehiculo_placa calificacion_promedio ubicacion_actual')
        .lean(),
      Order.find({ status_final: { $in: ['pendiente', 'confirmado', 'asignado', 'en_camino'] } })
        .select('id_pedido customer_id driver_id status_final cedis_id total')
        .lean(),
    ])

    res.json({
      cedis: cedis.map(c => ({
        cedis_id:  c.cedis_id,
        nombre:    c.nombre,
        ciudad:    c.ciudad,
        direccion: c.direccion,
        ubicacion: c.ubicacion,
      })),
      clientes: clientes.map(c => ({
        id:             String(c._id),
        nombre_negocio: c.nombre_negocio,
        telefono:       c.telefono,
        ubicacion:      c.ubicacion,
        cedis_asignado: c.cedis_asignado,
      })),
      repartidores: repartidores.map(d => ({
        id:               String(d._id),
        nombre:           d.nombre,
        telefono:         d.telefono,
        vehiculo_placa:   d.vehiculo_placa,
        calificacion:     d.calificacion_promedio,
        ubicacion_actual: d.ubicacion_actual,
        cedis_id:         d.cedis_id,
        pedidos_activos:  pedidos.filter(p => String(p.driver_id) === String(d._id)).length,
      })),
      pedidos_activos: pedidos.length,
    })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/map/assign-driver
// Body: { order_id }
// Usa Gemini para asignar el mejor repartidor a un pedido
const assignDriver = async (req, res) => {
  try {
    const { order_id } = req.body
    if (!order_id) return res.status(400).json({ message: 'order_id es requerido' })

    // Buscar pedido
    const order = await Order.findOne({
      $or: [
        { id_pedido: order_id },
        { _id: order_id.length === 24 ? order_id : undefined },
      ],
    }).lean()
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    // Obtener ubicación del cliente
    const customer = await Customer.findById(order.customer_id).lean()
    if (!customer?.ubicacion?.lat) {
      return res.status(400).json({ message: 'El cliente no tiene ubicación registrada' })
    }

    // Asignar con Gemini
    const resultado = await asignarRepartidor(order, customer.ubicacion)

    // Actualizar pedido con el repartidor elegido
    await Order.findByIdAndUpdate(order._id, {
      driver_id:    resultado.driver._id,
      status_final: 'asignado',
    })

    // Actualizar tracking
    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        status_actual: 'asignado',
        $push: {
          eventos: {
            status:      'asignado',
            descripcion: `Repartidor asignado: ${resultado.driver.nombre}. ETA: ${resultado.eta_minutos} min.`,
            timestamp:   new Date(),
          },
        },
      },
      { upsert: true }
    )

    res.json({
      message:         '✅ Repartidor asignado correctamente',
      id_pedido:       order.id_pedido,
      repartidor: {
        id:             String(resultado.driver._id),
        nombre:         resultado.driver.nombre,
        telefono:       resultado.driver.telefono,
        vehiculo_placa: resultado.driver.vehiculo_placa,
        ubicacion:      resultado.driver.ubicacion_actual,
      },
      eta_minutos:     resultado.eta_minutos,
      distancia_km:    resultado.distancia_km,
      razon_gemini:    resultado.razon,
      otras_opciones:  resultado.todas_opciones.map(o => ({
        nombre:          o.nombre,
        distancia_km:    o.distancia_km,
        eta_minutos:     o.eta_minutos,
        calificacion:    o.calificacion,
        pedidos_activos: o.pedidos_activos,
      })),
    })
  } catch (err) {
    console.error('[assignDriver]', err.message)
    res.status(500).json({ message: 'Error al asignar repartidor', error: err.message })
  }
}

// GET /api/map/drivers
// Ubicaciones en tiempo real de todos los repartidores del cedis
const getDriversLocation = async (req, res) => {
  try {
    const { cedis_id } = req.query
    const filter = { estado: 'activo' }
    if (cedis_id) filter.cedis_id = cedis_id

    const drivers = await Driver.find(filter)
      .select('nombre vehiculo_placa calificacion_promedio ubicacion_actual cedis_id')
      .lean()

    res.json(drivers.map(d => ({
      id:             String(d._id),
      nombre:         d.nombre,
      placa:          d.vehiculo_placa,
      calificacion:   d.calificacion_promedio,
      ubicacion:      d.ubicacion_actual,
      cedis_id:       d.cedis_id,
    })))
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/map/driver/location
// Repartidor actualiza su ubicación en tiempo real
// Body: { lat, lng }
const updateDriverLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body
    if (!lat || !lng) return res.status(400).json({ message: 'lat y lng son requeridos' })

    await Driver.findByIdAndUpdate(req.decoded.id, {
      ubicacion_actual: { lat: Number(lat), lng: Number(lng) },
    })

    res.json({ message: 'Ubicación actualizada', lat, lng })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = { getMapOverview, assignDriver, getDriversLocation, updateDriverLocation }
