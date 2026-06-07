const Notification = require('../models/Notification.model')
const { sendWhatsAppMessage } = require('../services/whatsapp.service')

// GET /api/notifications
// Mis notificaciones (paginadas, últimas primero)
const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 30, solo_no_leidas } = req.query
    const filter = { customer_id: req.decoded.id }
    if (solo_no_leidas === 'true') filter.estado = { $ne: 'leida' }

    const notifications = await Notification.find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))

    const no_leidas = await Notification.countDocuments({ customer_id: req.decoded.id, estado: { $ne: 'leida' } })

    res.json({ notifications, no_leidas, page: Number(page) })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/notifications/:id/read
// Marcar una notificación como leída
const markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, customer_id: req.decoded.id },
      { estado: 'leida' },
      { new: true }
    )
    if (!notif) return res.status(404).json({ message: 'Notificación no encontrada' })
    res.json({ message: 'Marcada como leída', notif })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// PATCH /api/notifications/read-all
// Marcar todas como leídas
const markAllAsRead = async (req, res) => {
  try {
    const { modifiedCount } = await Notification.updateMany(
      { customer_id: req.decoded.id, estado: { $ne: 'leida' } },
      { estado: 'leida' }
    )
    res.json({ message: `${modifiedCount} notificaciones marcadas como leídas` })
  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message })
  }
}

// POST /api/notifications/whatsapp
// Manda un mensaje de WhatsApp a un número arbitrario (ej. "+5218182083986")
const sendWhatsApp = async (req, res) => {
  try {
    const { telefono, mensaje } = req.body
    if (!telefono || !mensaje) {
      return res.status(400).json({ message: 'Faltan los campos telefono y mensaje' })
    }

    const result = await sendWhatsAppMessage(telefono, mensaje)
    res.json({ message: 'Mensaje enviado', sid: result.sid, status: result.status })
  } catch (err) {
    res.status(500).json({ message: 'Error al enviar WhatsApp', error: err.message })
  }
}

module.exports = { getMyNotifications, markAsRead, markAllAsRead, sendWhatsApp }
