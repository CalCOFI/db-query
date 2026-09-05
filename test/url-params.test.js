// Unit tests for lib/url-params.js — opening a query from a link.
//
//   npm test
//
// The deep link the calcofi.io dataset pages build is the case that matters: the SQL shell with a
// dataset's SQL already in the box (UI plan D-6, Decision 20). `readUrl` is pure; `applyParams`
// needs only the two things a form element has (`elements`, `type`/`tagName`/`value`), so a tiny
// stand-in is enough and no DOM is required.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readUrl, applyParams, SQL_SHELL } from "../lib/url-params.js";

// the link _plugins/datasets.rb writes on every dataset page that has no saved query
const SQL = "-- calcofi_ctd-cast in the CalCOFI release v2026.09.05\n" +
            "SELECT *\nFROM __TBL:obs__\nWHERE dataset_key = 'calcofi_ctd-cast'\nLIMIT 100;";
const DEEP = "?sql=" + encodeURIComponent(SQL);

test("a ?sql= link opens the SQL shell with the SQL intact", () => {
  const r = readUrl(DEEP, "#sql-shell--shell");
  assert.equal(r.id, SQL_SHELL);
  assert.equal(r.params.sql, SQL);          // newlines and quotes survive the round trip
  assert.equal(r.run, false);
});

test("?sql= with no hash still means the shell — it is the only section with a sql field", () => {
  assert.equal(readUrl(DEEP, "").id, SQL_SHELL);
  assert.equal(readUrl(DEEP, "#").id, SQL_SHELL);
});

test("the hash still wins when it names a section", () => {
  const r = readUrl("?env_var=temperature&date_min=2018-01-01", "#datasets--bottle");
  assert.equal(r.id, "datasets--bottle");
  assert.deepEqual(r.params, { env_var: "temperature", date_min: "2018-01-01" });
});

test("a bare hash carries no params, and a bare URL asks for nothing", () => {
  assert.deepEqual(readUrl("", "#datasets--bottle"), { id: "datasets--bottle", params: {}, run: false });
  assert.deepEqual(readUrl("", ""), { id: "", params: {}, run: false });
});

test("theme, tour and run are not form fields", () => {
  const r = readUrl("?theme=dark&tour=off&run=1&sql=SELECT+1", "");
  assert.deepEqual(Object.keys(r.params), ["sql"]);
  assert.equal(r.run, true);
});

test("?run= is only true for an affirmative value", () => {
  for (const v of ["1", "true", "TRUE", "yes"]) assert.equal(readUrl(`?run=${v}`, "#x").run, true, v);
  for (const v of ["0", "false", "no", ""])     assert.equal(readUrl(`?run=${v}`, "#x").run, false, v);
});

// ── applyParams ───────────────────────────────────────────────────────────
const field = (type, value = "", opts = null) => ({
  type, value, checked: false, tagName: opts ? "SELECT" : "INPUT",
  options: opts ? opts.map((v) => ({ value: v })) : undefined,
});
const formOf = (fields) => ({ elements: fields });

test("only fields the form actually has are set", () => {
  const f = formOf({ sql: field("textarea", "SELECT 1") });
  assert.deepEqual(applyParams(f, { sql: "SELECT 2", nonesuch: "x" }), ["sql"]);
  assert.equal(f.elements.sql.value, "SELECT 2");
});

test("a checkbox takes an affirmative string; a select only a value it offers", () => {
  const f = formOf({
    thin: field("checkbox"),
    env_var: field("select-one", "temperature", ["temperature", "salinity"]),
  });
  applyParams(f, { thin: "1", env_var: "salinity" });
  assert.equal(f.elements.thin.checked, true);
  assert.equal(f.elements.env_var.value, "salinity");

  // a stale link naming an option that no longer exists leaves the default alone rather than
  // blanking the field
  assert.deepEqual(applyParams(f, { env_var: "unobtainium" }), []);
  assert.equal(f.elements.env_var.value, "salinity");
});

test("no form is not an error", () => {
  assert.deepEqual(applyParams(null, { sql: "SELECT 1" }), []);
});
