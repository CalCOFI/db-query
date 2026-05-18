// app.js — runtime for CalCOFI Query.
//
// The page DOM (nav + every per-query <section>) is pre-rendered by Jekyll
// from _queries/*.md. This module just wires it up:
//   1. hash router         (#category--name) → show the right section
//   2. theme toggle         (light / dark, persists in localStorage)
//   3. form ↔ args          (DOM → JS object)
//   4. SQL build            (inline Handlebars template OR a lib/match.js
//                            sql_builder function named in frontmatter)
//   5. DuckDB run + render  (sortable paginated table, downloads, metadata)
//
// No YAML parser. No Markdown parser. No manifest fetch. Jekyll does all
// that at build time; the browser receives static HTML.

import { getConn } from "./lib/duckdb.js";
import * as match  from "./lib/match.js";
import { populate as populateOptions } from "./lib/options-sources.js";

// Handlebars: only used to interpolate inline SQL templates from query
// frontmatter. The four registered helpers cover every SQL pattern in v1.
const Handlebars = (await import(
  "https://cdn.jsdelivr.net/npm/handlebars@4.7.8/+esm")).default;

Handlebars.registerHelper("sqlesc", (v) => {
  if (v == null) return "";
  return String(v).replace(/'/g, "''");
});
Handlebars.registerHelper("sqlList", (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
});

// ─── tiny DOM helpers ───────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ─── status pill ────────────────────────────────────────────────────────
const statusEl = $("#status");
function setStatus(html, kind = "") {
  statusEl.className = kind;
  statusEl.innerHTML = html;
}

// ─── form ↔ args ────────────────────────────────────────────────────────
function readForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox")    o[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
    else if (el.type === "number") o[el.name] = el.value === "" ? null : Number(el.value);
    else                            o[el.name] = el.value === "" ? null : el.value;
  }
  return o;
}

// ─── hash router ────────────────────────────────────────────────────────
const allSections = $$("[data-query-id]");
const navLinks    = $$("aside#nav a[data-query]");

function showQuery(hash) {
  if (!hash) hash = "_intro";
  let found = false;
  for (const s of allSections) {
    const match = s.dataset.queryId === hash;
    s.hidden = !match;
    if (match) found = true;
  }
  // if the hash doesn't match anything, fall back to intro
  if (!found) {
    for (const s of allSections) s.hidden = s.dataset.queryId !== "_intro";
    hash = "_intro";
  }
  for (const a of navLinks) a.classList.toggle("active", a.dataset.query === hash);

  // hide the result panel when switching queries
  $("#result").hidden = true;

  // open the parent <details> if the active link is inside a collapsed group
  const active = navLinks.find((a) => a.dataset.query === hash);
  if (active) {
    const details = active.closest("details");
    if (details) details.open = true;
  }

  // sync URL hash (replaceState avoids polluting history)
  if (location.hash.slice(1) !== hash) {
    history.replaceState(null, "", hash === "_intro" ? "#" : `#${hash}`);
  }
}

addEventListener("hashchange", () => showQuery(location.hash.slice(1)));
$("aside#nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-query]");
  if (!a) return;
  e.preventDefault();
  showQuery(a.dataset.query);
});

// ─── theme toggle ───────────────────────────────────────────────────────
$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});

// ─── populate <select> options from dynamic sources ─────────────────────
// (Runs once per (source, version); cached. Triggered on first focus of a
// section's form so we don't fire 4+ GCS queries on initial page load.)
const _populated = new WeakSet();
async function ensureOptionsPopulated(section) {
  if (_populated.has(section)) return;
  _populated.add(section);
  const versionInput = section.querySelector('input[name="version"]');
  const version = (versionInput && versionInput.value) || "v2026.05.14";
  for (const sel of section.querySelectorAll("select[data-options-from]")) {
    try {
      await populateOptions(sel, sel.dataset.optionsFrom, version);
    } catch (e) {
      console.warn(`options_from "${sel.dataset.optionsFrom}" failed:`, e);
      // leave the placeholder option in place
    }
  }
}
allSections.forEach((s) => s.addEventListener("focusin", () => ensureOptionsPopulated(s)));

