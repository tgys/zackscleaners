#!/usr/bin/env bash
# Copy static files nginx serves (same behavior as zacks-cleaners-docroot-sync on NixOS).
set -euo pipefail
PROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC="${ZACKS_NGINX_DOCROOT:-/var/lib/zacks-cleaners}"
mkdir -p "$DOC"
chmod 0755 "$DOC"

echo "[sync-zacks-nginx-docroot] PROOT=$PROOT DOC=$DOC" >&2

for req in demo.html about.html; do
  if [[ ! -r "$PROOT/$req" ]]; then
    echo "[sync-zacks-nginx-docroot] ERROR: missing \"$PROOT/$req\" — run git pull or copy repo root files from dev." >&2
    exit 1
  fi
done

sync_ext() {
  local ext="$1"
  local list
  list="$(mktemp)"
  find "$PROOT" -maxdepth 1 \( -type f -o -type l \) -name "*.$ext" > "$list"
  if ! grep -q . "$list"; then
    rm -f "$list"
    echo "[sync-zacks-nginx-docroot] ERROR: no *.$ext under \"$PROOT\"." >&2
    exit 1
  fi
  while IFS= read -r src; do
    [[ -n "$src" ]] || continue
    install -m0644 "$src" "$DOC/$(basename "$src")"
  done < "$list"
  rm -f "$list"
}

sync_ext html
sync_ext css
sync_ext js

install -m0644 "$PROOT/demo.html" "$DOC/demo.html"
install -m0644 "$PROOT/about.html" "$DOC/about.html"

[[ -r "$PROOT/favicon.ico" ]] && install -m0644 "$PROOT/favicon.ico" "$DOC/favicon.ico" || true
[[ -r "$PROOT/apple-touch-icon.png" ]] && install -m0644 "$PROOT/apple-touch-icon.png" "$DOC/apple-touch-icon.png" || true
[[ -r "$PROOT/user-svgrepo-com.svg" ]] && install -m0644 "$PROOT/user-svgrepo-com.svg" "$DOC/user-svgrepo-com.svg" || true

if [[ ! -f "$DOC/about.html" ]]; then
  echo "[sync-zacks-nginx-docroot] ERROR: about.html not written to \"$DOC\" after sync." >&2
  exit 1
fi

sum_line="$(sha256sum "$DOC/about.html")"
echo "[sync-zacks-nginx-docroot] $sum_line" >&2

echo "Synced site static files into $DOC"
