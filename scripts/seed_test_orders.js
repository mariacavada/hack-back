// Pega esto en MongoDB Shell (Atlas o Compass)
// Cliente: Tacos El Rey — customer_id: 6a248b26a3a106d060976128

const customerId = "6a248b26a3a106d060976128"
const cedisId = "CEDIS-CDMX-01"

const pedidos = [
  { id: "PED-001", fecha: "2026-03-01", total: 1240 },
  { id: "PED-002", fecha: "2026-03-08", total: 980  },
  { id: "PED-003", fecha: "2026-03-16", total: 1350 },
  { id: "PED-004", fecha: "2026-03-23", total: 1100 },
  { id: "PED-005", fecha: "2026-03-30", total: 1450 },
  { id: "PED-006", fecha: "2026-04-07", total: 1200 },
  { id: "PED-007", fecha: "2026-04-14", total: 990  },
  { id: "PED-008", fecha: "2026-04-21", total: 1300 },
  { id: "PED-009", fecha: "2026-04-28", total: 1150 },
  { id: "PED-010", fecha: "2026-05-05", total: 1400 },
  { id: "PED-011", fecha: "2026-05-12", total: 1050 },
  { id: "PED-012", fecha: "2026-05-19", total: 1280 },
]

// Insertar Orders
db.orders.insertMany(pedidos.map(p => ({
  id_pedido: p.id,
  customer_id: customerId,
  cedis_id: cedisId,
  fecha_pedido: p.fecha,
  status_final: "entregado",
  valor_pedido: p.total,
  subtotal: p.total * 0.84,
  total: p.total,
  pais: "MX",
  business_unit: "Tacos",
  feedback_cliente: {},
  created_at: new Date(p.fecha),
})))

// Insertar OrderDetails (3 SKUs fijos por pedido)
const skus = [
  { sku: "TACO-BISTEC-KG",   nombre: "Bistec p/ tacos 1kg",  qty: 5  },
  { sku: "TACO-PASTOR-KG",   nombre: "Pastor p/ tacos 1kg",  qty: 3  },
  { sku: "TORTILLA-MAIZ-KG", nombre: "Tortilla de maíz 1kg", qty: 10 },
]

const details = []
pedidos.forEach(p => {
  skus.forEach((s, i) => {
    details.push({
      id_linea: `${p.id}-L${i + 1}`,
      id_pedido: p.id,
      sku_solicitado: s.sku,
      nombre_sku_solicitado: s.nombre,
      quantity: s.qty,
      status: "entregado",
    })
  })
})

db.orderdetails.insertMany(details)

print("✓ Insertados", pedidos.length, "pedidos y", details.length, "detalles para Tacos El Rey")
