/* Tests for the membership checker in tools/reconcile.html.
 *
 *     node --test tools/
 *
 * Nothing to install. The harness pulls the logic out of the page so the tool
 * stays one self-contained file. See tools/reconcile-harness.mjs.
 *
 * What is worth testing here is not that the code runs, it is that it does not
 * tell the gym owner to chase somebody who paid.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, sample, check, loadTable, makeMembers, makePayments } from "./reconcile-harness.mjs";

const R = load();
const members = (rows) => makeMembers(R, rows);
const payments = (rows) => makePayments(R, rows);
const score = (memberRow, desc) =>
  R.scorePair(members([memberRow])[0], payments([["03/09/2026", desc, "25.00"]])[0]);

describe("the sample data, end to end", () => {
  /* The numbers the owner gets shown in the demo. If these move, the demo
     script in tools/sample-data/README.txt is wrong. */
  const sept = check(R, sample("members-sample.csv"), sample("statement-sample.csv"), "2026-9");

  test("September gives 6 paid, 1 wrong amount, 1 not seen, 1 unmatched", () => {
    assert.equal(sept.paid.length, 6);
    assert.equal(sept.wrong.length, 1);
    assert.equal(sept.missing.length, 1);
    assert.equal(sept.orphan.length, 1);
  });

  test("Pat Taylor is the wrong amount case, 20.00 against a 22.50 plan", () => {
    const [x] = sept.wrong;
    assert.equal(x.member.name, "Pat Taylor");
    assert.equal(x.member.amount, 22.5);
    assert.equal(x.pay.amount, 20);
    assert.equal(x.diff, -2.5);
  });

  test("Chris Doyle is the one to chase", () => {
    assert.deepEqual(sept.missing.map((x) => x.member.name), ["Chris Doyle"]);
  });

  test("the equipment refund is not treated as a membership", () => {
    const [x] = sept.orphan;
    assert.equal(x.pay.amount, 150);
    assert.match(x.pay.desc, /EQUIPMENT REFUND/);
  });

  test("the electricity bill is dropped, only money in counts", () => {
    const seen = sept.paid.concat(sept.wrong).map((x) => x.pay.desc)
      .concat(sept.orphan.map((x) => x.pay.desc)).join(" ");
    assert.doesNotMatch(seen, /NPOWER/);
  });

  test("August is excluded when September is selected", () => {
    const all = check(R, sample("members-sample.csv"), sample("statement-sample.csv"), "all");
    /* the August row is a second Alex Smith payment, so across all dates it
       shows up as money it cannot place */
    assert.equal(all.orphan.length, 2);
    assert.equal(sept.orphan.length, 1);
  });

  test("columns are detected from the headers without being told", () => {
    const m = loadTable(R, sample("members-sample.csv"), "member");
    assert.deepEqual(m.map, { name: 0, plan: 1, amount: 2, ref: 3 });
    const b = loadTable(R, sample("statement-sample.csv"), "bank");
    assert.deepEqual(b.map, { date: 1, desc: 5, amount: 3 });
  });
});

