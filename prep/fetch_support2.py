"""Download SUPPORT2 (UCI id 880) and write out/support2.csv."""
from pathlib import Path

import pandas as pd
from ucimlrepo import fetch_ucirepo

OUT = Path(__file__).parent / "out" / "support2.csv"


def main() -> None:
    ds = fetch_ucirepo(id=880)  # SUPPORT2, 9,105 seriously ill hospitalized adults
    df = pd.concat([ds.data.features, ds.data.targets], axis=1)
    df = df.loc[:, ~df.columns.duplicated()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT} ({len(df)} rows, {df.shape[1]} columns)")


if __name__ == "__main__":
    main()
