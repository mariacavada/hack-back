require('dotenv').config()
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const connectDB = require('./utils/db')

const indexRoutes = require('./routes/index.routes')
const authRoutes = require('./routes/auth.routes')

const app = express()
const PORT = process.env.PORT || 4000

connectDB()

app.use(cors())
app.use(express.json())
app.use(morgan('dev'))

app.use('/', indexRoutes)
app.use('/auth', authRoutes)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
