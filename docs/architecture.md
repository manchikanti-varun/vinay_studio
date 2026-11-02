# Architecture and delivery plan

## Workspace layout

- `apps/storefront`: Next.js App Router customer experience and photo customization preview.
- `apps/admin`: Next.js studio operations workspace.
- `apps/api`: Express API, MongoDB models, pricing, and payment webhook boundary.
- `apps/worker`: BullMQ worker process for long-running image and order tasks.
- `packages/shared`: domain types and common pricing calculations.
- `packages/image-renderer`: Sharp-based production output and watermarked preview functions.

The storefront and admin are separate clients. The API owns pricing and future order transitions. MongoDB stores business records and immutable price snapshots; original and production image bytes belong in private object storage. Redis/BullMQ handles work that should not block HTTP requests.

## Implemented foundation

- Responsive storefront with the listing's name and contact details, four product entry points, category selection, image preview, and session-backed bag.
- Client editor controls for zoom, pan, and rotation. Uploaded originals and canonical transformation documents are stored separately from watermarked preview assets.
- Shared frame, mug, and service pricing defaults; storefront quote display reads the API pricing endpoint when reachable.
- Express API health, catalog, pricing, quote, and Razorpay webhook signature validation routes.
- HTTP-only guest sessions, signature-checked image uploads into private R2 keys, expiring signed preview URLs, guest-scoped cart/customization persistence, server-side checkout pricing, and Razorpay order creation.
- Signed browser payment callback validation and captured webhook idempotency. Only a verified `payment.captured` event marks an order paid.
- Guest-session-scoped order tracking and activity retrieval.
- Mongoose models for users, roles, categories, products, variants, pricing, templates, uploads, customizations, carts, orders, payment, invoice, restoration, production, shipment, activity, settings, and notifications.
- Sharp renderer functions for watermarked previews and print-sized image output.
- Admin overview with API status and a browser-local frame-price draft. It is not an authenticated database-backed settings editor yet.

## Delivery sequence

1. Foundation and runnable workspace.
2. Catalog and public studio content administration.
3. Database-backed admin pricing and product variant management.
4. Restoration provider interface, queue processing, immutable versions, admin workbench, and customer approval.
5. Invoice generation, shipping provider integration, carrier tracking, notifications, and reports.
6. Production queue, product-template validation, approved file export, and printable job packages.
7. Security hardening, integration tests, deployment, backups, and operations documentation.

## Guardrails

- Production work must be queued only after verified payment and required design approval.
- Never overwrite the uploaded original. Revisions create new version records and assets.
- Preview and production use the same saved transformation document, with a separate preview watermark step.
- Admin routes must require role authorization before they are exposed beyond local development.
- An order's price is calculated server-side and snapshotted; clients cannot set the charged amount.
- Original and production files stay private and are served through short-lived authorized links.
- Guest order lookup is scoped to an HTTP-only session cookie; order numbers alone do not grant access.
