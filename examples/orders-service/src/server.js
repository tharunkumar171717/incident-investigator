const http = require("node:http");
const { handleCreateOrder, handleGetOrder } = require("./routes/orders");

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    let result;
    if (req.method === "POST" && req.url === "/api/orders") {
      result = await handleCreateOrder(await readJson(req));
    } else if (req.method === "GET" && req.url.startsWith("/api/orders/")) {
      result = handleGetOrder(req.url.split("/").pop());
    } else {
      result = { status: 404, body: { error: "not found" } };
    }
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
    console.log(`${new Date().toISOString()} INFO ${req.method} ${req.url} ${result.status} ${Date.now() - started}ms`);
  } catch (err) {
    const status = err.status ?? 500;
    console.error(`${new Date().toISOString()} ERROR ${req.method} ${req.url} ${status} ${err.stack}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: status === 500 ? "internal server error" : err.message }));
  }
});

if (require.main === module) {
  server.listen(process.env.PORT ?? 8080, () => console.log("orders-service listening"));
}

module.exports = { server };
