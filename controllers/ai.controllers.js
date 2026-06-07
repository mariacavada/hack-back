const Order = require('../models/Order.model')
const OrderDetail = require('../models/OrderDetail.model')
const Product = require('../models/Product.model')

// GET /api/ai/products
// Todos los productos con sku, precio y nombre
const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ estado: 'activo' })
      .select('sku nombre precio_unitario categoria -_id')
      .lean()

    res.json(products)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/ai/get-user-orders
// Body: { customer_id }
// Devuelve pedidos de un cliente con sus items
const getUserOrders = async (req, res) => {
  try {
    const { customer_id } = req.body
    if (!customer_id) return res.status(400).json({ message: 'customer_id es requerido' })

    const orders = await Order.find({ customer_id: String(customer_id) })
      .sort({ created_at: -1 })
      .lean()

    const result = await Promise.all(
      orders.map(async (o) => {
        const detalles = await OrderDetail.find({ id_pedido: o.id_pedido }).lean()
        return {
          id_pedido: o.id_pedido,
          fecha_pedido: o.fecha_pedido,
          status_final: o.status_final,
          subtotal: o.subtotal,
          total: o.total,
          cedis_id: o.cedis_id,
          items: detalles.map((d) => ({
            sku: d.sku_solicitado,
            nombre: d.nombre_sku_solicitado,
            cantidad: d.quantity,
          })),
        }
      })
    )

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/ai/get-order-status
// Body: { id_pedido }
// Devuelve el status y detalle de un pedido específico
const getOrderStatus = async (req, res) => {
  try {
    const { id_pedido } = req.body
    if (!id_pedido) return res.status(400).json({ message: 'id_pedido es requerido' })

    const order = await Order.findOne({ id_pedido }).lean()
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' })

    const detalles = await OrderDetail.find({ id_pedido }).lean()

    res.json({
      id_pedido: order.id_pedido,
      fecha_pedido: order.fecha_pedido,
      status_final: order.status_final,
      subtotal: order.subtotal,
      total: order.total,
      cedis_id: order.cedis_id,
      items: detalles.map((d) => ({
        sku: d.sku_solicitado,
        nombre: d.nombre_sku_solicitado,
        cantidad: d.quantity,
        status: d.status,
      })),
    })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

module.exports = { getProducts, getUserOrders, getOrderStatus }
