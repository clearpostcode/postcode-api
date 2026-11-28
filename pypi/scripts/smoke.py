"""Live smoke test against the production API (uv run python scripts/smoke.py). Every ```python block in README.md runs
as printed (```python secret blocks only with a secret key in CLEAR_POSTCODE_KEY), and each line it prints must match
the README's ``# expected`` comment (the text before any ": " note). Then the contract, sync and async. About 30
requests a run."""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
from collections.abc import Callable
from functools import partial
from pathlib import Path

from clearpostcode import (
    AsyncClearPostcode,
    AuthenticationError,
    BadRequestError,
    ClearPostcode,
    NotFoundError,
    PermissionDeniedError,
)

ROOT = Path(__file__).resolve().parents[1]
SECRET = os.environ.get("CLEAR_POSTCODE_KEY", "").startswith("cp_live_")
failed = 0


def check(name: str, fn: Callable[[], None]) -> None:
    global failed
    try:
        fn()
        print(f"ok    {name}")
    except Exception as e:
        failed += 1
        print(f"FAIL  {name}\n      {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}")


def expected(code: str) -> list[str]:
    """The output a block promises: ``print(...)  # x``, or a comment line straight after a print line."""
    out: list[str] = []
    lines = code.split("\n")
    for i, line in enumerate(lines):
        if "print(" not in line:
            continue
        inline = re.search(r"#\s(.+)$", line)
        nxt = re.match(r"^\s*#\s(.+)$", lines[i + 1]) if i + 1 < len(lines) else None
        found = inline or nxt
        if found:
            out.append(found[1].split(": ")[0])
    return out


def run_block(code: str) -> None:
    printed = subprocess.run([sys.executable, "-c", code], check=True, capture_output=True, text=True).stdout.split(
        "\n"
    )
    lines = [line for line in printed if line]
    for j, want in enumerate(expected(code)):
        got = lines[j] if j < len(lines) else None
        assert got is not None and got.startswith(want), f'line {j + 1}: printed "{got}", the README says "{want}"'


readme = (ROOT / "README.md").read_text()
for i, m in enumerate(re.finditer(r"```python( \w+)?\n([\s\S]*?)```", readme)):
    tag = (m[1] or "").strip()
    first = next((x.strip() for x in m[2].split("\n") if "cp." in x and not x.strip().startswith("#")), "")
    name = f"README block {i + 1}{f' ({tag})' if tag else ''}: {first[:60]}"
    if tag == "secret" and not SECRET:
        print(f"skip  {name} (needs a secret key in CLEAR_POSTCODE_KEY)")
        continue
    check(name, partial(run_block, m[2]))

cp = ClearPostcode()


def districts() -> None:
    r = cp.outcodes.get("SW1A")
    assert r.data["area_name"] == "South West London"
    centre = r.data["centre"]
    assert centre and isinstance(centre["latitude"], float)
    assert r.data["local_authorities"] and isinstance(r.data["large_user"], int)
    assert re.match(r"^\d{4}-\d{2}$", r.meta["next_edition"]) and r.meta["next_edition_expected"]["from"]


def areas_and_more() -> None:
    assert "local_authority" in cp.areas.get("SW").data["districts"][0]
    assert cp.sectors.get("SW1A 1").data["postcodes"]
    assert any(p["district"] == "SW3" for p in cp.places.search("Chelsea").data)
    assert len(cp.postcodes.nearest("SW1A 1AA", limit=2).data) == 2
    r = cp.postcodes.reverse(51.501, -0.1416, radius=1000, limit=3)
    assert r.meta.get("radius_m") == 1000 and r.data
    assert cp.postcodes.distance("SW1A 1AA", "EH1 1YZ").data["km"] > 500


def terminated_and_ni() -> None:
    t = cp.postcodes.lookup("AB1 0AA", fields=["replaced_by", "terminated"]).data
    assert t["status"] == "terminated" and t.get("replaced_by")
    bt = cp.postcodes.validate("BT1 1AA").data
    assert bt["coverage"] == "not_covered" and bt["format_valid"] is True


def problems() -> None:
    try:
        cp.postcodes.lookup("ZZ1 1ZZ")
        raise AssertionError("ZZ1 1ZZ answered")
    except BadRequestError as bad:
        assert bad.code == "invalid_postcode" and bad.request_id
    try:
        cp.postcodes.lookup("SW1A 9ZZ")
        raise AssertionError("SW1A 9ZZ answered")
    except NotFoundError as missing:
        assert missing.code == "postcode_not_found"


def limits_and_keys() -> None:
    r = cp.postcodes.validate("M1 1AE")
    assert r.rate_limit and r.rate_limit.limit and r.rate_limit.remaining is not None and r.rate_limit.policy
    if SECRET:
        return
    for call in (cp.account.usage, lambda: cp.outcodes.postcodes("SW1A")):
        try:
            call()
            raise AssertionError("a secret-key call answered keyless")
        except AuthenticationError as e:
            assert e.code == "key_required"


def addresses() -> None:
    try:
        cp.addresses.suggest("2 high street")
        raise AssertionError("address lookup answered keyless")
    except (PermissionDeniedError, AuthenticationError) as e:
        assert e.code in ("address_lookup_not_enabled", "key_required")


async def concurrent() -> None:
    async with AsyncClearPostcode() as a:
        x, y = await asyncio.gather(a.postcodes.validate("SW1A 1AA"), a.outcodes.get("M1"))
        assert x.data["valid"] and y.data["area_name"]


check("districts are snake_case with a centre point", districts)
check("areas, sectors, places, nearest, reverse and distance answer", areas_and_more)
check("a terminated postcode answers with its replacement; Northern Ireland is checked by format", terminated_and_ni)
check("problems are typed and carry request ids", problems)
check("keyless calls carry rate limits; secret-key calls refuse keyless callers with key_required", limits_and_keys)
check("address lookup answers keyless callers with a typed refusal", addresses)
check("the async client answers concurrent calls", lambda: asyncio.run(concurrent()))
cp.close()
print(f"\n{failed} failed" if failed else "\nsmoke: all good")
sys.exit(1 if failed else 0)
