# API contracts

Base path: `/api/v1`. Amounts returned by quote endpoints are integer paise; display values are INR.

## Available

### `GET /health`

Returns service availability and MongoDB connection state. Does not expose credentials or private customer records.

### `GET /api/v1/catalog`

Returns active catalog products (empty when MongoDB is not connected) and current top-level category keys.

### `GET /api/v1/pricing`

Returns frame prices, material add-ons, mug prices, and the digital-printing and restoration fees. Uses development defaults when MongoDB is disconnected.

### `POST /api/v1/pricing/quote`

Accepts a category plus the required variant fields. The server computes the quote from configured prices; client-supplied prices are not accepted.

Example frame request:

```json
{"category":"frames","size":"8x12","material":"glass"}
```

Example response:

```json
{"currency":"INR","totalPaise":44900,"breakdown":[{"label":"8 × 12 glass frame","amountPaise":44900}]}
```

### `POST /webhooks/razorpay`

Validates the Razorpay webhook HMAC using the raw request body. Captured events are checked against the expected provider order, amount, currency, and state; repeated events are idempotent. A verified capture marks the order paid and writes an activity record.

### Guest session and private photo upload

- `POST /api/v1/guest/session` issues or resumes an HTTP-only guest session cookie. MongoDB must be available.
- `POST /api/v1/assets/upload` accepts a raw JPEG, PNG, or WebP body up to 25 MB. It verifies file signatures and decoded dimensions, stores the untouched original in a private R2 prefix, and stores a separately generated watermarked preview.
- `GET /api/v1/assets/:id/preview` returns a short-lived preview URL only to the owning guest.

### Cart and checkout

- `GET /api/v1/cart`, `POST /api/v1/cart/items`, and `DELETE /api/v1/cart/items/:id` operate on the current guest's persisted cart.
- `GET /api/v1/shipping/quote` returns the configured shipping price; without `SHIPPING_DEFAULT_PAISE` set at API startup, checkout is unavailable.
- `POST /api/v1/checkout` requires a UUID `Idempotency-Key`, delivery details, a valid guest session, R2 assets owned by that guest, and configured shipping. It recalculates every line price on the server and creates a Razorpay order. Razorpay credentials are required.
- `POST /api/v1/payments/verify` validates the browser callback signature for feedback only. It does not mark an order paid; only the signed capture webhook does.
- `GET /api/v1/orders/:orderNumber` returns an order and activity for its owner guest session only.

## Not available yet

Admin authentication and management, restoration jobs, invoice generation/access, carrier shipping and tracking, and production queue integrations require subsequent delivery phases. The current worker does not generate production jobs yet. No production files are released by the current API.
