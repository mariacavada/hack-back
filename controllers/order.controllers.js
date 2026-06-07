const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const Notification = require('../models/Notification.model')
const SubstitutionLog = require('../models/SubstitutionLog.model')
const Customer = require('../models/Customer.model')
const Driver = require('../models/Driver.model')
const { recordSubstitutionFeedback } = require('../services/ml/substitution.service')
const { asignarRepartidor } = require('../services/maps/assign.service')
const { reserveStock, releaseStock } = require('../services/inventory.service')
const { predictStockDepletion } = require('../services/ml/stockPredict.service')
const { sendWhatsAppMessage } = require('../services/whatsapp.service')

// POST /api/orders
// Crear nuevo pedido
const createOrder = async (req, res) => {
  // Si ya apartamos stock pero algo falla después, lo liberamos en el catch
  let reservas = null
  let cedisReservado = null
  let idPedidoReservado = null

  try {
    const { items, cedis_id, subtotal, total, fecha_entrega, ...rest } = req.body
    if (!items?.length) return res.status(400).json({ message: 'El pedido debe tener al menos 1 producto' })
    if (!cedis_id) return res.status(400).json({ message: 'cedis_id es requerido' })

    // El cliente DEBE elegir cuándo quiere su pedido — y debe ser una fecha
    // realista: ni "para ahorita" (necesitamos tiempo para preparar/agendar
    // ruta) ni tan lejana que no podamos planear con sentido. Usamos el mismo
    // criterio de 3 días que el lead time de reabastecimiento del CEDIS.
    if (!fecha_entrega) {
      return res.status(400).json({ message: 'fecha_entrega es requerida (fecha en la que quieres recibir tu pedido)' })
    }
    const fechaEntregaDate = new Date(fecha_entrega)
    if (isNaN(fechaEntregaDate.getTime())) {
      return res.status(400).json({ message: 'fecha_entrega no es una fecha válida (usa formato ISO, ej. "2026-06-12")' })
    }
    const HOY = new Date()
    const MIN_DIAS_ANTICIPACION = 3
    const MAX_DIAS_ANTICIPACION = 14
    const minFecha = new Date(HOY.getTime() + MIN_DIAS_ANTICIPACION * 24 * 60 * 60 * 1000)
    const maxFecha = new Date(HOY.getTime() + MAX_DIAS_ANTICIPACION * 24 * 60 * 60 * 1000)
    if (fechaEntregaDate < minFecha) {
      return res.status(400).json({
        message: `La fecha de entrega debe ser al menos ${MIN_DIAS_ANTICIPACION} días después de hoy (lo más pronto posible: ${minFecha.toISOString().slice(0, 10)})`,
      })
    }
    if (fechaEntregaDate > maxFecha) {
      return res.status(400).json({
        message: `Solo se pueden agendar entregas hasta ${MAX_DIAS_ANTICIPACION} días por adelantado (lo más tarde posible: ${maxFecha.toISOString().slice(0, 10)})`,
      })
    }

    const id_pedido = `PED-${Date.now()}`
    console.log('[createOrder] 1 - creando order con id_pedido:', id_pedido, '| entrega solicitada:', fechaEntregaDate.toISOString().slice(0, 10))

    // 1. Apartar stock del CEDIS de forma atómica — nunca debe quedar en negativo.
    //    Si no alcanza para algún SKU, se rechaza el pedido (y se revierte lo
    //    ya apartado en esta misma llamada).
    try {
      idPedidoReservado = id_pedido
      cedisReservado = cedis_id
      reservas = await reserveStock(
        cedis_id,
        items.map((it) => ({ sku: it.sku, cantidad: it.cantidad })),
        id_pedido
      )
    } catch (err) {
      if (err.code === 'STOCK_INSUFICIENTE') {
        return res.status(409).json({
          message: `No hay suficiente stock disponible de "${err.sku}" en este CEDIS para completar el pedido`,
          sku: err.sku,
        })
      }
      throw err
    }
    console.log('[createOrder] 1.5 - stock apartado:', reservas.map((r) => `${r.sku} x${r.cantidad}`).join(', '))

    const order = await Order.create({
      id_pedido,
      customer_id: String(req.decoded.id),
      cedis_id,
      subtotal,
      total,
      status_final: 'pendiente',
      fecha_pedido: new Date().toISOString(),
      fecha_entrega: fechaEntregaDate,
      ...rest,
    })
    console.log('[createOrder] 2 - order creado:', order._id)

    const detalles = items.map((item, i) => ({
      id_linea: `${id_pedido}-${i + 1}`,
      id_pedido,
      sku_solicitado: item.sku,
      nombre_sku_solicitado: item.nombre,
      quantity: item.cantidad,
      status: 'registrado',
    }))
    await OrderDetail.insertMany(detalles)
    console.log('[createOrder] 3 - detalles insertados:', detalles.length)

    // TrackingPedido: customer_id guardado como String para consistencia
    await TrackingPedido.create({
      id_pedido,
      customer_id: String(req.decoded.id),
      status_actual: 'pendiente',
      eventos: [{ status: 'pendiente', descripcion: 'Pedido recibido' }],
    })
    console.log('[createOrder] 4 - tracking creado')

    // 5. En segundo plano: revisar si el apartado dejó el stock por debajo de
    //    la tendencia esperada y, de ser así, avisar al admin por WhatsApp con
    //    cuánto pedir y para cuándo (tomando en cuenta los 3-5 días que tarda
    //    en llegar el reabastecimiento). No bloquea la respuesta al cliente.
    setImmediate(() => {
      for (const r of reservas) {
        predictStockDepletion(cedis_id, r.sku).catch((e) =>
          console.error(`[createOrder] stock-check falló para ${r.sku}@${cedis_id}:`, e.message)
        )
      }
    })

    // Asignación automática de repartidor con Gemini (no bloquea la respuesta)
    res.status(201).json({ message: 'Pedido creado', order, detalles })

    // Ejecutar asignación en background después de responder.
    // Ahora se basa en la FECHA DE ENTREGA elegida por el cliente y en su
    // UBICACIÓN comparada contra la ruta que cada repartidor ya tiene
    // agendada para ese día — no en "quién está más cerca ahora mismo"
    // (ver services/maps/assign.service.js para el detalle del rediseño).
    setImmediate(async () => {
      try {
        const customer = await Customer.findById(order.customer_id).lean()
        const ubicacionCliente = customer?.ubicacion || { lat: 25.6866, lng: -100.3161, direccion: 'Monterrey, NL', municipio: 'Monterrey' }

        const { driver, razon, distancia_km, entregas_agendadas_ese_dia } = await asignarRepartidor(order, ubicacionCliente)

        // Actualizar pedido con el repartidor asignado
        await Order.findByIdAndUpdate(order._id, {
          driver_id: driver._id,
          status_final: 'asignado',
          assigned_at: new Date(),
        })

        const fechaTxt = fechaEntregaDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })

        // Agregar evento al tracking
        await TrackingPedido.findOneAndUpdate(
          { id_pedido: order.id_pedido },
          {
            $set: { status_actual: 'asignado' },
            $push: {
              eventos: {
                status: 'asignado',
                descripcion: `Repartidor asignado: ${driver.nombre} para el ${fechaTxt} (ya tiene ${entregas_agendadas_ese_dia} entrega(s) agendada(s) ese día). ${razon}`,
                driver_id: driver._id,
              },
            },
          }
        )

        // Notificar al cliente — OJO: Notification.customer_id es requerido
        // (ObjectId ref Customer); usar otros nombres de campo aquí falla
        // silenciosamente (mismo bug que ya corregimos en stockPredict.service)
        await Notification.create({
          customer_id: order.customer_id,
          id_pedido: order.id_pedido,
          tipo: 'order_status',
          titulo: '🚚 Repartidor asignado',
          mensaje: `${driver.nombre} llevará tu pedido el ${fechaTxt}${distancia_km != null ? ` (ruta cercana a otras ${entregas_agendadas_ese_dia} entregas de ese día)` : ''}.`,
          prioridad: 'media',
        })

        // WhatsApp al cliente
        try {
          const customer = await Customer.findById(order.customer_id).select('telefono').lean()
          if (customer?.telefono) {
            const wa = `🚚 *Repartidor asignado*\n\n${driver.nombre} llevará tu pedido el ${fechaTxt}.\n\nPedido: ${order.id_pedido}`
            await sendWhatsAppMessage(customer.telefono, wa)
          }
        } catch (e) {
          console.error('[WA asignacion]', e.message)
        }

        console.log(`[createOrder] Repartidor asignado: ${driver.nombre} → ${order.id_pedido} (entrega ${fechaTxt})`)
      } catch (e) {
        console.error('[createOrder] Error en asignación automática:', e.message)
      }
    })
  } catch (err) {
    if (reservas?.length) {
      await releaseStock(cedisReservado, reservas, idPedidoReservado, 'rollback: error al crear el pedido').catch(() => {})
    }
    console.error('[createOrder] ERROR:', err.message)
    res.status(500).json({ message: 'Error al crear pedido', error: err.message })
  }
}

