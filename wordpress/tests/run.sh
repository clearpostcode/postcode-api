#!/usr/bin/env bash
# The plugin on a real WordPress with WooCommerce (Docker): the integration tests (integration.php), Plugin Check and
# PHPCS with the WordPress rules. Containers and volumes are removed at the end (KEEP=1 leaves the site up on
# http://localhost:${WP_PORT:-8089}, admin/admin, for a look in a browser).
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose -f docker-compose.yml "$@"; }
cleanup() { [ "${KEEP:-}" = 1 ] || dc down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
dc up -d --quiet-pull >/dev/null
wp() { dc exec -T cli wp --quiet "$@"; }

for _ in $(seq 1 90); do dc exec -T cli test -f /var/www/html/wp-config.php && wp db check >/dev/null 2>&1 && break; sleep 2; done
wp core install --url="http://localhost:${WP_PORT:-8089}" --title="ClearPostcode test shop" --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
wp plugin install woocommerce contact-form-7 wpforms-lite --activate
wp plugin activate clear-postcode
echo "WordPress $(wp core version), WooCommerce $(wp plugin get woocommerce --field=version), Contact Form 7 $(wp plugin get contact-form-7 --field=version), WPForms Lite $(wp plugin get wpforms-lite --field=version)"

status=0
wp eval-file /tests/integration.php || status=1

if [ "${BROWSER:-}" = 1 ]; then
  echo "== In a browser (fake API)"
  node fake/api.mjs & FAKE=$!
  trap 'kill $FAKE 2>/dev/null; cleanup' EXIT
  dc exec -T cli mkdir -p /var/www/html/wp-content/mu-plugins
  dc cp fake/mu-fake-api.php cli:/var/www/html/wp-content/mu-plugins/mu-fake-api.php
  wp rewrite structure '/%postname%/' --hard
  wp wc tool run install_pages --user=admin >/dev/null
  wp option update woocommerce_default_country GB
  wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery"}' --format=json
  product=$(dc exec -T cli wp wc product create --name="Test tee" --regular_price=10 --virtual=true --user=admin --porcelain | tr -d '\r')
  wp post create --post_type=page --post_name=classic-checkout --post_title="Classic checkout" --post_status=publish --post_content='[woocommerce_checkout]'
  wp post create --post_type=page --post_name=postcode-checker --post_title="Postcode checker" --post_status=publish --post_content='[clear_postcode_lookup]'
  cf7=$(dc exec -T cli wp eval '$f = WPCF7_ContactForm::get_template( array( "title" => "Contact" ) ); $f->set_properties( array( "form" => "<p><label>Postcode [postcode* your-postcode]</label></p> [submit \"Send\"]" ) ); $f->save(); echo $f->id();' | tr -d '\r')
  wp post create --post_type=page --post_name=contact --post_title="Contact" --post_status=publish --post_content="[contact-form-7 id=\"$cf7\"]"
  mkdir -p "${SHOTS:-/tmp/clear-postcode-shots}"
  uv run -q --with 'playwright>=1.64,<1.65' python browser.py "http://localhost:${WP_PORT:-8089}" "$product" "${SHOTS:-/tmp/clear-postcode-shots}" || status=1
fi

echo "== Plugin Check"
wp plugin install plugin-check --activate
dc exec -T cli wp plugin check clear-postcode --format=csv > /tmp/clear-postcode-check.csv 2>&1 || true
if grep -q "ERROR" /tmp/clear-postcode-check.csv; then cat /tmp/clear-postcode-check.csv; status=1; else echo "ok    no errors"; grep "WARNING" /tmp/clear-postcode-check.csv || true; fi

echo "== PHPCS (WordPress rules)"
docker run --rm -v "$PWD/..:/app" -w /app composer:2 sh -c '
  composer global config --no-interaction allow-plugins.dealerdirect/phpcodesniffer-composer-installer true >/dev/null 2>&1
  composer global require --quiet --no-interaction wp-coding-standards/wpcs:^3 phpcompatibility/phpcompatibility-wp:* >/dev/null 2>&1
  "$(composer global config home 2>/dev/null)/vendor/bin/phpcs" -q --standard=phpcs.xml.dist' && echo "ok    clean" || status=1
exit $status
