const crypto = require("node:crypto");
const userRepository = require("../repositories/user_repository");
const catalog = require("../repositories/catalog");

const orders = new Map();

function priceItems(items) {
  return items.reduce((sum, item) => {
    const product = catalog.getProduct(item.sku);
    if (!product) throw Object.assign(new Error(`unknown sku ${item.sku}`), { status: 400 });
    return sum + product.price * (item.quantity ?? 1);
  }, 0);
}

function createOrder(userId, items) {
  const user = userRepository.getUser(userId);
  const total = priceItems(items);
  const order = {
    id: crypto.randomUUID(),
    ownerId: user.id,
    email: user.email,
    items,
    total,
    currency: "USD",
    createdAt: new Date().toISOString(),
  };
  orders.set(order.id, order);
  return order;
}

function getOrder(id) {
  return orders.get(id) ?? null;
}

module.exports = { createOrder, getOrder, priceItems };
