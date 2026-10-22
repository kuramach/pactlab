# Demo data generator

Builds the public synthetic data set published at
[kuramach/pactlab-demo-data](https://github.com/kuramach/pactlab-demo-data):
every pack (software baseline + the eleven §19 packs) in USD, EUR and GBP,
laid out as `<pack>/<CURRENCY>/files`.

```bash
./scripts/demo-data/build.sh /tmp/demo-out     # CSVs, Markdown, READMEs, then PDFs
```

- `generate.py` — one spec per pack (`PACKS` at the bottom). Deterministic:
  the random generator is seeded by `pack:currency`, so a rerun reproduces the
  published files byte for byte. Money uses `Decimal`, never floats.
- Each pack function also writes the planted findings into that folder's
  README, with figures computed from the generated data — change the data and
  the README follows.
- `build.sh` — runs the generator, then the FreshCo kit builder for PDFs.

To publish: copy the output over a clone of `pactlab-demo-data`, review the
diff, and open a PR there. Everything must stay fictional: invented names,
customers marked "(synthetic)", people only as roles, units or pseudonymous
references, no emails or credentials. Data is CC0 in that repo.
