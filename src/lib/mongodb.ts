import { MongoClient, Db, type MongoClientOptions } from "mongodb";
import { connectWithRetry } from "./mongoRetry";

if (!import.meta.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = import.meta.env.MONGODB_URI;

// Connection pool tuning for serverless. Small pool because each invocation
// is short-lived and shares the container; server selection timeout trimmed
// from the 30s default so a stalled primary fails within the request window
// instead of blocking the whole function. 10s (not the original 5s): even
// with functions pinned to fra1 next to the Atlas cluster, cold-start
// topology rediscovery occasionally needs >5s (Sentry MAHALLE-PROD-2) —
// 5s turned those into user-facing errors instead of slow successes.
const options: MongoClientOptions = {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
};

// Cache the client promise on globalThis in ALL environments. On Vercel
// serverless, module-level globals are reused across warm invocations of the
// same container; without this, every invocation pays a fresh TCP+TLS+auth
// handshake to Atlas (~200–500ms). In dev it prevents HMR from opening a new
// connection on every reload. Same pattern MongoDB + Vercel officially
// recommend for Next.js / Astro serverless functions.
const globalWithMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function newClientPromise(): Promise<MongoClient> {
  const client = new MongoClient(uri, options);
  const p: Promise<MongoClient> = client.connect().catch(async (err) => {
    // Uncache the failed attempt so the NEXT caller connects fresh. Without
    // this, a single cold-start failure leaves a rejected promise cached on
    // the container and every later request awaits that same rejection until
    // the container is recycled.
    if (globalWithMongo._mongoClientPromise === p) {
      globalWithMongo._mongoClientPromise = undefined;
    }
    // Release the failed client's sockets + heartbeat timers.
    await client.close().catch(() => {});
    throw err;
  });
  // Mark the rejection observed. Nothing awaits this promise at module-eval
  // time, so a cold-start connect failure otherwise surfaced as an
  // `unhandledRejection` with no request context (Sentry MAHALLE-PROD-2).
  // Awaiters still receive the rejection — a real DB-dependent request fails
  // loudly and gets captured by the middleware WITH its request context;
  // a failure nobody was waiting on stays quiet, which is correct.
  p.catch(() => {});
  return p;
}

function getClientPromise(): Promise<MongoClient> {
  if (!globalWithMongo._mongoClientPromise) {
    globalWithMongo._mongoClientPromise = newClientPromise();
  }
  return globalWithMongo._mongoClientPromise;
}

// Export a module-scoped MongoClient promise. By doing this in a separate
// module, the client can be shared across functions. WARNING: this binding is
// taken ONCE at module load and never replaced — if that first connect fails,
// every later `await clientPromise` on the same instance rejects until the
// instance is recycled (the un-cache above only frees the globalThis slot).
// Its only remaining consumer is the Auth.js adapter, which Credentials + JWT
// never calls. Everything else uses `connectDB()` (2026-09-22: login, the JWT
// recheck, register, users/update and profile/tour moved over).
const clientPromise: Promise<MongoClient> = getClientPromise();
export default clientPromise;

// Helper function to get DB instance (backward compatibility).
// One retry for a cold-start connect failure (2026-09-20, see mongoRetry.ts):
// the failed attempt is un-cached above, so the second `getClientPromise()`
// builds a fresh client — what the NEXT request used to get, this caller now
// gets itself. A real outage still throws (last error) and stays loud.
export async function connectDB(): Promise<Db> {
  const client = await connectWithRetry(getClientPromise);
  return client.db();
}