describe("matching", () => {
  test("an exact payment reference wins outright", () => {
    assert.equal(score(["Alex Smith", "Peak", "25.00", "INF-PEAK-SMITH-5020"], "INF-PEAK-SMITH-5020"), 100);
  });

  test("a reference still matches when the bank mangles the separators", () => {
    const m = ["Bob Hall", "Peak", "25.00", "INF-PEAK-HALL-2024"];
    assert.equal(score(m, "INF/PEAK/HALL/2024"), 100);
    assert.equal(score(m, "STANDING ORDER INF-PEAK-HALL-2024 GYM"), 100);
  });

  test("a plan change does not break an existing standing order", () => {
    /* Danielle moved from Student to Peak. Her standing order still quotes the
       old reference, and identity is surname plus digits, so it still matches. */
    assert.equal(score(["Danielle O'Connor", "Peak", "25.00", "INF-PEAK-OCONNOR-1234"], "INF-STU-OCONNOR-1234"), 90);
  });

  test("forename and surname together beat surname alone", () => {
    const m = ["Priya Patel", "Off-peak", "22.50", ""];
    assert.equal(score(m, "PRIYA PATEL"), 70);
    assert.equal(score(m, "PATEL"), 50);
    assert.ok(score(m, "P PATEL") > score(m, "PATEL"));
  });

  test("a misspelled surname still matches", () => {
    /* The case that sells the tool: the bank says NICHOLSEN, the list says
       Nicholson. One character out is close enough to call. */
    assert.ok(score(["Robert Nicholson", "Peak", "25.00", ""], "NICHOLSEN R") >= R.THRESHOLD);
  });

  test("two characters out is too far to call", () => {
    assert.equal(score(["Robert Nicholson", "Peak", "25.00", ""], "NICHELSEN R"), 0);
  });

  test("bank noise words are not treated as names", () => {
    assert.equal(score(["Standing Order", "Peak", "25.00", ""], "STANDING ORDER BGC CREDIT"), 0);
  });

  test("one payment cannot be claimed by two members", () => {
    /* The demo case. Both Smiths match, only one payment exists. */
    const mem = members([
      ["Alex Smith", "Peak", "25.00", "INF-PEAK-SMITH-5020"],
      ["Sam Smith", "Student", "20.00", ""],
    ]);
    const r = R.reconcile(mem, payments([["03/09/2026", "INF-PEAK-SMITH-5020", "25.00"]]));
    assert.equal(r.paid.length, 1);
    assert.equal(r.paid[0].member.name, "Alex Smith");
    assert.deepEqual(r.missing.map((x) => x.member.name), ["Sam Smith"]);
  });

  test("the higher confidence pairing wins when both are plausible", () => {
    const mem = members([
      ["Alex Smith", "Peak", "25.00", ""],
      ["Sam Smith", "Student", "20.00", ""],
    ]);
    const r = R.reconcile(mem, payments([["03/09/2026", "S SMITH", "20.00"]]));
    assert.equal(r.paid[0].member.name, "Sam Smith");
  });
});

describe("refusing to guess", () => {
  /* Regression tests. All three of these were live defects found while writing
     this file, and each one would have had the owner chase the wrong person. */

  test("a short reference cannot match inside a longer word", () => {
    /* INF123 used to score 100 against WINF1234, crediting a carpet cleaning
       invoice to a member's subscription. */
    assert.equal(score(["Ann Lee", "Peak", "25.00", "INF123"], "WINF1234 CARPET CLEANING LTD"), 0);
  });

  test("a surname that is the tail of a longer word does not match", () => {
    /* HALL2024 used to score 90 inside MARSHALL 2024. */
    assert.equal(score(["Bob Hall", "Peak", "25.00", "INF-PEAK-HALL-2024"], "MARSHALL 2024 CONFERENCE FEE"), 0);
  });

  test("two members matching equally well leaves the payment unmatched", () => {
    const mem = members([
      ["John Smith", "Peak", "25.00", ""],
      ["Jane Smith", "Peak", "25.00", ""],
    ]);
    const r = R.reconcile(mem, payments([["03/09/2026", "SMITH", "25.00"]]));
    assert.equal(r.paid.length, 0);
    assert.deepEqual(r.missing.map((x) => x.member.name).sort(), ["Jane Smith", "John Smith"]);
    assert.equal(r.orphan.length, 1);
    assert.equal(r.orphan[0].ambiguous, true);
    assert.equal(r.orphan[0].guess, null, "must not name one of them");
  });

  test("a tie on a strong match is still called", () => {
    /* Identical names are a duplicate row, not an ambiguity worth surfacing. */
    const mem = members([
      ["John Smith", "Peak", "25.00", ""],
      ["John Smith", "Peak", "25.00", ""],
    ]);
    const r = R.reconcile(mem, payments([["03/09/2026", "JOHN SMITH", "25.00"]]));
    assert.equal(r.paid.length, 1);
    assert.equal(r.missing.length, 1);
  });

  test("the outcome does not depend on member list order", () => {
    const rows = [
      ["Alex Smith", "Peak", "25.00", "INF-PEAK-SMITH-5020"],
      ["Sam Smith", "Student", "20.00", ""],
      ["Priya Patel", "Off-peak", "22.50", ""],
    ];
    const pay = [["03/09/2026", "INF-PEAK-SMITH-5020", "25.00"], ["04/09/2026", "PRIYA PATEL", "22.50"]];
    const a = R.reconcile(members(rows), payments(pay));
    const b = R.reconcile(members(rows.slice().reverse()), payments(pay));
    assert.deepEqual(a.paid.map((x) => x.member.name).sort(), b.paid.map((x) => x.member.name).sort());
    assert.deepEqual(a.missing.map((x) => x.member.name), b.missing.map((x) => x.member.name));
  });
});

