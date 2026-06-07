require('dotenv').config()
const { sendWhatsAppMessage } = require('../services/whatsapp.service')

const numero = process.argv[2]
const mensaje = process.argv[3] || 'Mensaje de prueba desde hack-back 🚀'

if (!numero) {
  console.error('Uso: node scripts/test-whatsapp.js +5218182083986 "mensaje opcional"')
  process.exit(1)
}

sendWhatsAppMessage(numero, mensaje)
  .then((res) => console.log('Enviado:', res.sid, res.status))
  .catch((err) => console.error('Error:', err.message))
