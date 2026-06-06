const { Router } = require('express')
const verifyToken = require('../utils/jwt')
const requireRole = require('../middleware/requireRole')
const {
  getProductSales,
  getStock,
  getStockAlerts,
  getCustomerDashboard,
  getCustomerLastOrder,
  getCustomerOrders,
} = require('../controllers/dashboard.controllers')

const router = Router()
router.use(verifyToken)

// ── DASHBOARD GLOBAL (admin) ──────────────────────────────────────────────────

// GET /api/dashboard/product-sales?cedis_id=3012
router.get('/dashboard/product-sales', requireRole('admin'), getProductSales)

// GET /api/dashboard/stock?cedis_id=3012
router.get('/dashboard/stock', requireRole('admin'), getStock)

// GET /api/dashboard/stock-alerts?cedis_id=3012
router.get('/dashboard/stock-alerts', requireRole('admin'), getStockAlerts)

// ── DASHBOARD POR TIENDA (customer o admin) ───────────────────────────────────

// GET /api/customers/:customerId/dashboard
router.get('/customers/:customerId/dashboard', requireRole('admin', 'customer'), getCustomerDashboard)

// GET /api/customers/:customerId/last-order
router.get('/customers/:customerId/last-order', requireRole('admin', 'customer'), getCustomerLastOrder)

// GET /api/customers/:customerId/orders
router.get('/customers/:customerId/orders', requireRole('admin', 'customer'), getCustomerOrders)

module.exports = router