describe("amounts", () => {
  const run = (amount) => R.reconcile(
    members([["Pat Taylor", "Off-peak", "22.50", ""]]),
    payments([["03/09/2026", "PAT TAYLOR", amount]]),
  );

  test("the exact plan price is paid, not wrong", () => {
    assert.equal(run("22.50").paid.length, 1);
  });

  test("a penny out is a wrong amount", () => {
    assert.equal(run("22.51").wrong.length, 1);
    assert.equal(run("22.49").wrong.length, 1);
  });

  test("floating point noise is not a wrong amount", () => {
    /* tolerance is 0.005, so a rounding artefact does not become a false alarm */
    assert.equal(run("22.499").paid.length, 1);
  });

  test("money going out is never counted as money in", () => {
    /* The launch plan flags this: on a statement with no balance column, an
       outgoing payment read as incoming would silently satisfy a member. */
    assert.equal(payments([["03/09/2026", "PAT TAYLOR", "-22.50"]]).length, 0);
    assert.equal(payments([["03/09/2026", "PAT TAYLOR", "0.00"]]).length, 0);
  });

  test("parseAmount handles the shapes a UK statement uses", () => {
    assert.equal(R.parseAmount("£25.00"), 25);
    assert.equal(R.parseAmount("1,250.00"), 1250);
    assert.equal(R.parseAmount("(45.20)"), -45.2);
    assert.equal(R.parseAmount("  25.00  "), 25);
    assert.ok(Number.isNaN(R.parseAmount("")));
    assert.ok(Number.isNaN(R.parseAmount("n/a")));
  });
});

describe("dates", () => {
  const d = (v) => {
    const x = R.parseDate(v);
    return x && [x.getFullYear(), x.getMonth() + 1, x.getDate()];
  };

  test("slashed dates are read day first, the UK way", () => {
    /* 03/09 is 3 September. Reading it as 9 March would put a payment in the
       wrong month and make a paying member look like a defaulter. */
    assert.deepEqual(d("03/09/2026"), [2026, 9, 3]);
    assert.deepEqual(d("3/9/26"), [2026, 9, 3]);
    assert.deepEqual(d("03-09-2026"), [2026, 9, 3]);
    assert.deepEqual(d("03.09.2026"), [2026, 9, 3]);
  });

  test("ISO and written months are read too", () => {
    assert.deepEqual(d("2026-09-03"), [2026, 9, 3]);
    assert.deepEqual(d("3 Sep 2026"), [2026, 9, 3]);
    assert.deepEqual(d("3 September 2026"), [2026, 9, 3]);
  });

  test("a day past the twelfth is unambiguous either way", () => {
    assert.deepEqual(d("25/12/2026"), [2026, 12, 25]);
  });

  test("nonsense gives null rather than a wrong date", () => {
    assert.equal(R.parseDate(""), null);
    assert.equal(R.parseDate("Opening balance"), null);
  });

  test("the period filter keeps a month to itself", () => {
    const p = payments([
      ["03/09/2026", "A", "1.00"],
      ["03/08/2026", "B", "1.00"],
      ["03/09/2027", "C", "1.00"],
    ]);
    assert.deepEqual(p.filter((x) => R.inPeriod(x, "2026-9")).map((x) => x.desc), ["A"]);
    assert.equal(p.filter((x) => R.inPeriod(x, "all")).length, 3);
    assert.equal(p.filter((x) => R.inPeriod(x, "")).length, 3);
  });

  test("a row with no readable date is excluded from a month", () => {
    assert.equal(payments([["", "A", "1.00"]]).filter((x) => R.inPeriod(x, "2026-9")).length, 0);
  });
});