// GET /api/orders/my
// Historial de pedidos del usuario con items
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customer_id: String(req.decoded.id) })
      .sort({ created_at: -1 })
      .lean()

    const result = await Promise.all(
      orders.map(async (o) => {
        const [detalles, tracking, driver] = await Promise.all([
          OrderDetail.find({ id_pedido: o.id_pedido }).lean(),
          TrackingPedido.findOne({ id_pedido: o.id_pedido }).lean(),
          o.driver_id ? Driver.findById(o.driver_id).select('nombre telefono placa ubicacion_actual').lean() : null,
        ])
        return {
          _id: o._id,
          id_pedido: o.id_pedido,
          fecha_pedido: o.fecha_pedido,
          fecha_entrega: o.fecha_entrega,
          status_final: o.status_final,
          subtotal: o.subtotal,
          total: o.total,
          cedis_id: o.cedis_id,
          assigned_at: o.assigned_at,
          delivered_at: o.delivered_at,
          driver: driver ? {
            nombre: driver.nombre,
            telefono: driver.telefono,
            placa: driver.placa,
            ubicacion_actual: driver.ubicacion_actual,
          } : null,
          tracking: tracking ? {
            status_actual: tracking.status_actual,
            ultimo_evento: tracking.eventos?.at(-1) || null,
          } : null,
          items: detalles.map((d) => ({
            sku: d.sku_solicitado,
            nombre: d.nombre_sku_solicitado,
            cantidad: d.quantity,
            status: d.status,
          })),
        }
      })
    )

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/orders/:id
// Detalle de un pedido + líneas + tracking
const getOrderDetail = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    // Validar que sea del propio usuario (o admin/repartidor)
    if (req.decoded.role === 'usuario' && order.customer_id !== req.decoded.id) {
      return res.status(403).json({ message: 'Sin acceso a este pedido' })
    }

    const detalles = await OrderDetail.find({ id_pedido: order.id_pedido })
    const tracking = await TrackingPedido.findOne({ id_pedido: order.id_pedido })

    res.json({ order, detalles, tracking })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/orders/:id/substitution
