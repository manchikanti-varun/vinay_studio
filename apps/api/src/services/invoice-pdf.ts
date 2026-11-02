import type { InvoiceData } from "./invoice-types";

function ascii(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
}

export function renderInvoicePdf(data: InvoiceData): Buffer {
  const rows: Array<{ text: string; size?: number; bold?: boolean; x?: number; y?: number }> = [];
  const put = (text: string, x: number, y: number, size = 10, bold = false) => rows.push({ text, x, y, size, bold });
  put("VINAY COLOUR LAB AND PHOTO STUDIO", 44, 790, 17, true);
  put("Kukatpally, Hyderabad | +91 80747 84902", 44, 770, 9);
  put("INVOICE / PAYMENT RECEIPT", 44, 728, 15, true);
  put(`Invoice: ${data.invoiceNumber}`, 44, 704, 10);
  put(`Order: ${data.orderNumber}`, 44, 688, 10);
  put(`Issued: ${data.issuedAt.toLocaleDateString("en-IN")}`, 44, 672, 10);
  put(`Customer: ${data.customer.name}`, 44, 640, 10, true);
  put(data.customer.email, 44, 624, 9);
  put(data.customer.phone, 44, 610, 9);
  put(`${data.customer.address}, ${data.customer.city}, ${data.customer.state} ${data.customer.postalCode}`, 44, 596, 9);
  put("ITEM", 44, 550, 9, true); put("QTY", 390, 550, 9, true); put("UNIT", 438, 550, 9, true); put("AMOUNT", 502, 550, 9, true);
  rows.push({ text: "", x: 44, y: 542, size: 1 });
  let y = 526;
  for (const item of data.items.slice(0, 20)) {
    put(item.title.slice(0, 52), 44, y, 9); put(String(item.quantity), 394, y, 9);
    put(formatRupees(item.unitPricePaise), 438, y, 9); put(formatRupees(item.unitPricePaise * item.quantity), 502, y, 9);
    y -= 21;
  }
  const totalsY = Math.max(150, y - 20);
  put("Subtotal", 390, totalsY, 10); put(formatRupees(data.subtotalPaise), 502, totalsY, 10);
  put("Shipping", 390, totalsY - 18, 10); put(formatRupees(data.shippingPaise), 502, totalsY - 18, 10);
  put("TOTAL PAID", 390, totalsY - 44, 12, true); put(formatRupees(data.totalPaise), 502, totalsY - 44, 12, true);
  put("Payment status: PAID", 44, totalsY - 80, 10, true);
  put("Thank you for choosing Vinay Colour Lab. Keep this receipt for your records.", 44, 74, 9);
  put("Tax registration details were not provided. This document does not show a tax breakdown.", 44, 58, 8);

  const commands = rows.map((row) => row.size === 1
    ? `0.75 w 44 ${row.y} m 551 ${row.y} l S`
    : `BT /${row.bold ? "F2" : "F1"} ${row.size ?? 10} Tf 1 0 0 1 ${row.x ?? 44} ${row.y ?? 0} Tm (${ascii(row.text)}) Tj ET`).join("\n");
  const stream = Buffer.from(commands, "ascii");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>", "ascii"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"), stream, Buffer.from("\nendstream", "ascii")]),
  ];
  const parts = [Buffer.from("%PDF-1.4\n% VCL receipt\n", "ascii")];
  const offsets = [0];
  let position = parts[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(position);
    const object = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "ascii"), objects[i]!, Buffer.from("\nendobj\n", "ascii")]);
    parts.push(object); position += object.length;
  }
  const xrefOffset = position;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "ascii"));
  return Buffer.concat(parts);
}

function formatRupees(paise: number): string { return `INR ${((paise || 0) / 100).toFixed(2)}`; }