describe("reading a CSV", () => {
  test("quoted fields, embedded commas and escaped quotes", () => {
    const rows = R.parseCSV('a,"b,c","say ""hi"""\n1,2,3\n');
    assert.deepEqual(rows, [["a", "b,c", 'say "hi"'], ["1", "2", "3"]]);
  });

  test("a byte order mark does not end up in the first header", () => {
    const t = R.tableFrom(R.parseCSV("﻿Name,Plan\nAlex,Peak\n"));
    assert.equal(t.header[0], "Name");
  });

  test("CRLF line endings", () => {
    assert.deepEqual(R.parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  });

  test("blank lines are dropped", () => {
    assert.deepEqual(R.parseCSV("a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
  });

  test("bank preamble above the header is skipped", () => {
    /* Exports often carry a few account summary lines first. The real table is
       whichever row shape is most common. */
    const t = R.tableFrom(R.parseCSV([
      "Your account statement",
      "Account: 12345678",
      "",
      "Date,Memo,Amount",
      "03/09/2026,PRIYA PATEL,22.50",
      "04/09/2026,JO BROWN,20.00",
    ].join("\n")));
    assert.deepEqual(t.header, ["Date", "Memo", "Amount"]);
    assert.equal(t.body.length, 2);
  });

  test("an empty file does not throw", () => {
    assert.equal(R.tableFrom(R.parseCSV("")), null);
  });
});

describe("the pasted statement route", () => {
  /* The fallback for an owner who cannot export a CSV. It must agree with the
     CSV route or the demo contradicts itself. */
  const text = readFileSync(sample("statement-pasted-sample.txt"), "utf8");

  test("every transaction in the pasted sample is read", () => {
    const parsed = R.parsePasted(text, "auto");
    assert.equal(parsed.skipped, 0, "a dropped row would be a silent miss");
    assert.ok(parsed.rows.length >= 9, "got " + parsed.rows.length + " rows");
  });

  test("it reaches the same answer as the CSV", () => {
    const parsed = R.parsePasted(text, "auto");
    R.S.bank = {
      header: ["Date", "Description", "Amount"],
      body: parsed.rows.map((r) => [r.date ? R.ukDate(r.date) : "", r.desc, r.signed.toFixed(2)]),
    };
    R.S.mapB = { date: 0, desc: 1, amount: 2 };
    const m = loadTable(R, sample("members-sample.csv"), "member");
    R.S.members = m.table;
    R.S.mapM = m.map;
    const pays = R.readPayments().filter((p) => R.inPeriod(p, "2026-9"));
    const r = R.reconcile(R.readMembers(), pays);
    assert.deepEqual(
      { paid: r.paid.length, wrong: r.wrong.length, missing: r.missing.length, orphan: r.orphan.length },
      { paid: 6, wrong: 1, missing: 1, orphan: 1 },
    );
  });

  test("an amount on a wrapped continuation line still lands on its row", () => {
    const parsed = R.parsePasted("03 Sep 2026 STANDING ORDER PRIYA\nPATEL GYM 22.50 1,000.00\n", "auto");
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].amount, 22.5);
    assert.match(parsed.rows[0].desc, /PRIYA PATEL/);
  });
});
