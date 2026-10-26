"""Check that validate.py accepts/rejects the same hand-made files as app/tests/schema.test.ts.

Files named good-*.json must validate; bad-*.json must not.
"""
import sys
from pathlib import Path

from validate import validate_file

DIR = Path(__file__).parent.parent / "app" / "tests" / "fixtures" / "validation"


def main() -> int:
    failures = 0
    for path in sorted(DIR.glob("*.json")):
        problems, _ = validate_file(path)
        expect_ok = path.name.startswith("good-")
        ok = not problems
        status = "pass" if ok == expect_ok else "FAIL"
        failures += status == "FAIL"
        print(f"{status}  {path.name:32s} {'accepted' if ok else 'rejected: ' + problems[0]}")
    print(f"{failures} mismatch(es)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
