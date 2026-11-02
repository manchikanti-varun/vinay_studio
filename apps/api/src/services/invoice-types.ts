export type InvoiceData = {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: Date;
  customer: { name: string; email: string; phone: string; address: string; city: string; state: string; postalCode: string };
  items: Array<{ title: string; quantity: number; unitPricePaise: number }>;
  subtotalPaise: number;
  shippingPaise: number;
  totalPaise: number;
};
