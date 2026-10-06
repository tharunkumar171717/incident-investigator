# orders-service (demo)

A tiny zero-dependency Node.js service used to demo the incident investigator.
It contains a real bug: `user_repository.getUser()` was changed in v1.4 to
return `null` for unknown or soft-deleted users instead of throwing, but
`order_service.createOrder()` still dereferences the result.

`npm test` runs `node --test` (Node 20+). No `npm install` needed.

## Try it

1. Push this folder to its own GitHub repository (e.g. `you/orders-service`)
   and commit the files in two commits so there is history to inspect.
2. In the investigator: Repositories → connect `you/orders-service`, then in
   Settings set the test command to `node --test`.
3. Create an incident with the sample data below and click Investigate.

**Title:** POST /api/orders is returning 500 errors

**Endpoint:** `POST /api/orders`

**Error message:** `TypeError: Cannot read properties of null (reading 'id')`

**Stack trace:**

```
TypeError: Cannot read properties of null (reading 'id')
    at Object.createOrder (/srv/orders-service/src/services/order_service.js:20:18)
    at handleCreateOrder (/srv/orders-service/src/routes/orders.js:7:30)
    at Server.<anonymous> (/srv/orders-service/src/server.js:23:22)
```

**Logs:**

```
2026-10-06T14:05:10Z INFO POST /api/orders 201 4ms
2026-10-06T14:05:12Z ERROR POST /api/orders 500 TypeError: Cannot read properties of null (reading 'id') user=u_300
2026-10-06T14:05:14Z INFO GET /api/orders/6f1c 200 1ms
2026-10-06T14:05:15Z ERROR POST /api/orders 500 TypeError: Cannot read properties of null (reading 'id') user=u_999
```
