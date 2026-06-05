#!/usr/bin/env bash
# Deploy zacks.cleaners.tesko.io after code changes. Run on the host as root or with sudo.
set -euo pipefail

ZACKS_ROOT="/home/tbox/cleaning"
ETC_NIXOS="/etc/nixos"

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    systemd-run -t --wait --pty -p User=root bash -lc "$(printf '%q ' "$@")"
  fi
}

echo "[1/5] Sync Nix modules from repo → /etc/nixos"
for f in flake.nix flake.lock maids-shared-mail.nix zacks-maids.nix zacks-maids-production.nix rei-maids.nix rei-maids-production.nix headless-server.nix; do
  run_root command cp -f "$ZACKS_ROOT/nixos/$f" "$ETC_NIXOS/$f"
done

echo "[2/5] nixos-rebuild (shared Dovecot/Postfix for both domains)"
run_root nixos-rebuild switch --flake "$ETC_NIXOS#piwibox" || true

echo "[3/5] Reset dovecot start limit if needed"
run_root systemctl reset-failed dovecot.service 2>/dev/null || true
run_root pkill -9 dovecot 2>/dev/null || true

echo "[4/5] Sync Vue docroot + restart app/mail services"
run_root systemctl start zacks-maids-reload.service || {
  run_root systemctl start zacks-cleaners-docroot-sync-apply.service
  run_root systemctl restart zacks-maids-node.service
  run_root systemctl try-reload-or-restart nginx.service
}
run_root systemctl restart dovecot postfix rspamd

echo "[5/5] Status"
systemctl is-active dovecot postfix rspamd zacks-maids-node rei-maids-node nginx
echo "zacks mail env:" && systemctl show zacks-maids-node -p Environment | tr ' ' '\n' | grep -E 'INFO_MAILDIR|IMAP_TLS'
ss -ltnp | grep -E ':993|:2993|:25 ' || true
