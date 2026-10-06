const orderService = require("../services/order_service");

async function handleCreateOrder(body) {
  if (!body || typeof body.userId !== "string" || !Array.isArray(body.items) || body.items.length === 0) {
    return { status: 400, body: { error: "userId and at least one item are required" } };
  }
  const order = orderService.createOrder(body.userId, body.items);
  return { status: 201, body: order };
}

function handleGetOrder(id) {
  const order = orderService.getOrder(id);
  return order ? { status: 200, body: order } : { status: 404, body: { error: "order not found" } };
}

module.exports = { handleCreateOrder, handleGetOrder };
