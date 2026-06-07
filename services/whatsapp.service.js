const twilio = require('twilio')

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

/**
 * Envía un mensaje de WhatsApp usando Twilio.
 * El número debe estar en formato E.164 (ej. +5215512345678).
 * @param {string} telefono
 * @param {string} mensaje
 */
async function sendWhatsAppMessage(telefono, mensaje) {
  if (!telefono) throw new Error('Falta el número de teléfono')

  const to = telefono.startsWith('whatsapp:') ? telefono : `whatsapp:${telefono}`

  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body: mensaje,
  })
}

module.exports = { sendWhatsAppMessage }
