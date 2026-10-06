const products = new Map([
  ["sku_book", { sku: "sku_book", price: 1200 }],
  ["sku_pen", { sku: "sku_pen", price: 250 }],
]);

function getProduct(sku) {
  return products.get(sku) ?? null;
}

module.exports = { getProduct };
