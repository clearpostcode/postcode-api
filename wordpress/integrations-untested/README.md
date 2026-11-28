# Integrations written against documented hooks, not yet run

Gravity Forms and Elementor Pro forms are paid-only, so these two files have not been run against the real plugins.
They are not in the plugin or its release zip. To ship one: install the plugin in the Docker test site
(`wordpress/tests`), add a test for it to `tests/integration.php` and `tests/browser.py`, move the file to
`clear-postcode/includes/forms/` and load it from `clear-postcode.php` beside Contact Form 7 and WPForms.
