"""Write out/synthetic.csv: clinical-looking data with a known logistic ground truth.

Self-test and fallback input for build_modelset.py (spec §6.1). The truth includes a U-shaped
effect (sodium), a monotone effect (age), a near-null feature (potassium), ~5% label noise and a
data-quality artifact (2% of systolic_bp recorded as 0).

  python make_synthetic.py [--seed 0] [--rows 6000]
  python build_modelset.py --csv out/synthetic.csv --target died --out out/synthetic.json
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).parent / "out" / "synthetic.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--rows", type=int, default=6000)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    n = args.rows

    df = pd.DataFrame(
        {
            "age": np.clip(rng.normal(63, 15, n), 18, 100).round(1),
            "heart_rate": np.clip(rng.normal(95, 22, n), 35, 180).round(),
            "systolic_bp": np.clip(rng.normal(120, 25, n), 60, 220).round(),
            "sodium": np.clip(rng.normal(138, 6, n), 115, 165).round(),
            "potassium": np.clip(rng.normal(4.2, 0.6, n), 2.5, 7.0).round(1),
            "wbc": np.clip(rng.lognormal(np.log(10), 0.5, n), 0.5, 60).round(1),
            "bilirubin": np.clip(rng.lognormal(np.log(1.0), 0.9, n), 0.1, 30).round(2),
            "creatinine": np.clip(rng.lognormal(np.log(1.2), 0.6, n), 0.3, 12).round(2),
            "pf_ratio": np.clip(rng.normal(280, 110, n), 40, 650).round(),
            "coma_score": np.where(rng.random(n) < 0.7, 0, rng.integers(1, 101, n)),
            "aids": (rng.random(n) < 0.03).astype(int),
            "lymphoma": (rng.random(n) < 0.04).astype(int),
            "metastatic_cancer": (rng.random(n) < 0.12).astype(int),
        }
    )

    z = (
        -1.6
        + 0.045 * (df.age - 63)  # monotone
        + 0.22 * np.maximum(0, 131 - df.sodium)  # U-shape: risk high below ~130 ...
        + 0.22 * np.maximum(0, df.sodium - 147)  # ... and above ~150
        + 0.9 * np.log(df.creatinine)
        + 0.5 * np.log(df.bilirubin)
        + 0.018 * df.coma_score
        + 0.012 * (df.heart_rate - 95)
        - 0.004 * (df.pf_ratio - 280)
        + 0.04 * np.abs(df.wbc - 9)
        + 0.0 * df.potassium  # near-null
        + 1.1 * df.metastatic_cancer
        + 0.6 * df.aids
        + 0.4 * df.lymphoma
    )
    died = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    noise = rng.random(n) < 0.05
    died[noise] = 1 - died[noise]
    df["died"] = died

    df.loc[rng.random(n) < 0.02, "systolic_bp"] = 0  # data-quality artifact

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT} ({n} rows, prevalence {died.mean():.3f})")


if __name__ == "__main__":
    main()
