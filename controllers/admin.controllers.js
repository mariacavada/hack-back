const Customer = require('../models/Customer.model')
const Driver = require('../models/Driver.model')
const Admin = require('../models/Admin.model')
const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const InventarioCedis = require('../models/InventarioCedis.model')
const StockPredict = require('../models/StockPredict.model')
const Notification = require('../models/Notification.model')
const TrackingPedido = require('../models/TrackingPedido.model')

// ── USUARIOS ─────────────────────────────────────────────────────────────────

// GET /api/admin/users
// Ver todos los usuarios (cualquier rol)
const getAllUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 50 } = req.query
    const skip = (page - 1) * limit

    const modelMap = { customer: Customer, driver: Driver, admin: Admin }
    const targetModel = role ? modelMap[role] : null

    if (targetModel) {
      const [users, total] = await Promise.all([
        targetModel.find({}).sort({ created_at: -1 }).skip(skip).limit(Number(limit)),
        targetModel.countDocuments({}),
      ])
      return res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) })
    }

    // No role filter — combine all collections
    const [customers, drivers, admins] = await Promise.all([
      Customer.find({}).sort({ created_at: -1 }).lean(),
      Driver.find({}).sort({ created_at: -1 }).lean(),
      Admin.find({}).sort({ created_at: -1 }).lean(),
    ])
    const all = [
      ...customers.map((u) => ({ ...u, role: 'customer' })),
      ...drivers.map((u) => ({ ...u, role: 'driver' })),
      ...admins.map((u) => ({ ...u, role: 'admin' })),
    ]
    const total = all.length
    const users = all.slice(skip, skip + Number(limit))
    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener usuarios', error: err.message })
  }
}

// GET /api/admin/users/:id
// Ver detalle de un usuario
const getUserById = async (req, res) => {
  try {
    const id = req.params.id
    const customer = await Customer.findById(id)
    if (customer) return res.json({ ...customer.toObject(), role: 'customer' })
    const driver = await Driver.findById(id)
    if (driver) return res.json({ ...driver.toObject(), role: 'driver' })
    const admin = await Admin.findById(id)
    if (admin) return res.json({ ...admin.toObject(), role: 'admin' })
    res.status(404).json({ message: 'Usuario no encontrado' })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// ── PEDIDOS ───────────────────────────────────────────────────────────────────

// GET /api/admin/orders
// Ver todos los pedidos con filtros opcionales
const getAllOrders = async (req, res) => {
  try {
    const { status_final, cedis_id, page = 1, limit = 50 } = req.query
    const filter = {}
    if (status_final) filter.status_final = status_final
    if (cedis_id) filter.cedis_id = cedis_id

    const orders = await Order.find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))

    const total = await Order.countDocuments(filter)
    res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener pedidos', error: err.message })
  }
}

// GET /api/admin/orders/:id
// Detalle de un pedido + sus líneas
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('driver_id', 'nombre email telefono vehiculo_placa')
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    const detalles = await OrderDetail.find({ id_pedido: order.id_pedido })
    const tracking = await TrackingPedido.findOne({ id_pedido: order.id_pedido })

    res.json({ order, detalles, tracking })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/admin/orders/:id/confirm
// Confirmar pedido → notifica al cliente
const confirmOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status_final: 'confirmado' },
      { new: true }
    )
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    // Actualizar tracking
    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        $push: { eventos: { status: 'confirmado', descripcion: 'Pedido confirmado por el equipo' } },
        status_actual: 'confirmado',
      },
      { upsert: true }
    )

    // Notificar al cliente
    await Notification.create({
      customer_id: order.customer_id,
      id_pedido: order.id_pedido,
      tipo: 'order_status',
      titulo: '✅ Pedido confirmado',
      mensaje: 'Tu pedido fue confirmado y se está preparando.',
      prioridad: 'media',
    })

    res.json({ message: 'Pedido confirmado', order })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/admin/orders/:id/assign
// Asignar repartidor al pedido
const assignDriver = async (req, res) => {
  try {
    const { driver_id } = req.body
    if (!driver_id) return res.status(400).json({ message: 'driver_id es requerido' })

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status_final: 'asignado', driver_id },
      { new: true }
    ).populate('driver_id', 'nombre email telefono')

    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    await TrackingPedido.findOneAndUpdate(
      { id_pedido: order.id_pedido },
      {
        $push: { eventos: { status: 'asignado', descripcion: `Pedido asignado al repartidor` } },
        status_actual: 'asignado',
      },
      { upsert: true }
    )

    await Notification.create({
      customer_id: order.customer_id,
      id_pedido: order.id_pedido,
      tipo: 'order_status',
      titulo: '🚚 Repartidor asignado',
      mensaje: `Tu pedido ya tiene repartidor asignado y pronto saldrá.`,
      prioridad: 'media',
    })

    res.json({ message: 'Repartidor asignado', order })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// ── INVENTARIO / ML ───────────────────────────────────────────────────────────

// GET /api/admin/inventory/low-stock
// Productos por debajo del stock mínimo
const getLowStock = async (req, res) => {
  try {
    const { cedis_id } = req.query
    const filter = cedis_id ? { cedis_id } : {}

    const items = await InventarioCedis.aggregate([
      { $match: filter },
      {
        $addFields: {
          es_bajo: { $lte: ['$stock_disponible', '$stock_minimo'] },
          es_critico: { $lte: ['$stock_disponible', '$stock_critico'] },
        },
      },
      { $match: { es_bajo: true } },
      { $sort: { stock_disponible: 1 } },
    ])

    res.json({ total: items.length, items })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/admin/inventory/depletion-risk
// Productos con alta probabilidad de agotamiento (del modelo ML)
const getDepletionRisk = async (req, res) => {
  try {
    const { cedis_id, nivel } = req.query
    const filter = {}
    if (cedis_id) filter.cedis_id = cedis_id
    if (nivel) filter.nivel_alerta = nivel
    else filter.nivel_alerta = { $in: ['bajo', 'critico'] }

    const predictions = await StockPredict.find(filter)
      .sort({ dias_estimados_agotamiento: 1 })

    res.json({ total: predictions.length, predictions })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = {
  getAllUsers,
  getUserById,
  getAllOrders,
  getOrderById,
  confirmOrder,
  assignDriver,
  getLowStock,
  getDepletionRisk,
}
