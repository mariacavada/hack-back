const mongoose = require('mongoose')

const DB_NAME = process.env.DB_NAME || 'order_rescue'

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME })
    console.log(`MongoDB conectado — base: ${DB_NAME}`)
  } catch (error) {
    console.error('Error conectando a MongoDB:', error)
    process.exit(1)
  }

  mongoose.connection.on('disconnected', () =>
    console.warn('MongoDB desconectado, intentando reconectar...')
  )
  mongoose.connection.on('reconnected', () =>
    console.log('MongoDB reconectado')
  )
}

module.exports = connectDB
