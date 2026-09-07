# data/

Collected samples land here. Everything in `data/raw/` is written by the
scripts in `scripts/collect/` and is **append only** — never rewrite history, so
that published figures cannot silently change. Filter a bad run at analysis
time instead.

The directory is gitignored apart from this file; the collection workflow
commits `data/raw/` itself.

**The documentation lives in [`docs/DATA.md`](../docs/DATA.md)** — what each
dataset is worth, the schemas, the pipeline, and the rules about what may be
presented as a finding.
