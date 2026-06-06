const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const User = require('../models/User.model')

const register = async (req, res) => {
  try {
    const { email, password, name, role } = req.body
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'email, password and name are required' })
    }

    const exists = await User.findOne({ email })
    if (exists) return res.status(409).json({ message: 'Email already in use' })

    const password_hash = await bcrypt.hash(password, 10)
    const user = await User.create({ email, password: password_hash, name, role: role || 'usuario' })

    res.status(201).json({ message: 'User created', userId: user._id })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

const login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' })
    }

    const user = await User.findOne({ email })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' })

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT, { expiresIn: '24h' })

    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role } })
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message })
  }
}

module.exports = { register, login }
