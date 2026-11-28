"""The finder in a real browser on the test shop (run.sh BROWSER=1): classic checkout (with an order the server check
stops), the Checkout block, Contact Form 7 and the postcode checker, at 1440 and 390. The API is faked (fake/), so the
run makes no live calls. Usage: browser.py BASE PRODUCT_ID SHOT_DIR"""

import sys

from playwright.sync_api import Page, sync_playwright

BASE, PRODUCT, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3]
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok or not detail else f"\n      {detail}"))
    if not ok:
        failed.append(name)


def status_near(page: Page, selector: str, text: str) -> bool:
    try:
        page.wait_for_function(
            # The status sits after the input (WooCommerce rewrites aria-describedby with its own validation; the
            # status stays a live region).
            "([s, t]) => { const i = document.querySelector(s);"
            " return !!i && [...i.parentElement.querySelectorAll('.cpw-status')].some((x) => x.textContent.includes(t)); }",
            arg=[selector, text],
            timeout=8000,
        )
        return True
    except Exception:
        return False


with sync_playwright() as p:
    browser = p.chromium.launch()
    for tag, (w, h) in {"desktop": (1440, 900), "mobile": (390, 844)}.items():
        ctx = browser.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{BASE}/?add-to-cart={PRODUCT}")

        page.goto(f"{BASE}/classic-checkout/")
        pc = page.locator("#billing_postcode")
        page.wait_for_function("document.querySelector('#billing_postcode')?.getAttribute('role') === 'combobox'", timeout=8000)
        check(f"{tag} classic checkout: the finder is on the billing postcode", pc.get_attribute("role") == "combobox")
        pc.fill("")
        pc.press_sequentially("sw1a1aa", delay=40)
        check(f"{tag} classic checkout: formatted and checked as typed", pc.input_value() == "SW1A 1AA" and status_near(page, "#billing_postcode", "Westminster"))
        page.screenshot(path=f"{SHOTS}/{tag}-classic-checkout.png", full_page=True)
        if tag == "desktop":
            for sel, value in {"#billing_first_name": "Test", "#billing_last_name": "Shopper", "#billing_address_1": "1 Example Road", "#billing_city": "Exampleton", "#billing_phone": "07000000000", "#billing_email": "shopper@example.com"}.items():
                page.fill(sel, value)
            pc.fill("ZZ1 1ZZ")
            page.locator("#place_order").click()
            try:
                page.wait_for_selector(".woocommerce-error, .woocommerce-NoticeGroup-checkout", timeout=15000)
                notice = page.locator(".woocommerce-error, .woocommerce-NoticeGroup-checkout").first.inner_text()
            except Exception:
                notice = ""
            check("classic checkout: the server check stops a postcode that is not a UK postcode", "ZZ1 1ZZ" in notice and "not a UK postcode" in notice, notice[:200])

        page.goto(f"{BASE}/checkout/")
        sel = 'input[autocomplete~="postal-code"]'
        try:
            page.wait_for_function(f"document.querySelector('{sel}')?.getAttribute('role') === 'combobox'", timeout=10000)
        except Exception:
            pass
        block = page.locator(sel).first
        check(f"{tag} Checkout block: the finder is on the postcode field", block.get_attribute("role") == "combobox")
        block.fill("")
        block.press_sequentially("M1 1AE", delay=40)
        found = status_near(page, sel, "Manchester")
        city = page.locator('input[autocomplete~="address-level2"]').first
        if city.count():
            city.fill("Manchester")
            page.wait_for_timeout(500)
        alive = page.evaluate(f"document.querySelector('{sel}').getAttribute('role') === 'combobox' && !!document.querySelector('.cpw-status')")
        check(f"{tag} Checkout block: checked as typed, and still in place after the form re-renders", found and alive)
        page.screenshot(path=f"{SHOTS}/{tag}-block-checkout.png", full_page=True)

        page.goto(f"{BASE}/postcode-checker/")
        box = page.locator('[data-clearpostcode="postcode"]')
        box.press_sequentially("sw1a 1aa", delay=40)
        try:
            page.wait_for_function("document.querySelector('dd[data-clearpostcode=\"council\"]').textContent === 'Westminster'", timeout=8000)
            shown = page.locator('dd[data-clearpostcode="constituency"]').is_visible()
        except Exception:
            shown = False
        box.press("Enter")
        check(f"{tag} checker: council and constituency show as typed; Enter keeps the page", shown and page.url.rstrip("/").endswith("postcode-checker"))
        page.screenshot(path=f"{SHOTS}/{tag}-checker.png", full_page=True)

        page.goto(f"{BASE}/contact/")
        field = page.locator('input[name="your-postcode"]')
        field.press_sequentially("eh11yz", delay=40)
        check(f"{tag} Contact Form 7: the finder formats and checks the postcode", field.input_value() == "EH1 1YZ" and status_near(page, 'input[name="your-postcode"]', "Edinburgh"))
        if tag == "desktop":
            field.fill("ZZ1 1ZZ")
            page.locator('input[type="submit"]').click()
            try:
                page.wait_for_selector(".wpcf7-not-valid-tip", timeout=10000)
                tip = page.locator(".wpcf7-not-valid-tip").first.inner_text()
            except Exception:
                tip = ""
            check("Contact Form 7: sending stops a postcode that is not a UK postcode", "not a UK postcode" in tip, tip)
        page.screenshot(path=f"{SHOTS}/{tag}-cf7.png", full_page=True)
        check(f"{tag}: no script errors on any page", not errors, "; ".join(errors)[:300])
        ctx.close()
    browser.close()
print(f"\n{len(failed)} failed" if failed else "\nbrowser: all good")
sys.exit(1 if failed else 0)
