require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const morgan  = require('morgan')
const connectDB = require('./utils/db')

const indexRoutes = require('./routes/index.routes')
const authRoutes = require('./routes/auth.routes')
const mlRoutes = require('./routes/ml.routes')
const adminRoutes = require('./routes/admin.routes')
const orderRoutes = require('./routes/order.routes')
const driverRoutes = require('./routes/driver.routes')
const notificationRoutes = require('./routes/notification.routes')
const dashboardRoutes = require('./routes/dashboard.routes')

const app  = express()
const PORT = process.env.PORT || 4000

connectDB()

/* ─── CORS — allow Vite dev server + production origin ─────────────────── */
const allowedOrigins = [
  'http://localhost:5173',   // Vite default
  'http://localhost:4173',   // Vite preview
  process.env.FRONTEND_URL,  // production (set in .env)
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server calls (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
}))

app.use(express.json())
app.use(morgan('dev'))

app.use('/', indexRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/ml', mlRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/driver', driverRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api', dashboardRoutes)

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
})