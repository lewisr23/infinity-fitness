/* Loads the logic out of tools/reconcile.html so it can be tested in Node.
 *
 * The tool has to stay a single self-contained file the owner can be handed,
 * so the logic does not move into a module. Instead the page carries a guarded
 * `module.exports` at the end of its IIFE, inert in a browser, and this file
 * evaluates the page's one <script> block with just enough of a DOM for the
 * wiring at the bottom of the script to run without throwing.
 *
 * It runs through `new Function` rather than `node:vm` deliberately. A vm
 * context is a separate realm, so an array built inside it has a different
 * Array.prototype and every deepStrictEqual against it fails on nothing but
 * prototype identity. Running in this realm keeps the assertions honest.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const DIR = dirname(fileURLToPath(import.meta.url));
export const sample = (name) => join(DIR, "sample-data", name);

/* A node that answers to anything. Every unknown property is a method that
   returns the node again, so chained DOM calls in the page resolve. */
function fakeEl() {
  const store = {
    textContent: "", value: "", innerHTML: "", className: "", id: "",
    hidden: false, disabled: false, checked: false, files: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, children: [], options: [], parentNode: null,
  };
  const node = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "symbol") return undefined;
      return () => node;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return node;
}

const doc = {
  getElementById: fakeEl, createElement: fakeEl, querySelector: fakeEl,
  querySelectorAll: () => [], addEventListener() {},
  body: fakeEl(), documentElement: fakeEl(),
};

export function load() {
  const html = readFileSync(join(DIR, "reconcile.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no <script> block found in reconcile.html");

  const mod = { exports: {} };
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const run = new Function(
    "module", "document", "window", "navigator", "localStorage",
    `${m[1]}
;return module.exports;`,
  );
  const api = run(mod, doc, win, { userAgent: "node" },
    { getItem: () => null, setItem() {}, removeItem() {} });

  if (!api || !Object.keys(api).length) throw new Error("reconcile.html exported nothing");
  return api;
}

/* Read a CSV the way the page does: parse, find the header under any preamble,
   then detect columns with the page's own patterns. */
export function loadTable(R, path, group) {
  const table = R.tableFrom(R.parseCSV(readFileSync(path, "utf8")));
  return { table, map: R.mapFor(table.header, group) };
}

/* Run a full check the way the Check payments button does. */
export function check(R, membersPath, bankPath, period) {
  const m = loadTable(R, membersPath, "member");
  const b = loadTable(R, bankPath, "bank");
  R.S.members = m.table; R.S.mapM = m.map;
  R.S.bank = b.table;    R.S.mapB = b.map;
  const members = R.readMembers();
  const pays = R.readPayments().filter((p) => R.inPeriod(p, period));
  return R.reconcile(members, pays);
}

/* Build member and payment records directly, for the targeted matching tests. */
export function makeMembers(R, rows) {
  R.S.members = { header: ["Name", "Plan", "Monthly amount", "Reference"], body: rows };
  R.S.mapM = { name: 0, plan: 1, amount: 2, ref: 3 };
  return R.readMembers();
}
export function makePayments(R, rows) {
  R.S.bank = { header: ["Date", "Memo", "Amount"], body: rows };
  R.S.mapB = { date: 0, desc: 1, amount: 2 };
  return R.readPayments();
}
