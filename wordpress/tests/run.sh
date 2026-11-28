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
wp plugin install woocommerce --activate
wp plugin activate clear-postcode
echo "WordPress $(wp core version), WooCommerce $(wp plugin get woocommerce --field=version)"

status=0
wp eval-file /tests/integration.php || status=1

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
