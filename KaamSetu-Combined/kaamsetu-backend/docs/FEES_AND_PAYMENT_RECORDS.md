# Fees, wages and payment records

## Current implementation

The application records job wage terms and payment **reports**. A contractor can report a payment; the worker can acknowledge or dispute it; corrections preserve the prior record. The API distinguishes report/acknowledgement/dispute states and limits access to relevant participants/admins. A report or acknowledgement is not a bank statement and the app does not transfer, hold, refund or escrow money.

The database stores current wage/payment amounts as integer rupees (not floating point). The current schema does not implement a full advance/deduction ledger, platform fee ledger, completed-shift billing, subscription engine, payment-provider reconciliation or travel compensation policy.

## Required controls for any future fee engine

- Begin with a free pilot and validate contractor willingness to pay.
- Never charge workers merely to access work; never secretly deduct a platform fee from worker wages.
- Display payer, amount, rule and timing before confirmation. Keep platform fees separate from wages.
- Use an immutable fee-rule snapshot and an auditable ledger; enforce idempotency and database constraints against duplicate fee creation.
- Under the proposed completed-worker-shift model, do not charge for unsuccessful applications or uncompleted jobs. Treat ₹10/shift only as a test assumption, not a validated price.
- Define cancellation, dispute, refund and incomplete-job treatment before enabling fees.
- Do not enable automatic collection until legal review and a real authorized provider integration are complete.

## Required wage/advance accounting model

Track gross agreed wage, each approved advance, each documented deduction and its reason/approval, net due, each payment report and evidence, worker acknowledgement, disputed amount and outstanding balance. Preserve historical agreement versions and correction events. Keep disputed information visibly disputed rather than silently overwriting it.

## Financial model assumptions

For a future calculator, label all inputs as assumptions: paying contractors × completed worker-shifts × fee per shift = gross fee revenue; subtract variable costs for contribution; subtract fixed costs for estimated operating result. Do not present simulated output as actual revenue or proof of market demand.
