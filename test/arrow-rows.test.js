// Unit tests for lib/arrow-rows.js — an Arrow result → the rows the table and the CSV both read.
//
//   npm test
//
// The defect (2026-11-11): the "cruises" example showed `date_start` / `date_end` as
// 1620152278000. DuckDB-WASM returns a DATE or TIMESTAMP column through Arrow as epoch
// milliseconds, and the table printed the number. `arrowToRows` needs only the three things an
// Arrow table has here (`schema.fields[].name` / `.type.typeId`, `toArray()`, a row's `toJSON()`),
// so a stand-in is enough and apache-arrow is not a dependency. The stand-in's type ids and values
// are what duckdb-wasm 1.29.0 / apache-arrow 17.0.0 really return for each SQL type named below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowToRows, cellValue, formatDate, formatTimestamp,
         ARROW_DATE, ARROW_TIMESTAMP } from "../lib/arrow-rows.js";

// apache-arrow `Type` ids of the other columns used below
const INT = 2, FLOAT = 3, UTF8 = 5, TIME = 9;

// a stand-in Arrow table: `cols` is { name: typeId }, `rows` are plain objects
const table = (cols, rows) => ({
  schema:  { fields: Object.entries(cols).map(([name, typeId]) => ({ name, type: { typeId } })) },
  toArray: () => rows.map((r) => ({ toJSON: () => r })),
});

test("the cruises example: TIMESTAMP columns print as YYYY-MM-DD HH:MM:SS, not epoch ms", () => {
  const rows = arrowToRows(table(
    { cruise_key: UTF8, date_start: ARROW_TIMESTAMP, date_end: ARROW_TIMESTAMP, n_casts: INT },
    [{ cruise_key: "2021-05-3322", date_start: 1620152278000, date_end: 1620938237000, n_casts: 60n }]));
  assert.deepEqual(rows, [{
    cruise_key: "2021-05-3322",
    date_start: "2021-05-04 18:17:58",
    date_end:   "2021-05-13 20:37:17",
    n_casts:    60 }]);
});

test("a DATE column prints as YYYY-MM-DD", () => {
  assert.equal(cellValue(1620086400000, ARROW_DATE), "2021-05-04");
  assert.equal(formatDate(1620086400000), "2021-05-04");
});

test("the type comes from the schema, never from the size of the number", () => {
  const rows = arrowToRows(table(
    { ts: ARROW_TIMESTAMP, big: INT, dbl: FLOAT },
    [{ ts: 1620152278000, big: 1620152278000n, dbl: 1620152278000 }]));
  assert.equal(rows[0].ts, "2021-05-04 18:17:58");
  assert.equal(rows[0].big, 1620152278000);     // a BIGINT of the same size stays a number
  assert.equal(rows[0].dbl, 1620152278000);
});

test("times are UTC whatever the machine's timezone", () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ["America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(formatTimestamp(1620152278000), "2021-05-04 18:17:58", zone);
      assert.equal(formatDate(1620086400000), "2021-05-04", zone);   // midnight UTC is 3 May in Los Angeles
    }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test("dates before 1970 (the first CalCOFI cruises) are negative epoch ms and still format", () => {
  assert.equal(formatDate(-657676800000), "1949-02-28");
  assert.equal(formatTimestamp(-657680400000), "1949-02-27 23:00:00");
});

test("milliseconds follow only when they are not zero, as DuckDB prints them", () => {
  assert.equal(formatTimestamp(-657673076544), "1949-02-28 01:02:03.456");
  assert.equal(formatTimestamp(1620152278123.4568), "2021-05-04 18:17:58.123");   // TIMESTAMP_NS
  assert.equal(formatTimestamp(1620152278000), "2021-05-04 18:17:58");
});

test("epoch ms as a BigInt or a Date formats the same as a number", () => {
  assert.equal(cellValue(1620152278000n, ARROW_TIMESTAMP), "2021-05-04 18:17:58");
  assert.equal(cellValue(new Date(1620152278000), ARROW_TIMESTAMP), "2021-05-04 18:17:58");
  assert.equal(cellValue(new Date(1620086400000), ARROW_DATE), "2021-05-04");
});

test("a NULL date stays null, and an unrepresentable instant is left as it came", () => {
  assert.equal(cellValue(null, ARROW_TIMESTAMP), null);
  assert.equal(cellValue(undefined, ARROW_DATE), undefined);
  assert.equal(cellValue(Infinity, ARROW_TIMESTAMP), "Infinity");
});

test("every other type is unchanged", () => {
  assert.equal(cellValue(42n, INT), 42);                          // BigInt → Number
  assert.equal(cellValue(1.5, FLOAT), 1.5);
  assert.equal(cellValue("x", UTF8), "x");
  assert.equal(cellValue(3723000000n, TIME), 3723000000);          // TIME is not a date
  assert.equal(cellValue({ toString: () => "POINT (1 2)" }, 13), "POINT (1 2)");
  assert.equal(cellValue(new Date(0), UTF8), "1970-01-01T00:00:00.000Z");
  assert.equal(cellValue(null, INT), null);
});

test("a row that is already a plain object (no toJSON) is read as is", () => {
  const arrow = {
    schema:  { fields: [{ name: "d", type: { typeId: ARROW_DATE } }, { name: "n" }] },
    toArray: () => [{ d: 1620086400000, n: 7 }],
  };
  assert.deepEqual(arrowToRows(arrow), [{ d: "2021-05-04", n: 7 }]);
});
