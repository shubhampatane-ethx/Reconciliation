# Feature Spec: Schema-Agnostic AR Reconciliation + Dynamic Data-Type UI

## Context

We already have a working Master Data UI. We now need to add a **Transactional Data Reconciliation** feature that:

1. Accepts two uploaded files (Source + Target) representing the same business data from two different systems, where **column names, order, and count are not guaranteed to match** between the two files, and may drift over time as either system's export template changes.
2. Automatically detects whether an uploaded file is **Master Data** (customers, vendors, chart of accounts, GL segments — reference/dimension data) or **Transactional Data** (invoices, credit memos, payments — fact/event data with dates and amounts), and routes the file to the correct existing UI (Master Data UI vs the new Transactional Reconciliation UI) without the user having to say which is which.
3. Reconciles the two transactional files and presents the results in a dashboard, with full transparency into how columns were mapped and how records were matched, so a finance user can trust and audit the output.

A working Python reference implementation of the column-mapping and reconciliation logic already exists and should be used as the algorithmic basis — port/adapt it, don't redesign the approach from scratch. It is attached separately as `column_mapper.py` and `reconcile_v2.py`. Treat this spec as the source of truth for behavior; treat the attached scripts as the reference implementation of that behavior.

---

## Feature 1 — Dynamic Column Mapper (schema-agnostic ingestion)

### Problem
Hardcoding `source_column -> target_column` renames breaks the moment either system renames, reorders, or adds/removes a column. We need mapping logic that resolves arbitrary headers onto a fixed set of **canonical fields**, without code changes when a new naming convention shows up.

### Canonical fields (extend as needed per data domain)
`TxnNumber, TxnType, TxnDate, Amount, Customer, PONumber, DueDate, Salesperson, Currency, Status`

### Required logic
1. **Header normalization**: lowercase, strip all non-alphanumeric characters, before any comparison.
2. **Header-row auto-detection**: scan the first ~5 rows of the file; score each row by how many cells match a known synonym; select the best-scoring row as the real header. This must handle:
   - Files with a title/banner row above the real header.
   - Files with **two stacked header rows** (a business-friendly label row followed by a system-internal label row) — detect and drop the redundant one from the data.
3. **Three-tier field resolution, in this priority order**:
   - **Tier 1 — exact synonym match**: normalized header exactly equals a known synonym for a canonical field.
   - **Tier 2 — fuzzy match**: string-similarity match (e.g. `difflib.SequenceMatcher` or equivalent) against all synonyms of all unmapped canonical fields. For synonyms of 6+ characters, also credit clean substring containment (so a compound header like `"Customer Name (Only Bill to/No Ship To)"` still resolves correctly instead of losing to an unrelated shorter column). Accept only above a configurable confidence cutoff (default 0.72).
   - **Tier 3 — manual override**: a user- or admin-supplied `{canonical_field: actual_column_name}` mapping always wins over tiers 1–2, and must be settable per source system, persisted, and reusable on the next file from the same system (see UI section).
4. **A column already claimed by one canonical field cannot be claimed by another** in the same pass (first-match-wins, no double-mapping).
5. **Unresolved fields are surfaced, never guessed silently.** If no synonym/fuzzy match clears the confidence cutoff, the field is reported as `NOT_FOUND` with confidence 0, and the UI must ask the user to map it manually before reconciliation proceeds (or must proceed with that field treated as absent, if the user explicitly confirms that).
6. **Every resolution decision is logged**: field, matched column, method (`exact_synonym` / `fuzzy_match` / `manual_override` / `NOT_FOUND`), confidence score. This log must be viewable by the user (see UI) and stored with the reconciliation run for audit.
7. **Value normalization after mapping**:
   - `Amount`: strip currency symbols/commas/whitespace; treat `(1,234.56)` as `-1234.56`; non-parseable values become null and are routed to the exceptions report, not to a crash.
   - `TxnDate` / `DueDate`: parse via a tolerant date parser (mixed formats within the same column must not throw); unparseable values become null and route to exceptions.
8. **Synonym dictionary must be externally configurable** (JSON/DB-backed, not hardcoded in application logic) so new source/target systems can be onboarded by adding synonyms, not by shipping code.

### Acceptance criteria
- Given two files with completely different, non-overlapping header vocabularies (e.g. `Doc#, Doc Type, Posting Date, Bill Amount, Client Name...` vs the current Source/Target headers), the mapper correctly resolves all canonical fields present in both, and clearly flags any that aren't.
- Re-running the mapper on the current two production files (Source/QuickBooks-style, Target/Oracle-style) reproduces 100% of the mappings a developer would do by hand.
- No canonical field is ever silently mapped to the wrong column without appearing in the confidence log.

---

## Feature 2 — Automatic Master Data vs Transactional Data detection (drives dynamic UI)

### Problem
Today the user has to know which UI to use. We want the system to look at an uploaded file and route it automatically: Master Data → existing Master Data UI; Transactional Data → new Reconciliation UI.

