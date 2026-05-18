// duckdb.js — lazy, single-shared DuckDB-WASM connection.
//
// The whole site shares one connection: cold start (~5 s) happens on first
// Run, then subsequent Runs reuse the same connection (and DuckDB's httpfs
// cache of Parquet ranges). This is also what the original docs/match/
// implementation did; lifted here so every query module gets it for free.

const DUCKDB_VERSION = "1.29.0";

let _conn = null;
let _initPromise = null;

export async function getConn() {
  if (_conn) return _conn;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const duckdb = await import(
      `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`);
    const bundles = duckdb.getJsDelivrBundles();
    const bundle  = await duckdb.selectBundle(bundles);
    const worker  = await duckdb.createWorker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    await conn.query("INSTALL httpfs; LOAD httpfs;");
    await conn.query("INSTALL spatial; LOAD spatial;");
    _conn = conn;
    return conn;
  })();
  return _initPromise;
}

export async function isReady() {
  return _conn != null;
}