// ─── Arrow table → JS rows (BigInt-safe, Date-stringified) ─────────────
function arrowToRows(arrow) {
  const fields = arrow.schema.fields.map((f) => f.name);
  return arrow.toArray().map((row) => {
    const r = row.toJSON ? row.toJSON() : row;
    const o = {};
    for (const f of fields) {
      let v = r[f];
      if (typeof v === "bigint")     v = Number(v);
      else if (v instanceof Date)    v = v.toISOString();
      else if (v && typeof v === "object" && v.toString) v = v.toString();
      o[f] = v;
    }
    return o;
  });
}

// ─── result table (paginated, sortable) ────────────────────────────────
const PAGE_SIZE = 100;
const state = { rows: [], cols: [], sortCol: null, sortDir: 1, page: 0, sql: "", meta: null };

function renderTable() {
  const wrap = $("#table-wrap");
  if (!state.rows.length) {
    wrap.innerHTML = `<p style="padding:1rem;color:var(--muted)">No rows.</p>`;
    $("#pagination").innerHTML = "";
    return;
  }
  const sorted = state.sortCol == null ? state.rows : [...state.rows].sort((a, b) => {
    const av = a[state.sortCol], bv = b[state.sortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * state.sortDir;
    if (av > bv) return  1 * state.sortDir;
    return 0;
  });
  const start = state.page * PAGE_SIZE;
  const page  = sorted.slice(start, start + PAGE_SIZE);
  const isNum = (c) => page.every((r) => r[c] == null || typeof r[c] === "number");

  wrap.innerHTML = [
    "<table class='results'><thead><tr>",
    state.cols.map((c) => {
      const arrow = state.sortCol === c ? (state.sortDir > 0 ? " ▲" : " ▼") : "";
      return `<th data-col="${escAttr(c)}" class="${isNum(c) ? "num" : ""}">${esc(c)}${arrow}</th>`;
    }).join(""),
    "</tr></thead><tbody>",
    page.map((r) => "<tr>" + state.cols.map((c) => {
      const v = r[c];
      const cls = typeof v === "number" ? "num" : "";
      const shown = v == null ? "" :
        typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) :
        String(v);
      return `<td class="${cls}">${esc(shown)}</td>`;
    }).join("") + "</tr>").join(""),
    "</tbody></table>"
  ].join("");

  const total = sorted.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  $("#pagination").innerHTML = pages <= 1 ? "" : `
    <button id="pg-prev" ${state.page === 0 ? "disabled" : ""}>← prev</button>
    <span>page ${state.page + 1} of ${pages} (rows ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total})</span>
    <button id="pg-next" ${state.page >= pages - 1 ? "disabled" : ""}>next →</button>`;
}
function esc(s)     { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function escAttr(s) { return esc(s); }

$("#table-wrap").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-col]");
  if (!th) return;
  const col = th.dataset.col;
  if (state.sortCol === col) state.sortDir *= -1;
  else { state.sortCol = col; state.sortDir = 1; }
  state.page = 0;
  renderTable();
});
$("#pagination").addEventListener("click", (e) => {
  if (e.target.id === "pg-prev" && state.page > 0)  { state.page--; renderTable(); }
  if (e.target.id === "pg-next")                    { state.page++; renderTable(); }
});

// ─── sub-tabs (Results / SQL / Metadata) ────────────────────────────────
$("#subtabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-subtab]");
  if (!btn) return;
  const sub = btn.dataset.subtab;
  for (const b of $$("#subtabs button")) b.setAttribute("aria-selected", b === btn);
  $("#panel-results").hidden = sub !== "results";
  $("#panel-sql").hidden     = sub !== "sql";
  $("#panel-meta").hidden    = sub !== "meta";
});

