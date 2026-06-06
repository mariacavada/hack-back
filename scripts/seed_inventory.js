// Inventario para el CEDIS del cliente de prueba
db.inventariocedis.insertMany([
  { cedis_id: "CEDIS-CDMX-01", sku: "TACO-BISTEC-KG",   stock_disponible: 50, stock_reservado: 5, stock_minimo: 10 },
  { cedis_id: "CEDIS-CDMX-01", sku: "TACO-PASTOR-KG",   stock_disponible: 30, stock_reservado: 3, stock_minimo: 5  },
  { cedis_id: "CEDIS-CDMX-01", sku: "TORTILLA-MAIZ-KG", stock_disponible: 0,  stock_reservado: 0, stock_minimo: 20 },
])
print("✓ Inventario insertado — TORTILLA-MAIZ-KG sin stock (debe filtrarse)")
