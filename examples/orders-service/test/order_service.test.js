const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrder, priceItems } = require("../src/services/order_service");

test("creates an order for an active user", () => {
  const order = createOrder("u_100", [{ sku: "sku_book", quantity: 2 }]);
  assert.equal(order.ownerId, "u_100");
  assert.equal(order.total, 2400);
});

test("prices multiple items", () => {
  assert.equal(priceItems([{ sku: "sku_book" }, { sku: "sku_pen", quantity: 4 }]), 2200);
});
