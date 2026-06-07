const Cedis = require('../models/Cedis.model')
const InventarioCedis = require('../models/InventarioCedis.model')
const Product = require('../models/Product.model')

// GET /api/cedis
// Lista todos los CEDIS activos (para que el cliente elija a cuál pedirle, etc.)
const getAllCedis = async (req, res) => {
  try {
    const cedis = await Cedis.find({ estado: 'activo' })
      .select('cedis_id nombre pais ciudad direccion telefono ubicacion')
      .lean()

    res.json(cedis)
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener CEDIS', error: err.message })
  }
}

// GET /api/cedis/:cedis_id/stock
// Stock disponible de todos los productos de un CEDIS (con nombre del producto)
const getCedisStock = async (req, res) => {
  try {
    const { cedis_id } = req.params

    const cedis = await Cedis.findOne({ cedis_id })
    if (!cedis) return res.status(404).json({ message: `No existe el CEDIS "${cedis_id}"` })

    const inventario = await InventarioCedis.find({ cedis_id })
      .select('sku stock_disponible stock_reservado stock_minimo stock_critico')
      .sort({ sku: 1 })
      .lean()

    if (!inventario.length) return res.json({ cedis_id, nombre: cedis.nombre, productos: [] })

    const skus = inventario.map((i) => i.sku)
    const products = await Product.find({ sku: { $in: skus } }).select('sku nombre precio_unitario imagen_url').lean()
    const productMap = {}
    products.forEach((p) => { productMap[p.sku] = p })

    const productos = inventario.map((i) => ({
      sku: i.sku,
      nombre: productMap[i.sku]?.nombre || i.sku,
      precio_unitario: productMap[i.sku]?.precio_unitario ?? null,
      imagen_url: productMap[i.sku]?.imagen_url ?? null,
      stock_disponible: i.stock_disponible,
      stock_reservado: i.stock_reservado,
      stock_minimo: i.stock_minimo,
      stock_critico: i.stock_critico,
    }))

    res.json({ cedis_id: cedis.cedis_id, nombre: cedis.nombre, productos })
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener stock del CEDIS', error: err.message })
  }
}

module.exports = { getAllCedis, getCedisStock }
