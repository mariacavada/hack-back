const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

/**
 * Llama a Gemini y devuelve JSON parseado.
 * El prompt DEBE pedir explícitamente respuesta en JSON.
 */
async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const result = await model.generateContent(prompt)
  const text = result.response.text()

  // Extrae el bloque JSON aunque venga envuelto en markdown ```json ... ```
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!match) throw new Error('Gemini no devolvió JSON válido: ' + text)

  return JSON.parse(match[1] ?? match[0])
}

module.exports = { askGemini }
