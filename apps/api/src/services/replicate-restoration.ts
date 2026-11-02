const modelVersion = "tencentarc/gfpgan:0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c";

export async function restoreWithReplicate(imageUrl: string): Promise<{ bytes: Buffer; mimeType: string; predictionId: string }> {
  const token = process.env.REPLICATE_API_TOKEN ?? (process.env.RESTORATION_PROVIDER === "replicate" ? process.env.RESTORATION_API_KEY : undefined);
  if (!token) throw new Error("restoration_provider_not_configured");
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ version: modelVersion, input: { img: imageUrl, scale: 2, version: "v1.4" } }),
    signal: AbortSignal.timeout(75_000),
  });
  let prediction = await response.json() as { id?: string; status?: string; output?: unknown; error?: string; urls?: { get?: string } };
  if (!response.ok) throw new Error(`replicate_request_failed_${response.status}`);
  if (!prediction.id) throw new Error("replicate_prediction_id_missing");
  const predictionId = prediction.id;
  for (let attempt = 0; ["starting", "processing", "queued"].includes(prediction.status ?? "") && attempt < 12; attempt++) {
    if (!prediction.urls?.get || new URL(prediction.urls.get).hostname !== "api.replicate.com") break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const poll = await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!poll.ok) throw new Error(`replicate_poll_failed_${poll.status}`);
    prediction = await poll.json() as typeof prediction;
  }
  if (prediction.status !== "succeeded") throw new Error(prediction.status === "failed" ? `replicate_failed_${String(prediction.error ?? "unknown").slice(0, 100)}` : "replicate_timeout");
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const outputUrl = typeof output === "string" ? output : output && typeof output === "object" && typeof (output as { url?: unknown }).url === "string" ? String((output as { url: string }).url) : "";
  if (!outputUrl) throw new Error("replicate_output_missing");
  const parsedOutputUrl = new URL(outputUrl);
  if (parsedOutputUrl.protocol !== "https:" || !(parsedOutputUrl.hostname === "replicate.delivery" || parsedOutputUrl.hostname.endsWith(".replicate.delivery"))) throw new Error("replicate_output_host_invalid");
  const file = await fetch(outputUrl, { signal: AbortSignal.timeout(30_000) });
  if (!file.ok) throw new Error(`replicate_output_download_failed_${file.status}`);
  const maxBytes = 25 * 1024 * 1024;
  const declaredLength = Number(file.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("restoration_output_size_invalid");
  if (!file.body) throw new Error("restoration_output_empty");
  const reader = file.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    totalBytes += part.value.length;
    if (totalBytes > maxBytes) { await reader.cancel(); throw new Error("restoration_output_size_invalid"); }
    chunks.push(part.value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (!bytes.length) throw new Error("restoration_output_empty");
  const type = file.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!type.startsWith("image/")) throw new Error("restoration_output_not_image");
  return { bytes, mimeType: type, predictionId };
}
