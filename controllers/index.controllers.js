const getHealth = (req, res) => {
  res.json({ message: 'API is running' })
}

const getPing = (req, res) => {
  res.json({ message: 'pong' })
}

module.exports = { getHealth, getPing }
