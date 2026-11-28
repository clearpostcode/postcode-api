=== ClearPostcode ===
Contributors: clearpostcode
Tags: postcode, uk postcode, woocommerce, checkout, address validation
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Check UK postcodes at WooCommerce checkout and add a postcode checker to any page. Free: 10,000 postcode lookups a month, no card.

== Description ==

Stop undeliverable orders and typo'd addresses before they happen. ClearPostcode checks the billing and shipping postcodes on your WooCommerce checkout against live UK postcode data, and gives you a `[clear_postcode_lookup]` shortcode that turns any page into a postcode checker.

* **WooCommerce checkout check:** billing and shipping postcodes are validated when the customer places the order, on both the classic checkout and the Checkout block. A bad postcode gets a clear message. If the service can't be reached, the order goes through: your checkout never stalls.
* **Postcode checker:** `[clear_postcode_lookup]` shows a box where visitors type a postcode and see its council, ward, constituency, region and country.
* **Fast:** answers are cached for 12 hours, so repeat postcodes cost nothing.
* **Free to start:** 10,000 postcode lookups a month, no card. Paste your free secret key (`cp_live_...`) in Settings: the plugin calls the API from your server, so the key never reaches a visitor's browser. Without a key the free keyless allowance applies.
* **Tells you when it needs you:** if the API refuses the key or the month's lookups run out, a notice on your dashboard says so and what to do.

Settings are under Settings, ClearPostcode. Get your free key at https://clearpostcode.co.uk/developers.

Shortcode options:

* `[clear_postcode_lookup]`
* `[clear_postcode_lookup placeholder="Your postcode" button="Find my council"]`

== External services ==

This plugin sends postcodes from your WordPress server to the ClearPostcode API (https://api.clearpostcode.co.uk) to check them and look up the area they are in.

* **What is sent:** the postcode being checked (a customer's billing or shipping postcode at checkout, or the postcode a visitor types into the checker) and, if you have added one, your secret key. No names, street addresses or other order details are sent. When you save a key, one free call checks it.
* **When:** each time a checkout is placed with a UK postcode, and each time a visitor uses the checker. Answers are cached on your site for 12 hours.
* **Service provider:** ClearPostcode (https://clearpostcode.co.uk).
* Terms of use: https://clearpostcode.co.uk/terms
* Privacy policy: https://clearpostcode.co.uk/privacy

Postcode data: Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; Office for National Statistics data licensed under the Open Government Licence v3.0.

== Frequently Asked Questions ==

= Is it free? =

Yes. The free plan is 10,000 postcode lookups a month with no card. Paid plans are for bigger shops.

= Do I need a key? =

A free secret key is recommended: it gives your shop its own monthly allowance and shows your usage in your dashboard. Paste it under Settings, ClearPostcode; the plugin checks it with the API as you save. Without one, the plugin works inside the API's keyless allowance, shared by everything on your server's network.

= What happens if a postcode is very new? =

New-build postcodes can take up to a quarter to reach the open data. By default the plugin only stops postcodes that are not in the UK format. Tick "Also stop postcodes that are not in the current edition" in Settings if you prefer a stricter check.

= Does it work with the WooCommerce Checkout block? =

Yes, and with the classic checkout. Only orders to the UK (including the Isle of Man, Jersey and Guernsey) are checked.

= Which key goes in Settings? =

Your secret key, which starts `cp_live_`. The plugin calls the API from your server, where a secret key belongs. A publishable key (`cp_pub_...`) is made for browsers and is locked to your domain, so the settings screen asks for the secret one instead.

= Northern Ireland? =

BT postcodes are checked by format only.

== Changelog ==

= 1.0.1 =
* Shops with a key: Settings now takes your secret key (`cp_live_`), the right key for checks that run on your server, and confirms it with the API as you save, showing your plan and lookups left.
* A notice on your dashboard when the API refuses the key, the month's lookups are used up or today's allowance is reached, with what to do.
* Clearer checkout messages: a retired postcode names the live postcode that replaced it.
* The postcode checker shows the replacement for a retired postcode.

= 1.0.0 =
* First release: WooCommerce checkout postcode check (classic and block), the `[clear_postcode_lookup]` shortcode and a settings page.
