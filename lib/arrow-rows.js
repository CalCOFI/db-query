// arrow-rows.js — an Arrow result table → plain JS rows, for the results table and the CSV download.
//
// Both read the same rows (`state.rows` in app.js), so what a cell shows is what the CSV carries.
//
// DuckDB-WASM hands a DATE or TIMESTAMP column back through Arrow as a number: milliseconds since
// the epoch, whatever the column's unit (checked against duckdb-wasm 1.29.0 / apache-arrow 17.0.0:
// TIMESTAMP, TIMESTAMP_S, TIMESTAMP_NS, TIMESTAMPTZ and DATE all arrive as epoch ms). Printed raw
// that is `1620152278000` where the database holds `2021-05-04 18:17:58`. A cell is formatted as a
// date or a timestamp only when the Arrow schema says its column is one, never from the size of the
// number: a BIGINT that happens to hold 1620152278000 stays a number.
//
// Pure, no DOM and no imports, so `npm test` covers it (test/arrow-rows.test.js).

// apache-arrow's `Type.Date` and `Type.Timestamp` (`field.type.typeId`). The ids are the Arrow
// format's own, and every date / timestamp unit reports the same one.
export const ARROW_DATE      = 8;
export const ARROW_TIMESTAMP = 10;

// epoch ms (number or BigInt; a Date from an older Arrow) → ISO 8601 in UTC, or null when it is
// not a representable instant (DuckDB's 'infinity', say)
function isoUtc(v) {
  const d = new Date(v instanceof Date ? v.getTime() : Number(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// DATE → `YYYY-MM-DD`
export function formatDate(v) {
  const iso = isoUtc(v);
  return iso == null ? String(v) : iso.split("T")[0];
}

// TIMESTAMP → `YYYY-MM-DD HH:MM:SS`, in UTC with no timezone conversion: the release's times are
// naive UTC. Milliseconds follow only when they are not zero (`… 01:02:03.456`), as DuckDB itself
// prints them, so the CSV does not drop them.
export function formatTimestamp(v) {
  const iso = isoUtc(v);
  return iso == null ? String(v) : iso.replace("T", " ").replace(/(\.000)?Z$/, "");
}

// one cell: `typeId` is its column's Arrow type id. Every type but DATE and TIMESTAMP is handled
// as before (BigInt → Number, Date → ISO string, any other object → its toString()).
export function cellValue(v, typeId) {
  if (v == null) return v;
  if (typeId === ARROW_DATE)      return formatDate(v);
  if (typeId === ARROW_TIMESTAMP) return formatTimestamp(v);
  if (typeof v === "bigint")      return Number(v);
  if (v instanceof Date)          return v.toISOString();
  if (typeof v === "object" && v.toString) return v.toString();
  return v;
}

// Arrow table → array of `{ column: value }` rows
export function arrowToRows(arrow) {
  const fields = arrow.schema.fields;
  return arrow.toArray().map((row) => {
    const r = row.toJSON ? row.toJSON() : row;
    const o = {};
    for (const f of fields) o[f.name] = cellValue(r[f.name], f.type?.typeId);
    return o;
  });
}
