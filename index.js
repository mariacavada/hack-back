require('dotenv').config()
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const connectDB = require('./utils/db')

const indexRoutes = require('./routes/index.routes')
const authRoutes = require('./routes/auth.routes')
const mlRoutes = require('./routes/ml.routes')
const adminRoutes = require('./routes/admin.routes')
const orderRoutes = require('./routes/order.routes')
const driverRoutes = require('./routes/driver.routes')
const notificationRoutes = require('./routes/notification.routes')
const dashboardRoutes = require('./routes/dashboard.routes')
const chatbotRoutes = require('./routes/chatbot.routes')

const app = express()
const PORT = process.env.PORT || 4000

connectDB()

app.use(cors())
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
app.use('/api/chatbot', chatbotRoutes)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
