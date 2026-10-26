# Data pipeline

Builds a `modelset.v1` JSON from a CSV. Runs offline on a CPU in a couple of minutes. The app never needs this; it only produces replacement JSON files.

```sh
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt                  # numpy, pandas, scikit-learn ≥ 1.8, ucimlrepo
```

| Script | What it does |
| --- | --- |
| `fetch_support2.py` | Downloads SUPPORT2 (UCI id 880) to `out/support2.csv`. |
| `make_synthetic.py` | Writes `out/synthetic.csv`, data with a known ground truth (self-test and fallback input). |
| `build_modelset.py` | CSV → model set JSON (see below). Validates its output before writing. |
| `validate.py` | Validates any modelset file, including app exports: `python validate.py file.json`. |
| `check_validate_parity.py` | Checks that `validate.py` accepts and rejects the same files as the app's validator. |
| `check_synthetic.py` | Checks that a model set built from `synthetic.csv` recovers the U-shaped sodium curve and the non-decreasing age curve. |

## How `build_modelset.py` works

1. **Clean.** Uses `--features` (required for SUPPORT2, whose outcome and cost columns would leak the target), or all numeric non-target columns. Columns in `--recode-json` are mapped to 0/1. A column whose values are exactly {0, 1} is binary; any other two-valued or text column stops the script until it gets a recode mapping. Missing values: binary → 0, continuous → median, or the value given in `--impute-json`. Constant columns are dropped.
2. **Bin.** Binary → threshold 0.5. Continuous → the unique 10%…90% quantiles above the column minimum, or `--bins-json`. Bin k holds `t[k-1] ≤ x < t[k]`, the same rule as the app.
3. **Split.** A stratified 80/20 split. Every model is fit and admitted on the 80%; the 20% is used only for the held-out AUC shown in the app.
4. **Baseline.** L1 logistic regression on step indicators `1[x ≥ t]`, with C chosen by 5-fold cross-validated log-loss. Its training log-loss is `L0`.
5. **Candidates.** 300 bootstrap refits (C drawn log-uniform in [0.1, 10] × the baseline C) and 2,000 perturbations of the jump coefficients. A candidate is admitted if its training log-loss is ≤ `L0 · (1 + ε)`.
6. **Select.** Deduplicate, then farthest-point sampling (from the baseline) picks `--n-models` diverse models.
7. **Write.** Per-bin weights are centered per feature, and the estimator's predictions are checked against the per-bin form to 1e-9. `--n-rows` instances are sampled, stratified by target.

`--seed` controls every random step.

## Synthetic self-test

```sh
python make_synthetic.py
python build_modelset.py --csv out/synthetic.csv --target died --out out/synthetic.json
python check_synthetic.py out/synthetic.json
```

## SUPPORT2 notes

- Features: `age, temp, hrt, resp, meanbp, wblc, sod, crea, bili, bun, alb, pafi, scoma, glucose, urine, ph, num.co, dementia, diabetes, ca`.
- `support2_recode.json` turns `ca` (no / yes / metastatic) into a metastatic-cancer flag.
- `support2_impute.json` holds the "normal fill-in values" from the SUPPORT description (hbiostat.org/data/repo/supportdesc): alb 3.5, pafi 333.3, bili 1.01, crea 1.01, bun 6.51, wblc 9, urine 2502. glucose and ph have no listed value and use the median. These constants appear as spikes in the histograms; that is expected.
