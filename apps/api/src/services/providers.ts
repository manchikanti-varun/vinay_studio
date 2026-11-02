export type RestorationState = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type RestorationRequest = { originalStorageKey: string; preserveIdentity: true; colorize: boolean; callbackUrl?: string };
export type RestorationSubmission = { providerJobId: string; state: RestorationState };

/** Implementations must never mutate the source asset and must return a new result asset. */
export interface PhotoRestorationProvider {
  submitRestoration(input: RestorationRequest): Promise<RestorationSubmission>;
  getJobStatus(providerJobId: string): Promise<RestorationState>;
  retrieveResult(providerJobId: string): Promise<{ bytes: Buffer; mimeType: string }>;
  cancelJob(providerJobId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

export interface PrivateAssetStorage {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Buffer; mimeType: string }>;
  delete(key: string): Promise<void>;
  createSignedReadUrl(key: string, expiresInSeconds: number): Promise<string>;
  createSignedUploadUrl(key: string, mimeType: string, expiresInSeconds: number): Promise<string>;
}

export type ShipmentRequest = { orderNumber: string; recipient: { name: string; phone: string; address: string; city: string; state: string; postalCode: string }; weightGrams: number; valuePaise: number };
export type ShipmentCreated = { shipmentId: string; awb?: string; trackingUrl?: string; labelUrl?: string };

export interface ShippingProvider {
  createShipment(input: ShipmentRequest): Promise<ShipmentCreated>;
  cancelShipment(shipmentId: string): Promise<void>;
  getTracking(shipmentId: string): Promise<Array<{ status: string; message: string; occurredAt: Date }>>;
}
