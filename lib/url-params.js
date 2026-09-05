// lib/url-params.js — open a query from a link.
//
// The app is a hash router: `#category--name` picks the section (app.js's showQuery). Until now
// that was the ONLY thing it read from the URL, so a link could choose a query but never fill it
// in — and the calcofi.io dataset pages want to hand someone the SQL shell with this dataset's
// SQL already in the box (UI plan D-6, Decision 20).
//
// So: on load, the query string names the FIELDS. `?sql=…#sql-shell--shell` opens the shell with
// that SQL; `?env_var=temperature&date_min=2018-01-01#datasets--bottle` opens the bottle query
// with those two fields set. `?sql=` alone implies the shell, because that is the only section
// that has one.
//
// Two rules this keeps:
//   · values are read from the URL, NEVER written back to it. app.js's `replaceState` syncs the
//     hash only, and a fragment-only relative URL leaves the query string alone, so a link stays
//     what the sender sent.
//   · GA still sees parameter NAMES only (app.js's paramsChangedFromDefaults) — a prefilled
//     `sql` value is far past GA4's 100-character cap and is nobody's business anyway.
//
// Pure: no DOM, so `node --test` can pin the rules.

// a `sql` parameter with no hash means the shell — it is the only section with a `sql` field
export const SQL_SHELL = "sql-shell--shell";

/**
 * What a URL asks for.
 * @param {string} search  location.search ("?sql=…")
 * @param {string} hash    location.hash ("#sql-shell--shell", with or without the "#")
 * @returns {{id: string, params: Object<string,string>, run: boolean}}
 *   id      the section to show ("" when the URL names none — app.js falls back to _intro)
 *   params  field name → value, in the order the URL gave them; `run` is not among them
 *   run     the URL asked for the query to be run once the release is pinned
 */
export function readUrl(search = "", hash = "") {
  const id = String(hash).replace(/^#/, "");
  const usp = new URLSearchParams(String(search));
  const params = {};
  for (const [k, v] of usp) {
    if (k === "run" || k === "theme" || k === "tour") continue;   // not form fields
    params[k] = v;
  }
  const run = ["1", "true", "yes"].includes((usp.get("run") || "").toLowerCase());
  const target = id || (Object.prototype.hasOwnProperty.call(params, "sql") ? SQL_SHELL : "");
  return { id: target, params, run };
}

/**
 * Set a form's fields from those parameters. Only fields the form actually has are touched, so a
 * stale link cannot invent one; a checkbox takes a truthy string, a select takes a value it
 * offers, everything else takes the string.
 * @returns {string[]} the names actually applied
 */
export function applyParams(form, params) {
  if (!form) return [];
  const applied = [];
  for (const [name, value] of Object.entries(params)) {
    const el = form.elements[name];
    if (!el || typeof el === "undefined") continue;
    if (el.type === "checkbox") {
      el.checked = ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
    } else if (el.tagName === "SELECT") {
      // a value the select does not offer is ignored rather than silently blanking the field
      if (![...el.options].some((o) => o.value === value)) continue;
      el.value = value;
    } else {
      el.value = value;
    }
    applied.push(name);
  }
  return applied;
}
