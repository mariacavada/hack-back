const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const Product = require('../models/Product.model')
const InventarioCedis = require('../models/InventarioCedis.model')

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD GLOBAL (admin)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/dashboard/product-sales
// Porcentaje de venta por producto (Pie Chart)
const getProductSales = async (req, res) => {
  try {
    const { cedis_id } = req.query

    // Agrupar todas las líneas de pedido por SKU
    const matchStage = cedis_id ? { $match: { cedis_id } } : { $match: {} }

    const salesAgg = await OrderDetail.aggregate([
      { $group: { _id: '$sku_solicitado', quantity: { $sum: '$quantity' } } },
      { $sort: { quantity: -1 } },
    ])

    if (!salesAgg.length) return res.json([])

    const totalUnidades = salesAgg.reduce((sum, s) => sum + s.quantity, 0)

    // Enriquecer con nombre del producto
    const skus = salesAgg.map((s) => s._id)
    const products = await Product.find({ sku: { $in: skus } }).select('sku nombre')
    const productMap = {}
    products.forEach((p) => { productMap[p.sku] = p.nombre })

    const result = salesAgg.map((s) => ({
      sku: s._id,
      productName: productMap[s._id] || s._id,
      quantity: s.quantity,
      percentage: totalUnidades > 0
        ? parseFloat(((s.quantity / totalUnidades) * 100).toFixed(1))
        : 0,
    }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/dashboard/stock
// Stock actual por producto
const getStock = async (req, res) => {
  try {
    const { cedis_id } = req.query
    const filter = cedis_id ? { cedis_id } : {}

    const inventario = await InventarioCedis.find(filter)
      .sort({ stock_disponible: 1 })

    if (!inventario.length) return res.json([])

    const skus = inventario.map((i) => i.sku)
    const products = await Product.find({ sku: { $in: skus } }).select('sku nombre')
    const productMap = {}
    products.forEach((p) => { productMap[p.sku] = p.nombre })

    const result = inventario.map((i) => ({
      sku: i.sku,
      nombre: productMap[i.sku] || i.sku,
      stock: i.stock_disponible,
      stockMinimo: i.stock_minimo,
      stockCritico: i.stock_critico,
      cedis_id: i.cedis_id,
    }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/dashboard/stock-alerts
// Productos con riesgo de agotarse (sin ML, solo comparación de umbrales)
const getStockAlerts = async (req, res) => {
  try {
    const { cedis_id } = req.query
    const filter = cedis_id ? { cedis_id } : {}

    // Traer todos los que están bajo el mínimo o bajo el crítico
    const inventario = await InventarioCedis.find({
      ...filter,
      $or: [
        { $expr: { $lt: ['$stock_disponible', '$stock_minimo'] } },
        { $expr: { $lt: ['$stock_disponible', '$stock_critico'] } },
      ],
    }).sort({ stock_disponible: 1 })

    if (!inventario.length) return res.json([])

    const skus = inventario.map((i) => i.sku)
    const products = await Product.find({ sku: { $in: skus } }).select('sku nombre')
    const productMap = {}
    products.forEach((p) => { productMap[p.sku] = p.nombre })

    const result = inventario.map((i) => {
      const esCritico = i.stock_disponible < i.stock_critico
      return {
        sku: i.sku,
        nombre: productMap[i.sku] || i.sku,
        stock: i.stock_disponible,
        stockMinimo: i.stock_minimo,
        stockCritico: i.stock_critico,
        alerta: esCritico ? 'CRITICO' : 'BAJO',
        cedis_id: i.cedis_id,
      }
    })

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD POR TIENDA (customer)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/customers/:customerId/dashboard
// Resumen general: total pedidos, gasto total, ticket promedio
const getCustomerDashboard = async (req, res) => {
  try {
    const { customerId } = req.params

    const agg = await Order.aggregate([
      { $match: { customer_id: customerId, status_final: { $in: ['entregado', 'incompleto'] } } },
      {
        $group: {
          _id: '$customer_id',
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$total' },
        },
      },
    ])

    if (!agg.length) {
      return res.json({ totalOrders: 0, totalSpent: 0, averageOrderValue: 0 })
    }

    const { totalOrders, totalSpent } = agg[0]
    res.json({
      totalOrders,
      totalSpent: parseFloat(totalSpent.toFixed(2)),
      averageOrderValue: parseFloat((totalSpent / totalOrders).toFixed(2)),
    })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/customers/:customerId/last-order
// Último pedido con desglose de productos
const getCustomerLastOrder = async (req, res) => {
  try {
    const { customerId } = req.params

    const order = await Order.findOne({ customer_id: customerId })
      .sort({ created_at: -1 })

    if (!order) return res.status(404).json({ message: 'El cliente no tiene pedidos' })

    const detalles = await OrderDetail.find({ id_pedido: order.id_pedido })

    // Enriquecer con nombre del producto
    const skus = detalles.map((d) => d.sku_solicitado)
    const products = await Product.find({ sku: { $in: skus } }).select('sku nombre')
    const productMap = {}
    products.forEach((p) => { productMap[p.sku] = p.nombre })

    const items = detalles.map((d) => ({
      sku: d.sku_solicitado,
      productName: productMap[d.sku_solicitado] || d.nombre_sku_solicitado || d.sku_solicitado,
      quantity: d.quantity,
      status: d.status,
    }))

    res.json({
      orderId: order.id_pedido,
      date: order.fecha_pedido
        ? new Date(order.fecha_pedido).toISOString().split('T')[0]
        : order.created_at?.toISOString().split('T')[0],
      status: order.status_final,
      total: order.total,
      items,
    })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// GET /api/customers/:customerId/orders
// Historial de pedidos del cliente
const getCustomerOrders = async (req, res) => {
  try {
    const { customerId } = req.params
    const { page = 1, limit = 20 } = req.query

    const orders = await Order.find({ customer_id: customerId })
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('id_pedido fecha_pedido total status_final created_at')

    const total = await Order.countDocuments({ customer_id: customerId })

    const result = orders.map((o) => ({
      orderId: o.id_pedido,
      date: o.fecha_pedido
        ? new Date(o.fecha_pedido).toISOString().split('T')[0]
        : o.created_at?.toISOString().split('T')[0],
      total: o.total,
      status: o.status_final,
    }))

    res.json({ orders: result, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = {
  getProductSales,
  getStock,
  getStockAlerts,
  getCustomerDashboard,
  getCustomerLastOrder,
  getCustomerOrders,
}
