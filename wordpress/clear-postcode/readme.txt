=== ClearPostcode ===
Contributors: clearpostcode
Tags: postcode, uk postcode, woocommerce, address lookup, contact form 7
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Check UK postcodes at WooCommerce checkout and add a postcode checker to any page. Free: 10,000 postcode lookups a month, no card.

== Description ==

Stop undeliverable orders and typo'd addresses before they happen. ClearPostcode formats, suggests and checks UK postcodes as your customers type, at WooCommerce checkout and in your forms, and checks them again on your server when the order is placed.

* **Postcode finder as they type:** the postcode field formats itself, suggests postcodes, and says straight away when a postcode is mistyped, retired (with its live replacement in one click) or brand new. Full keyboard use and screen-reader announcements. Works on the classic checkout, the Checkout block and My account addresses.
* **Address lookup:** with a publishable key whose account has Address lookup switched on, the same box finds the full Royal Mail address from a postcode or the start of the address, and the address fields fill.
* **Checked as the order is placed:** billing and shipping postcodes are checked on your server, on the classic checkout and the Checkout block. If the service can't be reached, the order goes through: your checkout never stalls.
* **Contact Form 7 and WPForms:** a `[postcode* your-postcode]` tag for Contact Form 7, and the CSS class `clear-postcode` on any WPForms text field, give your forms the finder and the same check on sending.
* **Postcode checker:** `[clear_postcode_lookup]` shows a box where visitors type a postcode and see its council, ward, constituency, region and country as they type.
* **Tells you when it needs you:** if the API refuses the key or the month's lookups run out, a notice on your dashboard says so and what to do.
* **Free to start:** 10,000 postcode lookups a month, no card. The finder works without a key; your free secret key (`cp_live_...`) gives checkout checks their own monthly allowance.

Settings are under Settings, ClearPostcode. Get your free keys at https://clearpostcode.co.uk/developers.

Shortcode options:

* `[clear_postcode_lookup]`
* `[clear_postcode_lookup placeholder="Your postcode"]`

== External services ==

This plugin uses the ClearPostcode API (https://api.clearpostcode.co.uk) to check postcodes and look up the areas and addresses at them.

* **From your server:** when an order is placed or a Contact Form 7 or WPForms form is sent, the postcode entered is sent with your secret key, if you have added one. When you save a key in Settings, one free call checks it. No names, street addresses or other order details are sent. Answers are cached on your site for 12 hours.
* **From your visitors' browsers (the postcode finder and checker):** what the visitor types into a postcode field is sent as they type, with your publishable key if you have added one. When Address lookup is on for your key, the address the visitor picks is fetched the same way. The API sees the visitor's IP address and your site's address, as with any web request.
* **Service provider:** ClearPostcode (https://clearpostcode.co.uk).
* Terms of use: https://clearpostcode.co.uk/terms
* Privacy policy: https://clearpostcode.co.uk/privacy

The postcode finder (`assets/finder.js`, `assets/finder.css`) is built from the open-source `clearpostcode` package: source at https://github.com/clearpostcode/postcode-api/tree/main/npm/src/widget.

Postcode data: Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; Office for National Statistics data licensed under the Open Government Licence v3.0.

== Frequently Asked Questions ==

= Is it free? =

Yes. The free plan is 10,000 postcode lookups a month with no card. Paid plans are for bigger shops.

= Do I need a key? =

A free secret key is recommended: it gives your shop's checkout checks their own monthly allowance and shows your usage in your dashboard. Paste it under Settings, ClearPostcode; the plugin checks it with the API as you save. Without one, checkout checks work inside the API's keyless allowance, shared by everything on your server's network. The postcode finder works without any key.

= What happens if a postcode is very new? =

New-build postcodes can take up to a quarter to reach the open data. By default the plugin only stops postcodes that are not in the UK format. Tick "Also stop postcodes that are not in the current edition" in Settings if you prefer a stricter check.

= Does it work with the WooCommerce Checkout block? =

Yes, and with the classic checkout. Only orders to the UK (including the Isle of Man, Jersey and Guernsey) are checked.

= Which keys go in Settings? =

Your secret key (`cp_live_...`) goes in Secret key: checkout and form checks run on your server, where a secret key belongs, and it is never shown again once saved. Your publishable key (`cp_pub_...`) goes in Publishable key: it is made for browsers and locked to your domain, and the postcode finder uses it. Both are optional.

= How do I add the postcode finder to Contact Form 7 or WPForms? =

Contact Form 7: add `[postcode* your-postcode]` to your form (`[postcode your-postcode]` when it is optional). WPForms: add a Single Line Text field and give it the CSS class `clear-postcode` under Advanced. Both get the finder as visitors type and the same postcode check when the form is sent.

= Northern Ireland? =

BT postcodes are checked by format only.

== Changelog ==

= 1.1.0 =
* The postcode finder: postcodes formatted, suggested and checked as customers type, at checkout (classic and block), on My account addresses and in forms, with a clear message for a mistyped, retired or brand-new postcode.
* Address lookup in the same box with a publishable key whose account has it switched on.
* Contact Form 7 `[postcode]` tag and WPForms `clear-postcode` fields, checked on sending.
* The postcode checker answers as visitors type, straight from their browser.
* A Publishable key setting, checked against your domain as you save. The secret key is never shown again once saved.

= 1.0.1 =
* Shops with a key: Settings now takes your secret key (`cp_live_`), the right key for checks that run on your server, and confirms it with the API as you save, showing your plan and lookups left.
* A notice on your dashboard when the API refuses the key, the month's lookups are used up or today's allowance is reached, with what to do.
* Clearer checkout messages: a retired postcode names the live postcode that replaced it.
* The postcode checker shows the replacement for a retired postcode.

= 1.0.0 =
* First release: WooCommerce checkout postcode check (classic and block), the `[clear_postcode_lookup]` shortcode and a settings page.
