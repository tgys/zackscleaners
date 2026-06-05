#!/usr/bin/env bash
# Run on the NixOS host with sudo so ./zacks-maids-production.nix can own the Zack's Maids vhost
# (removes conflicting locations + obsolete demo-static unit from /etc/nixos/configuration.nix).
set -euo pipefail
CFG=/etc/nixos/configuration.nix
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(id -u)" -eq 0 ]] || exec sudo env CFG="$CFG" ROOT="$ROOT" bash "$0" "$@"

# Pass CFG as argv so `sudo bash this-script` works (shell vars are not exported to Python).
python3 - "$CFG" << 'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
text = p.read_text()
old_vhost = r'''
               virtualHosts."zacks.cleaners.tesko.io" = {
                 forceSSL = true;
                 enableACME = true;

                 extraConfig = ''
                   # TLS renew: systemd ACME timers renew certs; reloadServices reloads nginx (no renew in nginx itself).
                 '';

                 locations."/" = {
                   root = "/var/lib/zacks-cleaners";
                   extraConfig = ''
                     index demo.html;
                     add_header Cache-Control "public, max-age=300";
                   '';
                 };
               };

'''
old_systemd = r'''
             systemd.services.zacks-cleaners-demo-static = {
               description = "Copy Zack's Maids demo into nginx docroot";
               wantedBy = [ "multi-user.target" ];
               before = [ "nginx.service" ];
               after = [ "local-fs.target" ];
               serviceConfig = {
                 Type = "oneshot";
                 RemainAfterExit = true;
               };
               script = ''
                 set -euo pipefail
                 mkdir -p /var/lib/zacks-cleaners
                 if [[ -r /home/tbox/cleaning/demo.html ]]; then
                   cp -f /home/tbox/cleaning/demo.html /var/lib/zacks-cleaners/demo.html
                 fi
                 if [[ -r /home/tbox/cleaning/favicon.ico ]]; then
                   cp -f /home/tbox/cleaning/favicon.ico /var/lib/zacks-cleaners/favicon.ico
                 fi
                 if [[ -r /home/tbox/cleaning/apple-touch-icon.png ]]; then
                   cp -f /home/tbox/cleaning/apple-touch-icon.png /var/lib/zacks-cleaners/apple-touch-icon.png
                 fi
                 chmod 755 /var/lib/zacks-cleaners
                 chmod 644 /var/lib/zacks-cleaners/demo.html 2>/dev/null || true
                 chmod 644 /var/lib/zacks-cleaners/favicon.ico 2>/dev/null || true
                 chmod 644 /var/lib/zacks-cleaners/apple-touch-icon.png 2>/dev/null || true
               '';
             };


'''
if old_vhost not in text:
    raise SystemExit("patch-host: virtualHosts block not found (already patched or layout changed)")
text = text.replace(old_vhost, "\n", 1)
if old_systemd not in text:
    raise SystemExit("patch-host: zacks-cleaners-demo-static block not found (already patched or layout changed)")
text = text.replace(old_systemd, "\n", 1)
p.write_text(text)
print("patched:", p)
PY

install -m0644 "$ROOT/zacks-maids-production.nix" /etc/nixos/zacks-maids-production.nix
echo "installed: /etc/nixos/zacks-maids-production.nix from $ROOT"
echo "Next: cd /etc/nixos && sudo nixos-rebuild switch --flake .#nixos"
