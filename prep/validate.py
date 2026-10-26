"""Validate a modelset.v1 JSON file (same rules as app/src/lib/schema.ts).

Usage: python validate.py FILE.json [FILE.json ...]
Exits non-zero if any file is invalid. Works on app exports too.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

MAX_PROBLEMS = 5


class _Full(Exception):
    pass


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _reject_constant(name: str):
    # JSON.parse in the browser rejects NaN/Infinity, so we do too.
    raise ValueError(f"non-standard JSON constant {name}")


def load_json(text: str):
    return json.loads(text, parse_constant=_reject_constant)


def validate(obj) -> tuple[list[str], list[str]]:
    """Return (problems, warnings). An empty problem list means the file is valid."""
    problems: list[str] = []

    def add(msg: str) -> None:
        problems.append(msg)
        if len(problems) >= MAX_PROBLEMS:
            raise _Full

    try:
        _check(obj, add)
    except _Full:
        pass
    if problems:
        return problems[:MAX_PROBLEMS], []
    warnings = []
    if len(obj["models"]["intercepts"]) > 300:
        warnings.append(f"{len(obj['models']['intercepts'])} models (> 300) may be slow")
    if len(obj["data"]["rows"]) > 2000:
        warnings.append(f"{len(obj['data']['rows'])} instances (> 2000) may be slow")
    return [], warnings


def _check(obj, add) -> None:
    if not isinstance(obj, dict):
        add("top level is not a JSON object")
        return
    if obj.get("schema") != "modelset.v1":
        add(f'schema must be "modelset.v1" (got {json.dumps(obj.get("schema"))})')

    # --- features
    features = obj.get("features")
    total_bins = 0
    names: list[str] = []
    binary_cols: list[int] = []
    features_ok = False
    if not isinstance(features, list) or len(features) < 1:
        add("features must be a non-empty array")
    else:
        features_ok = True
        seen: set[str] = set()
        for j, f in enumerate(features):
            where = f"features[{j}]"
            if not isinstance(f, dict):
                features_ok = False
                add(f"{where} is not an object")
                continue
            name = f.get("name")
            if not isinstance(name, str) or name == "":
                features_ok = False
                add(f"{where}.name must be a non-empty string")
            elif name in seen:
                features_ok = False
                add(f'{where}.name "{name}" is duplicated')
            else:
                seen.add(name)
            if f.get("type") not in ("continuous", "binary"):
                features_ok = False
                add(f'{where}.type must be "continuous" or "binary"')
            t = f.get("thresholds")
            if not isinstance(t, list) or not all(_is_num(v) for v in t):
                features_ok = False
                add(f"{where}.thresholds must be an array of finite numbers")
            else:
                if any(not (t[k] > t[k - 1]) for k in range(1, len(t))):
                    features_ok = False
                    add(f"{where}.thresholds are not strictly increasing")
                if f.get("type") == "binary" and not (len(t) == 1 and t[0] == 0.5):
                    features_ok = False
                    add(f"{where} is binary, so thresholds must be exactly [0.5]")
                total_bins += len(t) + 1
            if "range" in f:
                r = f["range"]
                if not (isinstance(r, list) and len(r) == 2 and _is_num(r[0]) and _is_num(r[1]) and r[0] < r[1]):
                    add(f"{where}.range must be [min, max] with min < max")
            if "unit" in f and not isinstance(f["unit"], str):
                add(f"{where}.unit must be a string")
        names = [f.get("name") if isinstance(f, dict) else "" for f in features]
        binary_cols = [j for j, f in enumerate(features) if isinstance(f, dict) and f.get("type") == "binary"]

    # --- models
    models = obj.get("models")
    if not isinstance(models, dict):
        add("models must be an object")
    else:
        intercepts = models.get("intercepts")
        n_models = len(intercepts) if isinstance(intercepts, list) else -1
        if n_models < 1:
            add("models.intercepts must be a non-empty array")
        else:
            if not all(_is_num(v) for v in intercepts):
                add("models.intercepts must contain only finite numbers")

            def check_len(name, arr, need_num=True):
                if not isinstance(arr, list):
                    add(f"{name} must be an array of length {n_models}")
                elif len(arr) != n_models:
                    add(f"{name} has length {len(arr)}, expected {n_models}")
                elif need_num and not all(_is_num(v) for v in arr):
                    add(f"{name} must contain only finite numbers")

            check_len("models.loss", models.get("loss"))
            if "metrics" in models:
                metrics = models["metrics"]
                if not isinstance(metrics, dict):
                    add("models.metrics must be an object of arrays")
                else:
                    for k, v in metrics.items():
                        check_len(f"models.metrics.{k}", v)
            if "ids" in models:
                ids = models["ids"]
                check_len("models.ids", ids, need_num=False)
                if isinstance(ids, list) and len(ids) == n_models:
                    if not all(isinstance(s, str) for s in ids):
                        add("models.ids must be strings")
                    elif len(set(ids)) != n_models:
                        add("models.ids must be unique")
            weights = models.get("weights")
            if not isinstance(weights, list) or len(weights) != n_models:
                add(f"models.weights must be an array of {n_models} rows")
            elif features_ok:
                for m, row in enumerate(weights):
                    if not isinstance(row, list) or len(row) != total_bins:
                        got = len(row) if isinstance(row, list) else "n/a"
                        add(f"models.weights[{m}] has length {got}, expected {total_bins}")
                    elif not all(_is_num(v) for v in row):
                        add(f"models.weights[{m}] contains a non-finite value")

    # --- data
    data = obj.get("data")
    if not isinstance(data, dict):
        add("data must be an object")
        return
    cols = data.get("columns")
    if not isinstance(cols, list) or (features_ok and cols != names):
        add("data.columns must equal features[].name in the same order")
    rows = data.get("rows")
    n = len(rows) if isinstance(rows, list) else 0
    if not isinstance(rows, list) or n < 1:
        add("data.rows must contain at least one row")
    elif features_ok:
        n_cols = len(names)
        for i, r in enumerate(rows):
            if not isinstance(r, list) or len(r) != n_cols:
                add(f"data.rows[{i}] must have {n_cols} values")
                continue
            for j in range(n_cols):
                if not _is_num(r[j]):
                    add(f"data.rows[{i}][{j}] is not a finite number")
                    break
            for j in binary_cols:
                if r[j] != 0 and r[j] != 1 or isinstance(r[j], bool):
                    add(f'data.rows[{i}]: binary feature "{names[j]}" must be 0 or 1')
                    break
    if "y" in data:
        y = data["y"]
        if not isinstance(y, list) or len(y) != n:
            add(f"data.y must have length {n}")
        elif not all(_is_num(v) for v in y):
            add("data.y must contain only finite numbers")
    if "ids" in data:
        ids = data["ids"]
        if not isinstance(ids, list) or len(ids) != n:
            add(f"data.ids must have length {n}")
        elif not all(isinstance(s, str) for s in ids):
            add("data.ids must be strings")
        elif len(set(ids)) != n:
            add("data.ids must be unique")


def validate_file(path: Path) -> tuple[list[str], list[str]]:
    try:
        obj = load_json(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        return [f"cannot read JSON: {e}"], []
    return validate(obj)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip())
        return 2
    bad = 0
    for arg in argv:
        problems, warnings = validate_file(Path(arg))
        if problems:
            bad += 1
            print(f"INVALID {arg}")
            for p in problems:
                print(f"  - {p}")
        else:
            print(f"ok      {arg}")
            for w in warnings:
                print(f"  warning: {w}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
