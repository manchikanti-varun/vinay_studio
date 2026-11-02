import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue("studio-jobs", { connection });
const processor = new Worker("studio-jobs", async (job) => {
  // Job handlers are added with restoration and production phases. Unknown jobs fail visibly.
  throw new Error(`No handler registered for job type: ${job.name}`);
}, { connection, concurrency: 2 });
processor.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", jobId: job?.id, job: job?.name, error: error.message })));
processor.on("ready", () => console.log("Studio worker connected to Redis"));
process.on("SIGTERM", async () => { await processor.close(); await queue.close(); await connection.quit(); process.exit(0); });
