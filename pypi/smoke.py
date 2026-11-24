"""Live smoke test, no key: one postcode lookup against the real API."""

import sys

from clearpostcode import ClearPostcode

r = ClearPostcode().lookup("SW1A 1AA")
d = r["data"]
print(
    d["postcode"],
    d["status"],
    "|",
    d["local_authority"]["name"],
    "|",
    d["constituency"]["name"],
    "| edition",
    r["meta"]["edition"],
)
if d["postcode"] != "SW1A 1AA" or d["status"] != "live":
    sys.exit(1)