// Aceptar o rechazar sustitución sugerida
// Body: { original_sku, original_name, substitute_sku, substitute_name, accepted }
const respondSubstitution = async (req, res) => {
  try {
    const { original_sku, original_name, substitute_sku, substitute_name, accepted } = req.body
    if (accepted === undefined) return res.status(400).json({ message: 'accepted (boolean) es requerido' })

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    // Actualizar status de la línea en OrderDetail
    await OrderDetail.findOneAndUpdate(
      { id_pedido: order.id_pedido, sku_solicitado: original_sku },
      { status: accepted ? 'sustituido' : 'faltante' }
    )

    // Guardar feedback en SubstitutionLog (alimenta el modelo)
    await recordSubstitutionFeedback({
      order_id: order._id,
      customer_id: req.decoded.id,
      original_sku,
      original_name,
      substitute_sku,
      substitute_name,
      accepted,
      suggested_by: 'gemini',
    })

    // Notificación de confirmación
    await Notification.create({
      customer_id: req.decoded.id,
      id_pedido: order.id_pedido,
      tipo: 'substitution_suggestion',
      titulo: accepted ? '✅ Sustitución aceptada' : '❌ Sustitución rechazada',
      mensaje: accepted
        ? `Cambiamos "${original_name}" por "${substitute_name}" en tu pedido.`
        : `Entendido, "${original_name}" se marcará como faltante.`,
      prioridad: 'baja',
    })

    res.json({ message: 'Respuesta registrada', accepted })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/orders/:id/status
// Vista resumida para el cliente: driver, fecha, estado, ventana
const getOrderStatus = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean()
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    const Driver = require('../models/Driver.model')
    const driver = order.driver_id ? await Driver.findById(order.driver_id).select('nombre telefono vehiculo_placa ubicacion_actual').lean() : null
    const tracking = await TrackingPedido.findOne({ id_pedido: order.id_pedido }).select('status_actual eventos').lean()

    res.json({
      id_pedido:             order.id_pedido,
      status:                order.status_final,
      fecha_pedido:          order.fecha_pedido,
      fecha_entrega:         order.fecha_entrega,
      delivery_window_start: order.delivery_window_start,
      delivery_window_end:   order.delivery_window_end,
      assigned_at:           order.assigned_at,
      delivered_at:          order.delivered_at,
      total:                 order.total,
      driver: driver ? {
        nombre:        driver.nombre,
        telefono:      driver.telefono,
        placa:         driver.vehiculo_placa,
        ubicacion:     driver.ubicacion_actual,
      } : null,
      ultimo_evento: tracking?.eventos?.slice(-1)[0] || null,
    })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/orders/:id/status
// Admin actualiza estado de un pedido
// Body: { status, notes? }
const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { status, notes } = req.body
    const allowed = ['pendiente', 'confirmado', 'asignado', 'en_camino', 'entregado', 'incompleto', 'cancelado']
    if (!allowed.includes(status)) return res.status(400).json({ message: `Status inválido. Opciones: ${allowed.join(', ')}` })

    const existing = await Order.findById(req.params.id)
    if (!existing) return res.status(404).json({ message: 'Pedido no encontrado' })

    const update = { status_final: status }
    if (notes) update.notes = notes
    if (status === 'entregado') update.delivered_at = new Date()
    if (status === 'asignado')  update.assigned_at  = new Date()

    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    // Si el pedido se cancela o queda incompleto (y no lo estaba ya), liberamos
    // el stock que se había apartado para que regrese a stock_disponible.
    const yaLiberado = ['cancelado', 'incompleto'].includes(existing.status_final)
    if (['cancelado', 'incompleto'].includes(status) && !yaLiberado) {
      const detalles = await OrderDetail.find({ id_pedido: order.id_pedido }).select('sku_solicitado quantity')
      await releaseStock(
        order.cedis_id,
        detalles.map((d) => ({ sku: d.sku_solicitado, cantidad: d.quantity })),
        order.id_pedido,
        `Pedido marcado como "${status}" — se libera el apartado`
      )
      console.log(`[updateOrderStatusAdmin] stock liberado para pedido ${order.id_pedido} (${status})`)
    }

    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        status_actual: status,
        $push: { eventos: { event_type: status, status, descripcion: notes || `Estado actualizado a ${status}`, timestamp: new Date() } },
      },
      { upsert: true }
    )

    res.json({ message: 'Estado actualizado', order })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/orders/:id/deliver
// Repartidor marca entrega directamente desde el pedido
// Body: { coords?, notes? }
const markDelivered = async (req, res) => {
  try {
    const { coords, notes } = req.body
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, driver_id: req.decoded.id },
      { status_final: 'entregado', delivered_at: new Date(), notes: notes || null },
      { new: true }
    )
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado o no asignado a ti' })

    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        status_actual: 'entregado',
        $push: { eventos: { event_type: 'entregado', status: 'entregado', descripcion: notes || 'Pedido entregado', coords: coords || null, driver_id: req.decoded.id, timestamp: new Date() } },
      },
      { upsert: true }
    )

    const Notification = require('../models/Notification.model')
    await Notification.create({
      customer_id: order.customer_id,
      id_pedido:   order.id_pedido,
      tipo:        'order_status',
      titulo:      '✅ ¡Tu pedido fue entregado!',
      mensaje:     notes || 'Tu pedido ha sido entregado exitosamente.',
      prioridad:   'media',
    })

    res.json({ message: '✅ Pedido marcado como entregado', order })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = { createOrder, getMyOrders, getOrderDetail, respondSubstitution, getOrderStatus, updateOrderStatusAdmin, markDelivered }
