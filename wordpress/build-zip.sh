#!/usr/bin/env bash
# The plugin as WordPress installs it: dist/clear-postcode.zip with the folder clear-postcode/ at the zip root (the
# GitHub release asset behind https://github.com/clearpostcode/postcode-api/releases/latest/download/clear-postcode.zip).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../dist
out="$(cd ../dist && pwd)/clear-postcode.zip"
zip -qrXFS "$out" clear-postcode -x '*.DS_Store'
echo "$out ($(grep -m1 'Stable tag' clear-postcode/readme.txt))"
