import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

const DB_NAME = process.env.MONGODB_DB ?? "unblind";

declare global {
  // eslint-disable-next-line no-var
  var _unblindMongoClient: Promise<MongoClient> | undefined;
}

let cachedClient: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add a connection string to .env.",
    );
  }

  // Disable wire-protocol compression. The driver negotiates snappy/zstd
  // with Atlas by default; both use ArrayBuffer transfers that Node 24
  // leaves detached, so the next sendCommand on the same connection blows
  // up with "TypedArray.set on a detached ArrayBuffer".
  const options: MongoClientOptions = { compressors: [] };

  if (process.env.NODE_ENV === "development") {
    if (!global._unblindMongoClient) {
      global._unblindMongoClient = new MongoClient(uri, options).connect();
    }
    return global._unblindMongoClient;
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri, options).connect();
  }
  return cachedClient;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(DB_NAME);
}
