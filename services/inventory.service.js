/**
 * Servicio de inventario — apartado (reserva) y liberación de stock en CEDIS
 *
 * Regla de negocio: al CEDIS nunca se le puede "acabar" el stock de golpe por
 * un pedido — cuando un cliente hace un pedido, las unidades se APARTAN
 * (se mueven de stock_disponible → stock_reservado) de forma atómica. Si no
 * hay suficiente disponible, el pedido se rechaza (o se hace rollback de lo
 * ya apartado) en vez de dejar el inventario en negativo.
 *
 * Cuando un pedido se cancela / queda incompleto, el apartado se libera
 * (stock_reservado → stock_disponible) para que vuelva a estar disponible.
 *
 * Cada movimiento queda registrado en InventoryMvt para trazabilidad y para
 * que el modelo de predicción de agotamiento (stockPredict.service) tenga
 * datos reales de salidas.
 */

const InventarioCedis = require('../models/InventarioCedis.model')
const InventoryMvt = require('../models/InventoryMvt.model')

/**
 * Aparta stock para un conjunto de items de un pedido. Operación atómica por
 * SKU (usa $gte para nunca dejar stock_disponible en negativo). Si algún SKU
 * no tiene suficiente disponible, revierte lo ya apartado en esta llamada y
 * lanza un error con `code: 'STOCK_INSUFICIENTE'` y `sku`.
 *
 * @param {string} cedis_id
 * @param {{sku: string, cantidad: number}[]} items
 * @param {string} id_pedido
 * @returns {Promise<{sku: string, cantidad: number, stock_antes: number, stock_despues: number}[]>}
 */
async function reserveStock(cedis_id, items, id_pedido) {
  if (!cedis_id) throw new Error('cedis_id es requerido para apartar stock')

  const reservas = []
  for (const { sku, cantidad } of items) {
    if (!sku || !cantidad || cantidad <= 0) continue

    const inv = await InventarioCedis.findOneAndUpdate(
      { cedis_id, sku, stock_disponible: { $gte: cantidad } },
      {
        $inc: { stock_disponible: -cantidad, stock_reservado: cantidad },
        $set: { ultima_salida: new Date() },
      },
      { new: true }
    )

    if (!inv) {
      // No había suficiente disponible: deshacemos lo apartado hasta ahora
      // en esta misma operación para no dejar el inventario inconsistente.
      if (reservas.length) {
        await releaseStock(cedis_id, reservas, id_pedido, 'rollback: stock insuficiente para completar el pedido')
      }
      const err = new Error(`Stock insuficiente de SKU "${sku}" en CEDIS "${cedis_id}"`)
      err.code = 'STOCK_INSUFICIENTE'
      err.sku = sku
      throw err
    }

    reservas.push({
      sku,
      cantidad,
      stock_antes: inv.stock_disponible + cantidad,
      stock_despues: inv.stock_disponible,
    })
  }

  if (reservas.length) {
    await InventoryMvt.insertMany(
      reservas.map((r) => ({
        cedis_id,
        sku: r.sku,
        tipo_movimiento: 'reserva',
        cantidad: r.cantidad,
        stock_antes: r.stock_antes,
        stock_despues: r.stock_despues,
        id_pedido,
        motivo: 'Apartado de inventario por nuevo pedido',
      }))
    )
  }

  return reservas
}

/**
 * Libera stock previamente apartado (ej. al cancelar un pedido): regresa las
 * unidades de stock_reservado a stock_disponible y registra el movimiento.
 *
 * @param {string} cedis_id
 * @param {{sku: string, cantidad: number}[]} items
 * @param {string} id_pedido
 * @param {string} [motivo]
 */
async function releaseStock(cedis_id, items, id_pedido, motivo = 'Liberación de apartado') {
  if (!cedis_id) return []

  const liberaciones = []
  for (const { sku, cantidad } of items) {
    if (!sku || !cantidad || cantidad <= 0) continue

    const inv = await InventarioCedis.findOneAndUpdate(
      { cedis_id, sku },
      {
        $inc: { stock_disponible: cantidad, stock_reservado: -cantidad },
        $set: { ultima_entrada: new Date() },
      },
      { new: true }
    )
    if (!inv) continue

    liberaciones.push({
      cedis_id,
      sku,
      tipo_movimiento: 'liberacion',
      cantidad,
      stock_antes: inv.stock_disponible - cantidad,
      stock_despues: inv.stock_disponible,
      id_pedido,
      motivo,
    })
  }

  if (liberaciones.length) await InventoryMvt.insertMany(liberaciones)
  return liberaciones
}

module.exports = { reserveStock, releaseStock }
