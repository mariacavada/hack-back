const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Gemini regularmente devuelve 503 "high demand" — picos transitorios de
// carga en Google, no errores nuestros (caso real visto en logs: el chatbot
// tronando con "[503 Service Unavailable] ... high demand"). Reintentamos
// esos con backoff. OJO: 429 NO se reintenta a propósito — es la cuota
// diaria del free tier (20 requests/día para gemini-2.5-flash, compartida
// por TODOS los features que usan Gemini: chatbot, stock-predict,
// substitutions, asignación de repartidor, reorder-patterns). Si ya se
// agotó, reintentar solo desperdicia más cupo y tarda más en fallar.
function esErrorTransitorio(err) {
  const msg = err?.message || ''
  return /\[(500|503)\b/.test(msg) || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)
}

async function conReintentos(fn, intentos = 3, baseDelayMs = 1200) {
  let ultimoError
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn()
    } catch (err) {
      ultimoError = err
      if (intento === intentos || !esErrorTransitorio(err)) throw err
      await new Promise((r) => setTimeout(r, baseDelayMs * intento))
    }
  }
  throw ultimoError
}

function llamarGemini(prompt, timeoutMs) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const geminiCall = model.generateContent(prompt)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini tardó demasiado (timeout)')), timeoutMs)
  )
  return Promise.race([geminiCall, timeout])
}

/**
 * Llama a Gemini y devuelve JSON parseado.
 * El prompt DEBE pedir explícitamente respuesta en JSON.
 * @param {string} prompt
 * @param {number} timeoutMs - default 20 segundos
 */
async function askGemini(prompt, timeoutMs = 20000) {
  const result = await conReintentos(() => llamarGemini(prompt, timeoutMs))
  const text = result.response.text()

  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!match) throw new Error('Gemini no devolvió JSON válido: ' + text)

  return JSON.parse(match[1] ?? match[0])
}

/**
 * Llama a Gemini y devuelve texto plano (para el chatbot RAG).
 */
async function askGeminiText(prompt, timeoutMs = 20000) {
  const result = await conReintentos(() => llamarGemini(prompt, timeoutMs))
  return result.response.text()
}

module.exports = { askGemini, askGeminiText }
