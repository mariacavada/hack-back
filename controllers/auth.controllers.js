const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const Customer = require('../models/Customer.model')
const Driver = require('../models/Driver.model')
const Admin = require('../models/Admin.model')

const MODELS = {
  customer: Customer,
  driver: Driver,
  admin: Admin,
}

const register = async (req, res) => {
  try {
    const { rol, email, password, nombre, nombre_negocio, ...rest } = req.body

    if (!rol || !MODELS[rol]) {
      return res.status(400).json({ message: 'rol debe ser customer, driver o admin' })
    }
    if (!email || !password) {
      return res.status(400).json({ message: 'email y password son requeridos' })
    }

    const Model = MODELS[rol]
    const exists = await Model.findOne({ email })
    if (exists) return res.status(409).json({ message: 'Email ya registrado' })

    const password_hash = await bcrypt.hash(password, 10)

    const data = { email, password_hash, ...rest }
    if (rol === 'customer') data.nombre_negocio = nombre_negocio || nombre
    if (rol === 'driver' || rol === 'admin') data.nombre = nombre

    const user = await Model.create(data)

    res.status(201).json({ message: 'Usuario creado', id: user._id, rol })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const login = async (req, res) => {
  try {
    const { rol, email, password } = req.body

    if (!rol || !MODELS[rol]) {
      return res.status(400).json({ message: 'rol debe ser customer, driver o admin' })
    }
    if (!email || !password) {
      return res.status(400).json({ message: 'email y password son requeridos' })
    }

    const Model = MODELS[rol]
    const user = await Model.findOne({ email }).select('+password_hash')
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ message: 'Credenciales inválidas' })

    const token = jwt.sign({ id: user._id, rol }, process.env.JWT, { expiresIn: '24h' })

    const nombre = user.nombre || user.nombre_negocio || user.email
    res.json({ token, user: { id: user._id, email: user.email, nombre, rol } })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = { register, login }