// ─── CSV / SQL downloads ────────────────────────────────────────────────
function rowsToCSV(cols, rows) {
  const esc = (v) => v == null ? "" :
    /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return cols.join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n") + "\n";
}
function download(name, mime, body) {
  const blob = new Blob([body], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
const SQL_HEADER = "-- Re-run in DuckDB (CLI, Python or R) against public CalCOFI Parquet.\n" +
                   "-- See https://calcofi.io/docs/data-access.html#reproducibility.\n" +
                   "INSTALL httpfs; LOAD httpfs;\nINSTALL spatial; LOAD spatial;\n\n";

$("#dl-csv").addEventListener("click",  () =>
  download(`calcofi_query_${Date.now()}.csv`, "text/csv", rowsToCSV(state.cols, state.rows)));
$("#dl-sql").addEventListener("click",  () =>
  download(`calcofi_query_${Date.now()}.sql`, "text/plain", SQL_HEADER + state.sql + "\n"));
$("#copy-sql").addEventListener("click", async () => {
  await navigator.clipboard.writeText(SQL_HEADER + state.sql + "\n");
  const btn = $("#copy-sql"), prev = btn.textContent;
  btn.textContent = "✓ copied"; setTimeout(() => { btn.textContent = prev; }, 1200);
});

// ─── Run handler ────────────────────────────────────────────────────────
async function runQuery(section, form) {
  const args = readForm(form);
  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  // Build SQL — two paths:
  //   (a) section has a `data-sql-builder` → delegate to lib/match.js
  //   (b) inline <template class="sql-template"> → compile with Handlebars
  let sql, queryMeta;
  try {
    if (section.dataset.sqlBuilder) {
      const fn = match[section.dataset.sqlBuilder];
      if (!fn) throw new Error(`Unknown sql_builder "${section.dataset.sqlBuilder}"`);
      ({ sql, queryMeta } = fn(args));
    } else {
      const tpl = section.querySelector("template.sql-template");
      if (!tpl) throw new Error("Query has no inline SQL template and no sql_builder");
      // noEscape — the template's output is SQL, not HTML; disable Handlebars'
      // default `< > & " '` → entity conversion so dates / quotes pass through.
      sql = Handlebars.compile(tpl.innerHTML, { noEscape: true })(args);
      queryMeta = {
        match_js_version: match.VERSION || "n/a",
        release_version:  args.version || null,
        params:           args,
        source_urls:      match.extractSourceUrls
                           ? match.extractSourceUrls(sql)
                           : Array.from(new Set(
                              (sql.match(/read_parquet\('[^']+'/g) || [])
                                .map((s) => s.replace(/^read_parquet\('|'$/g, ""))
                             )).sort(),
        generated_at:     new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
      };
    }
  } catch (err) {
    setStatus(`✗ SQL build failed: ${esc(err.message)}`, "error");
    submitBtn.disabled = false;
    return;
  }

  // Run
  let conn;
  try {
    setStatus("Initializing DuckDB-WASM…", "busy");
    conn = await getConn();
  } catch (err) {
    setStatus(`✗ DuckDB-WASM init failed: ${esc(err.message)}`, "error");
    submitBtn.disabled = false;
    return;
  }

  const t0 = performance.now();
  const firstUrl = queryMeta.source_urls?.[0];
  setStatus(`Running query${firstUrl ? ` against <code>${esc(firstUrl.split("/").slice(0,7).join("/"))}/…</code>` : "…"}`, "busy");
  try {
    const arrow = await conn.query(sql);
    const rows  = arrowToRows(arrow);
    const cols  = arrow.schema.fields.map((f) => f.name);
    const sec   = ((performance.now() - t0) / 1000).toFixed(1);

    state.rows = rows; state.cols = cols; state.page = 0;
    state.sortCol = null; state.sortDir = 1;
    state.sql = sql; state.meta = { ...queryMeta, n_rows: rows.length };

    $("#result").hidden = false;
    $("#row-count").innerHTML = `<strong>${rows.length}</strong> row${rows.length === 1 ? "" : "s"} · ${cols.length} cols · ${sec}s`;
    $("#sql-text").textContent  = sql;
    $("#meta-text").textContent = JSON.stringify(state.meta, null, 2);
    renderTable();
    setStatus(`✓ Done: ${rows.length} row${rows.length === 1 ? "" : "s"} in ${sec}s`, "success");
  } catch (err) {
    setStatus(`✗ Query failed: ${esc(err.message)}`, "error");
    // surface the SQL so the user can see what failed
    state.sql = sql; state.meta = queryMeta;
    $("#result").hidden = false;
    $("#sql-text").textContent  = sql;
    $("#meta-text").textContent = JSON.stringify(queryMeta, null, 2);
    for (const b of $$("#subtabs button")) b.setAttribute("aria-selected", b.dataset.subtab === "sql");
    $("#panel-results").hidden = true; $("#panel-sql").hidden = false; $("#panel-meta").hidden = true;
  } finally {
    submitBtn.disabled = false;
  }
}

// Wire every query <form> to runQuery
for (const section of allSections) {
  const form = section.querySelector("form.query-form");
  if (!form) continue;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runQuery(section, form);
  });
}

// ─── boot ───────────────────────────────────────────────────────────────
showQuery(location.hash.slice(1));
