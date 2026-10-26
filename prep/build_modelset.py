"""Build a modelset.v1 JSON - a set of near-optimal binned additive logistic models - from a CSV.

Implements spec §6.2. One --seed controls every random step. Example (the shipped demo):

  python build_modelset.py --csv out/support2.csv --target hospdead \\
     --features age,temp,hrt,resp,meanbp,wblc,sod,crea,bili,bun,alb,pafi,scoma,glucose,urine,ph,num.co,dementia,diabetes,ca \\
     --out ../app/public/data/demo.json --n-models 150 --n-rows 800 --epsilon 0.05 --seed 0 \\
     --impute-json support2_impute.json --recode-json support2_recode.json

Models are fit on an 80% stratified training split; the remaining 20% is only used for the
held-out AUC shown in the app (models.metrics.auc).
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split

from validate import validate

# Outcome, cost and model-score columns of SUPPORT2: never use them as features (spec §6.5).
SUPPORT2_LEAKY = {
    "death", "d.time", "slos", "hday", "charges", "totcst", "totmcst", "avtisst", "sfdm2", "adlp", "adls",
    "adlsc", "dnr", "dnrday", "aps", "sps", "surv2m", "surv6m", "prg2m", "prg6m",
}
N_BOOTSTRAP = 300
N_PERTURB = 2000
SIGMAS = (0.05, 0.1, 0.2)
S_FLOOR = 0.05
ROUND = 6  # decimals kept for data values, thresholds and weights in the JSON


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


@dataclass
class Feature:
    name: str
    type: str  # 'continuous' | 'binary'
    x: np.ndarray  # full-data values after recode/imputation
    thresholds: list[float] = field(default_factory=list)

    @property
    def n_cols(self) -> int:
        return 1 if self.type == "binary" else len(self.thresholds)

    def bins(self, x: np.ndarray) -> np.ndarray:
        """Bin index = number of thresholds ≤ x (spec §3)."""
        return np.searchsorted(np.asarray(self.thresholds), x, side="right")


# ---------------------------------------------------------------- loading and cleaning


def parse_features(raw: list[str] | None) -> list[str] | None:
    if raw is None:
        return None
    return [f.strip() for part in raw for f in part.split(",") if f.strip()]


def load_and_clean(args) -> tuple[pd.DataFrame, np.ndarray, list[Feature], dict]:
    df = pd.read_csv(args.csv)
    if args.target not in df.columns:
        die(f"target column '{args.target}' not in {args.csv}")
    n_before = len(df)
    df = df[df[args.target].notna()].reset_index(drop=True)
    y = df[args.target].to_numpy()
    if not set(np.unique(y)) <= {0, 1}:
        die(f"target '{args.target}' must be 0/1")
    y = y.astype(int)

    feature_names = parse_features(args.features)
    if feature_names is None:
        leaky = sorted((SUPPORT2_LEAKY & set(df.columns)) - {args.target})
        if leaky:
            die(
                "this CSV contains outcome/cost columns that would leak the target "
                f"({', '.join(leaky[:6])}{', ...' if len(leaky) > 6 else ''}); pass an explicit --features list"
            )
        feature_names = [c for c in df.columns if c != args.target and pd.api.types.is_numeric_dtype(df[c])]
    missing = [f for f in feature_names if f not in df.columns]
    if missing:
        die(f"feature column(s) not in CSV: {', '.join(missing)}")
    if args.target in feature_names:
        die("the target cannot also be a feature")

    recode = json.loads(Path(args.recode_json).read_text()) if args.recode_json else {}
    impute = json.loads(Path(args.impute_json).read_text()) if args.impute_json else {}
    for col in list(recode) + list(impute):
        if col not in feature_names:
            print(f"warning: '{col}' in a JSON override is not a feature; ignored")

    meta: dict = {"imputed": {}, "n_missing": {}, "dropped_constant": [], "recoded": {}}
    features: list[Feature] = []
    for name in feature_names:
        col = df[name]
        if name in recode:
            mapping = {str(k): v for k, v in recode[name].items()}

            def key(v):
                return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)

            unmapped = sorted({key(v) for v in col.dropna()} - set(mapping))
            if unmapped:
                die(f"--recode-json for '{name}' has no mapping for value(s) {unmapped}")
            if not set(mapping.values()) <= {0, 1}:
                die(f"--recode-json for '{name}' must map to 0/1")
            col = col.map(lambda v: np.nan if pd.isna(v) else mapping[key(v)]).astype(float)
            meta["recoded"][name] = recode[name]
            kind = "binary"
        else:
            if not pd.api.types.is_numeric_dtype(col):
                vals = sorted(map(str, col.dropna().unique()))[:5]
                die(f"column '{name}' is not numeric (values like {vals}); give a value->0/1 mapping in --recode-json")
            uniq = set(col.dropna().unique().tolist())
            if uniq <= {0, 1}:
                kind = "binary"
            elif len(uniq) == 2:
                die(
                    f"column '{name}' has two values {sorted(uniq)}, not {{0, 1}}; "
                    "give a value->0/1 mapping in --recode-json"
                )
            else:
                kind = "continuous"
        col = col.astype(float)
        n_missing = int(col.isna().sum())
        if n_missing:
            if name in impute:
                fill = float(impute[name])
            elif kind == "binary":
                fill = 0.0
            else:
                fill = float(col.median())
            col = col.fillna(fill)
            meta["imputed"][name] = round(fill, ROUND)
            meta["n_missing"][name] = n_missing
        x = np.round(col.to_numpy(dtype=float), ROUND)
        if len(np.unique(x)) < 2:
            meta["dropped_constant"].append(name)
            continue
        features.append(Feature(name, kind, x))
    if not features:
        die("no usable features")
    meta["n_rows_dropped_missing_target"] = n_before - len(df)
    return df, y, features, meta


def make_bins(features: list[Feature], bins_override: dict) -> None:
    """Binary → [0.5]; continuous → unique deciles above the minimum, or --bins-json."""
    for f in features:
        if f.type == "binary":
            f.thresholds = [0.5]
        elif f.name in bins_override:
            t = sorted(float(v) for v in bins_override[f.name])
            if any(b <= a for a, b in zip(t, t[1:])):
                die(f"--bins-json thresholds for '{f.name}' must be strictly increasing")
            f.thresholds = t
        else:
            q = np.quantile(f.x, np.linspace(0.1, 0.9, 9))
            # A threshold at the minimum would leave bin 0 empty, so drop it.
            f.thresholds = sorted({float(np.round(v, ROUND)) for v in q if v > f.x.min()})
            if not f.thresholds:
                print(f"warning: '{f.name}' has no usable decile thresholds; it gets a single bin")


def encode(features: list[Feature], rows: np.ndarray | slice = slice(None)) -> np.ndarray:
    """Cumulative step indicators 1[x ≥ t_k] for continuous features; the 0/1 column for binary."""
    cols = []
    for f in features:
        x = f.x[rows]
        if f.type == "binary":
            cols.append(x[:, None])
        elif f.thresholds:
            cols.append((x[:, None] >= np.asarray(f.thresholds)[None, :]).astype(float))
    return np.hstack(cols) if cols else np.zeros((len(features[0].x[rows]), 0))


# ---------------------------------------------------------------- coefficient ↔ per-bin levels


def to_levels(coef: np.ndarray, features: list[Feature]) -> list[np.ndarray]:
    levels, pos = [], 0
    for f in features:
        k = f.n_cols
        c = coef[pos : pos + k]
        pos += k
        levels.append(np.array([0.0, c[0]]) if f.type == "binary" else np.concatenate([[0.0], np.cumsum(c)]))
    return levels


def center(intercept: float, levels: list[np.ndarray], fracs: list[np.ndarray]) -> tuple[float, list[np.ndarray]]:
    out = []
    for w, fr in zip(levels, fracs):
        mu = float(fr @ w)
        out.append(w - mu)
        intercept += mu
    return intercept, out


def level_scores(intercept: float, levels: list[np.ndarray], bins: list[np.ndarray]) -> np.ndarray:
    z = np.full(len(bins[0]), intercept)
    for w, b in zip(levels, bins):
        z += w[b]
    return z


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def mean_log_loss(y: np.ndarray, Z: np.ndarray) -> np.ndarray:
    """Mean log-loss per column of the score matrix Z (n × k), computed stably from scores."""
    return np.mean(np.logaddexp(0.0, Z) - y[:, None] * Z, axis=0)


def make_lr(C: float, seed: int) -> LogisticRegression:
    # L1 via l1_ratio=1 (scikit-learn ≥ 1.8). liblinear penalizes the intercept; a larger
    # intercept_scaling makes that penalty negligible.
    return LogisticRegression(
        C=C, l1_ratio=1.0, solver="liblinear", intercept_scaling=10.0, max_iter=1000, random_state=seed
    )


# ---------------------------------------------------------------- main pipeline


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--features", nargs="+", help="comma- or space-separated feature columns")
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-models", type=int, default=150)
    ap.add_argument("--n-rows", type=int, default=800)
    ap.add_argument("--epsilon", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--impute-json")
    ap.add_argument("--recode-json")
    ap.add_argument("--bins-json")
    ap.add_argument("--name", help="dataset name shown in the app")
    ap.add_argument("--label-names", help='JSON like \'{"0": "survived", "1": "died"}\'')
    ap.add_argument("--n-bootstrap", type=int, default=N_BOOTSTRAP)
    ap.add_argument("--n-perturb", type=int, default=N_PERTURB)
    args = ap.parse_args(argv)
    warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
    rng = np.random.default_rng(args.seed)

    # 1–3. load, clean, classify, bin
    df, y, features, meta = load_and_clean(args)
    make_bins(features, json.loads(Path(args.bins_json).read_text()) if args.bins_json else {})
    n_total = len(y)
    all_bins = [f.bins(f.x) for f in features]
    fracs = [np.bincount(b, minlength=len(f.thresholds) + 1) / n_total for f, b in zip(features, all_bins)]
    X = encode(features)
    print(f"{n_total} rows, {len(features)} features, {X.shape[1]} encoded columns")

    # 80/20 split: everything is fit and admitted on train; AUC is reported on test.
    idx_train, idx_test = train_test_split(
        np.arange(n_total), test_size=0.2, stratify=y, random_state=args.seed
    )
    X_tr, y_tr = X[idx_train], y[idx_train]

    def check_conversion(est: LogisticRegression) -> tuple[float, np.ndarray]:
        """Estimator predictions must equal per-bin-level predictions, before and after centering."""
        coef, b = est.coef_[0], float(est.intercept_[0])
        p_est = est.predict_proba(X)[:, 1]
        levels = to_levels(coef, features)
        p_raw = sigmoid(level_scores(b, levels, all_bins))
        b_c, levels_c = center(b, levels, fracs)
        p_cen = sigmoid(level_scores(b_c, levels_c, all_bins))
        err = max(np.max(np.abs(p_est - p_raw)), np.max(np.abs(p_est - p_cen)))
        assert err < 1e-9, f"conversion mismatch {err:.3g}"
        return b, coef

    # 6. generation baseline
    grid = GridSearchCV(
        make_lr(1.0, args.seed),
        {"C": np.logspace(-2, 1, 7)},
        scoring="neg_log_loss",
        cv=StratifiedKFold(5, shuffle=True, random_state=args.seed),
    ).fit(X_tr, y_tr)
    C_ref = float(grid.best_params_["C"])
    b0, c0 = check_conversion(grid.best_estimator_)
    L0 = float(mean_log_loss(y_tr, (X_tr @ c0 + b0)[:, None])[0])
    print(f"baseline: C={C_ref:.4g}, train log-loss L0={L0:.5f}, {int(np.sum(c0 != 0))} nonzero coefficients")

    # 7a. bootstrap refits
    cand_b, cand_c = [b0], [c0]
    for _ in range(args.n_bootstrap):
        boot = rng.integers(0, len(y_tr), len(y_tr))
        C = C_ref * 10 ** rng.uniform(-1, 1)
        est = make_lr(C, args.seed).fit(X_tr[boot], y_tr[boot])
        b, c = check_conversion(est)
        cand_b.append(b)
        cand_c.append(c)
    boot_c = np.array(cand_c[1:])
    print(f"{args.n_bootstrap} bootstrap fits done")

    # 7b. perturbations of jump / binary coefficients
    col_feature = np.concatenate([[j] * f.n_cols for j, f in enumerate(features)]).astype(int)
    coef_std = boot_c.std(axis=0) if len(boot_c) else np.zeros(X.shape[1])
    # s_j: mean across feature j's coefficients of their std over the bootstrap fits, floored.
    s_feat = np.array([max(coef_std[col_feature == j].mean() if f.n_cols else 0.0, S_FLOOR) for j, f in enumerate(features)])
    s_col = s_feat[col_feature]
    for _ in range(args.n_perturb):
        if len(boot_c) and rng.random() < 0.5:
            r = rng.integers(len(boot_c))
            base_b, base_c = cand_b[r + 1], boot_c[r]
        else:
            base_b, base_c = b0, c0
        sigma = SIGMAS[rng.integers(len(SIGMAS))]
        c = base_c + rng.normal(0.0, sigma * s_col)
        keep_zero = (base_c == 0) & (rng.random(len(base_c)) < 0.5)
        c[keep_zero] = 0.0
        cand_b.append(base_b + rng.normal(0.0, 0.1 * sigma))
        cand_c.append(c)

    B_all = np.array(cand_b)
    C_all = np.array(cand_c)
    losses = np.concatenate(
        [mean_log_loss(y_tr, X_tr @ C_all[s : s + 250].T + B_all[s : s + 250]) for s in range(0, len(B_all), 250)]
    )
    passed = np.flatnonzero(losses <= L0 * (1 + args.epsilon))
    print(f"{len(passed)}/{len(B_all)} candidates within eps={args.epsilon} of L0")

    # convert to centered levels; deduplicate on (intercept, weights) rounded to 4 dp
    cands, seen = [], set()
    for i in passed:  # the baseline (index 0) always passes and comes first
        b_c, lv = center(float(B_all[i]), to_levels(C_all[i], features), fracs)
        w = np.concatenate(lv)
        key = tuple(np.round(np.concatenate([[b_c], w]), 4))
        if key in seen:
            continue
        seen.add(key)
        cands.append((i, b_c, w))
    n_passed = len(cands)
    print(f"{n_passed} distinct candidates")
    if n_passed < 10:
        die(f"only {n_passed} distinct candidates passed; try a larger --epsilon")
    if n_passed < args.n_models:
        print(f"warning: only {n_passed} distinct candidates; writing {n_passed} models instead of {args.n_models}")

    # farthest-point sampling on standardized weights, starting from the baseline
    W = np.array([w for _, _, w in cands])
    sd = W.std(axis=0)
    Wz = (W[:, sd > 0] - W[:, sd > 0].mean(axis=0)) / sd[sd > 0]
    order = np.concatenate([[0], 1 + rng.permutation(len(cands) - 1)])  # seeded tie-breaks
    Wz = Wz[order]
    k = min(args.n_models, len(cands))
    chosen = [0]
    dist = np.linalg.norm(Wz - Wz[0], axis=1)
    for _ in range(k - 1):
        nxt = int(np.argmax(dist))
        chosen.append(nxt)
        dist = np.minimum(dist, np.linalg.norm(Wz - Wz[nxt], axis=1))
    selected = [cands[order[c]] for c in chosen]

    # held-out AUC per kept model
    test_bins = [b[idx_test] for b in all_bins]
    offsets = np.cumsum([0] + [len(f.thresholds) + 1 for f in features])
    aucs = []
    for _, b_c, w in selected:
        levels = [w[offsets[j] : offsets[j + 1]] for j in range(len(features))]
        aucs.append(roc_auc_score(y[idx_test], level_scores(b_c, levels, test_bins)))

    # 8. sample instances stratified by target
    if args.n_rows >= n_total:
        rows_idx = np.arange(n_total)
    else:
        rows_idx, _ = train_test_split(np.arange(n_total), train_size=args.n_rows, stratify=y, random_state=args.seed)
        rows_idx = np.sort(rows_idx)

    # 9. write JSON
    def num(v: float):
        v = round(float(v), ROUND)
        return int(v) if v.is_integer() else v

    out = {
        "schema": "modelset.v1",
        "name": args.name or f"{Path(args.csv).stem}: {args.target}",
        "target": {"name": args.target, "positive_label": 1},
        "features": [
            {
                "name": f.name,
                "type": f.type,
                "thresholds": [num(t) for t in f.thresholds],
                "range": [num(f.x.min()), num(f.x.max())],
            }
            for f in features
        ],
        "models": {
            "intercepts": [num(b) for _, b, _ in selected],
            "weights": [[num(v) for v in w] for _, _, w in selected],
            "loss": [num(losses[i]) for i, _, _ in selected],
            "metrics": {"auc": [round(float(a), 4) for a in aucs]},
            "ids": [f"m{m:03d}" for m in range(len(selected))],
        },
        "data": {
            "columns": [f.name for f in features],
            "rows": [[num(f.x[i]) for f in features] for i in rows_idx],
            "y": [int(y[i]) for i in rows_idx],
            "ids": [str(int(i)) for i in rows_idx],
        },
        "meta": {
            "source": f"{Path(args.csv).name} via prep/build_modelset.py",
            "seed": args.seed,
            "epsilon": args.epsilon,
            "C_ref": round(C_ref, 6),
            "L0_train_log_loss": round(L0, 6),
            "n_candidates_tried": int(len(B_all)),
            "n_candidates_passed": n_passed,
            "n_rows_total": n_total,
            "n_rows_train": int(len(idx_train)),
            "n_rows_test": int(len(idx_test)),
            **meta,
            "note": (
                "Models are binned L1-logistic additive models fit on an 80% training split; loss is mean "
                "training log-loss and auc is measured on the held-out 20%. "
                + (
                    "Missing values were filled with the constants in 'imputed', which shows up as spikes "
                    "in those features' histograms; that is expected."
                    if meta["imputed"]
                    else ""
                )
            ).strip(),
        },
    }
    if args.label_names:
        out["target"]["label_names"] = json.loads(args.label_names)

    problems, warns = validate(json.loads(json.dumps(out)))
    if problems:
        die("generated file failed validation:\n  " + "\n  ".join(problems))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, allow_nan=False, separators=(",", ":")), encoding="utf-8")

    # summary
    sample_bins = [b[rows_idx] for b in all_bins]
    P = np.array([sigmoid(level_scores(b, [w[offsets[j] : offsets[j + 1]] for j in range(len(features))], sample_bins)) for _, b, w in selected])
    flips = np.mean((P.min(axis=0) < 0.5) & (P.max(axis=0) >= 0.5))
    sel_loss = [losses[i] for i, _, _ in selected]
    print(f"\nwrote {args.out}  ({Path(args.out).stat().st_size / 1024:.0f} KB)")
    print(f"  N = {len(selected)} models, n = {len(rows_idx)} instances")
    print("  bins: " + ", ".join(f"{f.name}={len(f.thresholds) + 1}" for f in features))
    print(f"  train log-loss {min(sel_loss):.5f} - {max(sel_loss):.5f}  (L0 = {L0:.5f})")
    print(f"  held-out AUC {min(aucs):.4f} - {max(aucs):.4f}")
    print(f"  decision flips at tau = 0.5: {100 * flips:.1f}% of sampled instances")
    for w in warns:
        print(f"  warning: {w}")


if __name__ == "__main__":
    main()
