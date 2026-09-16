# Infinity Fitness

Website and membership reconciliation tool for an independent gym and sports
medicine clinic in Ryton, Tyne and Wear.

Static site, no framework, no build step for the page itself, no backend.
Two files do the work: `index.html` is the whole website, `tools/reconcile.html`
is a tool the owner uses to find out who has stopped paying.

## The problem

The gym collects membership fees by standing order and, from experience, will
not accept per-transaction fees. That decision is settled, so Direct Debit,
Stripe and GoCardless are all off the table.

Standing orders are fine at taking money. The gap is on the other side. Two
things cost the business money and neither is visible on a bank statement:

- **Someone cancels their standing order and keeps training.** Nothing tells
  the owner. He would have to read down a statement and remember who should be
  on it.
- **Someone is on an old price.** A member who set up £20 a month years ago is
  still paying £20 after a rise to £25. They have done nothing wrong and there
  is no way to catch it by eye.

What Direct Debit would actually buy here is not collection, it is *knowing who
stopped paying*. That can be solved for nothing.

## The two answers

**Structured payment references.** The Join section of the site generates a
reference such as `INF-PEAK-SMITH-5020`. A member quotes it when setting up the
standing order, and it then appears next to their payment on the statement.
Identity is the surname plus the four digits, so changing plan does not break an
existing standing order.

**A reconciliation tool.** `tools/reconcile.html` takes a member list and a bank
statement, as CSV, as a PDF from the banking app, or pasted as text, and sorts
every member into paid, not seen, wrong amount, or unmatched payment.

## Constraints that shaped it

The previous developer took the money and disappeared, which is why the domain
and hosting are registered to the gym rather than to whoever built this. The
same reasoning rules out anything needing ongoing maintenance: no server, no
database, no accounts, and no bespoke store of member data for a real business
to be left holding. Class booking and member logins already live on a
maintained third-party platform, so the site links to it rather than
reimplementing it.

The reconciler reads the statement **in the browser and never uploads it**. You
can disconnect from the internet once the page has loaded and it still works,
which is the easiest way to demonstrate the claim rather than assert it.

## Things worth reading the code for

- **Fuzzy matching under a confidence threshold.** `scorePair` in
  `tools/reconcile.html` scores a member against a payment: exact reference,
  then surname plus digits, then forename and surname, down to a Levenshtein
  fallback that matches `NICHOLSEN R` to Robert Nicholson.
- **Greedy one-to-one assignment.** Candidate pairs are sorted by confidence and
  each payment is spent once, so two members with the same surname cannot both
  claim it.
- **Refusing to guess.** Where two members match one payment equally well on
  nothing stronger than a surname, nothing is assigned and the payment is
  surfaced for a human. Naming the wrong person to chase is the failure this
  tool exists to prevent, so a visible unknown beats a confident mistake.
- **Boundary-aware reference matching.** Normalising a description to compare it
  throws away word edges, which let a short reference match inside a longer
  word. `normEdges` keeps track of where words started and ended.
- **Client data out of version control.** `index.html` carries blank bank
  details. The real ones live in `payee.local.json`, which is not committed, and
  `tools/build-dist.py` writes them into `dist/` at build time.
- **A build step that refuses to publish the wrong thing.** `build-dist.py`
  assembles `dist/` from an explicit list and exits non-zero if any working
  document ends up in it.

## Running it

Open `index.html` in a browser. There is nothing to install and no server
needed, though a static server avoids the odd `file://` restriction:

```
python -m http.server 8765
```

## Tests

The reconciler's logic is covered by a test suite. No dependencies, Node 18 or
newer:

```
node --test tools/*.test.mjs
```

The tool has to stay a single self-contained file, so the logic is not extracted
into a module. Instead `tools/reconcile-harness.mjs` reads the page, evaluates
its one script block with a stub DOM, and reads back a `module.exports` that the
page only defines when `module` exists. In a browser that hook does nothing.

Three defects were found while writing these tests, each of which would have had
the owner chase a member who had paid. They are the `refusing to guess` block in
`tools/reconcile.test.mjs`.

## Building for deployment

```
python tools/build-dist.py
```

This writes `dist/`, containing only what belongs on a public server. It needs
`payee.local.json` next to `index.html`:

```json
{
  "siteUrl": "https://the-real-domain.co.uk",
  "payee": { "name": "", "sortCode": "00-00-00", "account": "00000000" }
}
```

Any value can be left empty. The Join page shows the rows it has and falls back
to "ask at reception" without a sort code and account number, which is exactly
how joining works at the desk today. To build deliberately without them, pass
`--no-payee`.

`dist/` then uploads to any static host.

## Layout

```
index.html                 the entire website
tools/reconcile.html       the membership checker, self-contained
tools/reconcile.test.mjs   tests for its logic
tools/reconcile-harness.mjs  loads that logic into Node
tools/build-dist.py        assembles dist/, substitutes config
tools/optimise-photos.py   gallery image resizing
tools/sample-data/         made-up members and statements, no real data
tools/vendor/              PDF.js, for reading a statement PDF
```

Client material, meeting notes and the working arrangement are deliberately not
in this repository.
