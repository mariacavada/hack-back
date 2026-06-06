const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

/**
 * Llama a Gemini con timeout configurable y devuelve JSON parseado.
 * @param {string} prompt
 * @param {number} timeoutMs - default 20 segundos
 */
async function askGemini(prompt, timeoutMs = 20000) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  // Race entre la llamada real y un timeout
  const geminiCall = model.generateContent(prompt)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini tardó demasiado (timeout)')), timeoutMs)
  )

  const result = await Promise.race([geminiCall, timeout])
  const text = result.response.text()

  // Extrae el bloque JSON aunque venga envuelto en markdown ```json ... ```
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!match) throw new Error('Gemini no devolvió JSON válido: ' + text)

  return JSON.parse(match[1] ?? match[0])
}

module.exports = { askGemini }