### Detection heuristics (combine into a weighted score, don't rely on a single signal)
- **Presence of a date column that behaves like a transaction date** (parses as a date, has a wide/continuous range across rows) → weights toward Transactional.
- **Presence of a monetary amount column with per-row variation** (not a constant/reference value) → weights toward Transactional.
- **Key-column cardinality**: in Master Data, the natural key (e.g. Customer ID, Account Number) is expected to be close to unique per row and stable; in Transactional Data, a business entity (e.g. Customer) repeats across many rows while the transaction key (invoice number) is the near-unique one.
- **Header vocabulary match**: score the header set against the canonical Transactional synonym dictionary (Feature 1) vs a separate Master Data synonym dictionary (e.g. `CustomerID, AccountName, TaxID, BillingAddress, CustomerType, CreditLimit`). Whichever dictionary the headers match better wins.
- **Row-count/shape heuristics**: Master Data files are typically flatter reference lists without recurring due dates/aging; Transactional files typically include due dates, aging, or payment terms.
- Combine signals into a confidence score; if the score doesn't clearly favor one type, **ask the user to confirm** rather than guessing — never silently misroute a file.

### UI behavior
- On file upload, run detection immediately (before any manual step) and show the user which type was detected and why (short explanation: "Detected as Transactional — found `Invoice Amount`, `Due Date`, and a low-cardinality customer key").
- If confidence is high → route directly into the appropriate UI (Master Data UI unchanged; new Reconciliation UI for Transactional).
- If confidence is ambiguous → present both options with the detected signals shown, let the user pick, and record that choice to improve future detection for that file naming pattern.
- The routing decision and its confidence/reasoning must be stored with the upload for audit, same as the column mapping log.

### Acceptance criteria
- Uploading the current Source and Target AR files, both are auto-detected as Transactional with high confidence, and routed to the Reconciliation UI without user intervention.
- Uploading an existing Master Data file (customer list, chart of accounts, etc.) is auto-detected as Master Data and routed to the existing Master Data UI, unchanged.
- An intentionally ambiguous file (e.g. a small reference table that also has one date column) triggers the manual-confirmation path instead of a silent misroute.

---

## Feature 3 — Reconciliation UI (new, sits behind Transactional routing)

### Screens required
1. **Upload / Mapping Review screen**
   - Shows the auto-generated column mapping for both files side by side (canonical field | matched column | method | confidence).
   - Any `NOT_FOUND` field is highlighted and blocks proceeding until the user either supplies a manual mapping or explicitly confirms "treat as absent."
   - Any fuzzy match below, say, 0.85 confidence is visually flagged (not blocking) so the user can eyeball it before running the reconciliation.
   - "Run Reconciliation" button only enabled once all required fields are resolved or explicitly acknowledged.

2. **Results Dashboard**
   - **Summary panel**: record counts and totals for Source, Target, Matched, Amount-Mismatched, Only-in-Source, Only-in-Target, plus the net dollar difference, prominently displayed.
   - **Matched / Balanced tab** — transactions that tie out within tolerance.
   - **Amount Mismatch tab** — same key, different amount, with a Diff column, sortable/filterable.
   - **Only in Source / Only in Target tabs** — one-sided records, with customer/date/amount columns for triage.
   - **Duplicate Keys tab** — same transaction key appearing more than once within one file.
   - **Data Exceptions tab** — rows dropped from reconciliation due to blank IDs, footer/subtotal rows, non-numeric amounts, or unparseable dates, so nothing silently disappears from view.
   - **Column Mapping tab** — the full mapping log from Feature 1, for audit.
   - Export-to-Excel of the whole dashboard (mirroring the tab structure) for offline sharing.

3. **Manual override management** (admin-facing, reusable across runs)
   - A place to save a named mapping profile per source system (e.g. "QuickBooks Export v1", "Oracle AR Export") so recurring monthly files don't need re-mapping from scratch — the saved profile is tried first, falling back to auto-detection for any field it doesn't cover.

### Non-functional requirements
- Tolerance for "matched" amounts must be configurable (default $0.01), not hardcoded.
- The reconciliation key defaults to `(TxnNumber, TxnType)` exact match, with a secondary fallback pass that strips a trailing `-N` suffix (invoices split across multiple GL lines can appear as `123456` in one system and `123456-1` in the other) and re-checks amount equality before accepting that as a match — surface these as a distinct "Tier 2 match" category in the results, not silently merged into Tier 1.
- All thresholds (fuzzy cutoff, amount tolerance, confidence bands for data-type detection) must be configuration values, not hardcoded constants, so they can be tuned without a code change.
- Every reconciliation run (mapping decisions, detection decisions, match results) must be persisted and retrievable for audit — this is a finance control process.

### Out of scope for this feature (do not build)
- Automatic write-back/posting of adjustments into either source system.
- Changes to the existing Master Data UI's own logic — it should only receive the new upstream routing signal, not be redesigned.
