# Studio setup required for production

The shop identity and public phone/address on the storefront come from the supplied Google Maps listing. Confirm details remain current before launch.

The following operational values have not been inferred:

- Frame print area, mat/opening size, bleed, and trim tolerance for each configured size.
- Mug model, printable wrap dimensions, bleed, safe zones, and color profile for each mug color.
- Printer model, accepted file format, color profile, and any required finishing settings.
- GST registration and applicable tax configuration.
- Shipping pricing, pickup origin details, and Shiprocket account setup.
- Razorpay account keys and webhook secret.
- Private Cloudflare R2 bucket credentials and lifecycle policies.
- Redis endpoint and restoration provider credentials.

Provide service credentials through environment variables only. Before production output is enabled, enter and validate real product template measurements in the admin settings.

Set `SHIPPING_DEFAULT_PAISE` before starting the API to seed the initial public shipping quote. The current dashboard does not yet provide a database-backed shipping editor; checkout returns unavailable until a shipping price is configured.
