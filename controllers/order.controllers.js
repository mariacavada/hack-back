const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const TrackingPedido = require('../models/TrackingPedido.model')
const Notification = require('../models/Notification.model')
const SubstitutionLog = require('../models/SubstitutionLog.model')
const { recordSubstitutionFeedback } = require('../services/ml/substitution.service')

// POST /api/orders
// Crear nuevo pedido
const createOrder = async (req, res) => {
  try {
    const { items, cedis_id, subtotal, total, ...rest } = req.body
    if (!items?.length) return res.status(400).json({ message: 'El pedido debe tener al menos 1 producto' })

    const id_pedido = `PED-${Date.now()}`
    console.log('[createOrder] 1 - creando order con id_pedido:', id_pedido)

    const order = await Order.create({
      id_pedido,
      customer_id: String(req.decoded.id),
      cedis_id,
      subtotal,
      total,
      status_final: 'pendiente',
      fecha_pedido: new Date().toISOString(),
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

    res.status(201).json({ message: 'Pedido creado', order, detalles })
  } catch (err) {
    console.error('[createOrder] ERROR:', err.message)
    res.status(500).json({ message: 'Error al crear pedido', error: err.message })
  }
}

// GET /api/orders/my
// Ver mis pedidos con tracking
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customer_id: req.decoded.id })
      .sort({ created_at: -1 })

    // Adjuntar tracking a cada pedido
    const withTracking = await Promise.all(
      orders.map(async (o) => {
        const tracking = await TrackingPedido.findOne({ id_pedido: o.id_pedido })
          .select('status_actual eta_entrega eventos localizacion_actual')
        return { ...o.toObject(), tracking }
      })
    )

    res.json(withTracking)
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

module.exports = { createOrder, getMyOrders, getOrderDetail, respondSubstitution }
