Sample data for tools/reconcile.html - completely made up, no real members.

Load members-sample.csv as the member list and statement-sample.csv as the
bank statement, pick September 2026, and select Check payments.

What the September figures should show, and why each case is here:

  Paid (6)
    Alex Smith        exact payment reference
    Jo Brown          legacy member, matched on name alone
    Sam Smith         same surname as Alex - proves one payment cannot be
                      claimed by two members
    Danielle O'Connor reference still says INF-STU- from her old plan, and
                      it matches anyway because identity is surname + digits
    Robert Nicholson  the bank says NICHOLSEN R and the list says Nicholson.
                      One character out still matches. Worth pointing at: it
                      is the case nobody would catch reading down a statement
    Priya Patel       straightforward name match

  Wrong amount (1)
    Pat Taylor        paying 20.00 on a 22.50 Off-peak plan. This is the
                      case that is invisible on a bank statement today.

  Not seen (1)
    Chris Doyle       expected 25.00, nothing arrived

  Unmatched payment (1)
    150.00 equipment refund - money in that is not a membership

The -45.20 electricity bill is ignored because only money paid in counts.
The August row is ignored when the period is set to September.

---

There are three sample statements here, one for each way of loading one:

  statement-sample.pdf         the PDF file tab
  statement-sample.csv         the CSV file tab
  statement-pasted-sample.txt  the Paste text tab

All three contain the same transactions, so all three should give you the same
answer: Paid 6, Not seen 1, Wrong amount 1, Unmatched payment 1.
