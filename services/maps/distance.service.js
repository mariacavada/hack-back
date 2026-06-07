/**
 * Calcula distancia y tiempo estimado entre dos puntos (sin API externa).
 * Usa fórmula Haversine para distancia en km.
 * Velocidad promedio de reparto urbano en Monterrey: 30 km/h
 */

const VELOCIDAD_KMH = 30

/**
 * Distancia en km entre dos coordenadas (Haversine)
 */
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Retorna distancia y ETA para cada repartidor hacia un destino.
 * @param {{ lat: number, lng: number }} destino
 * @param {Array<{ _id, nombre, ubicacion_actual, calificacion_promedio, pedidos_activos }>} repartidores
 */
function calcularETAs(destino, repartidores) {
  return repartidores.map((r) => {
    const km   = distanciaKm(r.ubicacion_actual.lat, r.ubicacion_actual.lng, destino.lat, destino.lng)
    const minutos = Math.round((km / VELOCIDAD_KMH) * 60)
    return {
      driver_id:            String(r._id),
      nombre:               r.nombre,
      distancia_km:         +km.toFixed(2),
      eta_minutos:          minutos,
      calificacion:         r.calificacion_promedio || 0,
      ubicacion_actual:     r.ubicacion_actual,
    }
  })
}

module.exports = { distanciaKm, calcularETAs }
