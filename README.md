# Vinay Colour Lab and Photo Studio

A premium storefront and private studio desk for photo keepsakes, customization, online checkout, customer design approval, and print file preparation.

## Run the website locally

Requirements: Node.js 20+, npm 10+, Docker Desktop (or local MongoDB and Redis).

1. Copy `.env.example` to `.env` and set a random `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
2. Start local databases with `docker compose up -d`.
3. Install and run the storefront and API: `npm install` then `npm run dev`.
4. In another terminal, run the admin desk: `npm run dev:admin`.
5. Run the background worker when Redis based jobs are configured: `npm run dev:worker`.

- Storefront: http://localhost:3000
- Studio desk: http://localhost:3001
- API health check: http://localhost:4000/health

The storefront and admin desk can open without third party credentials. Secure photo upload, carts, and orders require MongoDB and Cloudflare R2. Checkout additionally requires Razorpay credentials and a shipping amount. The admin desk requires `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a `SESSION_SECRET` of at least 32 characters. Studio pricing and flat shipping are editable in the authenticated admin desk.

## What works

- Responsive storefront with private photo upload, cropping controls, watermark previews, pricing, cart, Razorpay checkout integration, customer approval, and order tracking.
- Private admin desk with expiring authenticated sessions, order status management, product/category records, server pricing, restoration review, invoice downloads, Shiprocket shipment creation/tracking, and a print production queue.
- Private R2 storage integration, MongoDB persistence, Razorpay signature/webhook verification, high resolution Sharp production rendering, and private downloadable payment receipts.
- Configurable white/coloured mug print dimensions. Frame production uses the supported shared sizes. Restoration results stay gated behind customer consent, studio review, and customer approval.

## Production integrations to configure

Copy the secrets and provider settings from `.env.example`. Set production URLs for `STOREFRONT_URL`, `ADMIN_URL`, and `NEXT_PUBLIC_API_URL`. Configure MongoDB, Redis, R2, Razorpay, Replicate (optional), Shiprocket (optional), and a real shipping rate before accepting orders. Add the real mug wrap dimensions and confirm frame templates, color profile, printer bleed, applicable tax registration/rate, packaging, and carrier rules with the studio before producing customer orders.

AI restoration uses the pinned Replicate GFPGAN model when `REPLICATE_API_TOKEN` is configured and the customer has explicitly opted in; the studio must review every result. Without that token, the studio can upload a manually restored image. Shiprocket shipment, AWB, pickup, label, and tracking calls require the API user credentials, an existing pickup location, and confirmed package dimensions/weight. Invoices are private PDF receipts and currently display no GST/tax breakdown because the studio tax registration/rate has not been provided. Email and WhatsApp notifications are not connected. Provider boundaries are in `apps/api/src/services/providers.ts`.

## Workspace map

- `apps/storefront`: customer website and order tracking.
- `apps/admin`: private studio desk.
- `apps/api`: Express API, MongoDB models, payments, storage, and rendering workflows.
- `apps/worker`: BullMQ worker entry point.
- `packages/shared`: price calculation and domain types.
- `packages/image-renderer`: watermark preview and print output renderer.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Business reference

The public listing identifies Vinay Colour Lab and Photo Studio in Kukatpally, Hyderabad. Contact: +91 80747 84902. Verify address, hours, services, and approved photography with the business before publishing them as operational facts.
