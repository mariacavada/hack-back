const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000'

async function mlFetch(path, method = 'GET') {
  const res = await fetch(`${ML_SERVICE_URL}${path}`, { method })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.detail || 'ML service error'), { status: res.status })
  return data
}

// Modelo A — timing
const trainCustomer = async (req, res) => {
  try {
    const data = await mlFetch(`/train/${req.params.customerId}`, 'POST')
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
}

const trainAll = async (req, res) => {
  try {
    const data = await mlFetch('/train/all', 'POST')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

const getNextOrder = async (req, res) => {
  try {
    const data = await mlFetch(`/predict/${req.params.customerId}`)
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
}

// Modelo B — quantity
const suggestCustomer = async (req, res) => {
  try {
    const data = await mlFetch(`/suggest/${req.params.customerId}`, 'POST')
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
}

const getSuggestion = async (req, res) => {
  try {
    const data = await mlFetch(`/suggest/${req.params.customerId}`)
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
}

// Combo — ambos modelos
const trainFull = async (req, res) => {
  try {
    const data = await mlFetch(`/train-full/${req.params.customerId}`, 'POST')
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
}

module.exports = { trainCustomer, trainAll, getNextOrder, suggestCustomer, getSuggestion, trainFull }
