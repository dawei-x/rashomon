"""Check that the baseline model built from synthetic.csv recovers the known ground truth.

  python check_synthetic.py [out/synthetic.json]

Expect: sodium's curve is U-shaped (both ends above the interior minimum) and age's is non-decreasing.
"""
import json
import sys
from pathlib import Path


def curve(ds: dict, name: str, m: int = 0) -> list[float]:
    off = 0
    for f in ds["features"]:
        b = len(f["thresholds"]) + 1
        if f["name"] == name:
            return ds["models"]["weights"][m][off : off + b]
        off += b
    raise KeyError(name)


def main() -> int:
    ds = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else "out/synthetic.json").read_text())
    sod, age = curve(ds, "sodium"), curve(ds, "age")
    print("sodium:", [round(v, 2) for v in sod])
    print("age:   ", [round(v, 2) for v in age])
    lo = min(range(len(sod)), key=sod.__getitem__)
    u_shaped = 0 < lo < len(sod) - 1 and sod[0] > sod[lo] + 0.1 and sod[-1] > sod[lo] + 0.1
    monotone = all(b >= a - 1e-9 for a, b in zip(age, age[1:]))
    print(f"sodium U-shaped: {u_shaped}; age non-decreasing: {monotone}")
    return 0 if u_shaped and monotone else 1


if __name__ == "__main__":
    sys.exit(main())
