Effective systemd units as materialized on the production host at copy time (`systemctl cat …`).
Symlinks under /etc/systemd/system resolve to `/nix/store/...`; these snapshots are for reference and audits.

Rebuilds change store paths inside the units; regenerate after meaningful NixOS changes:

  for u in zacks-maids-node zacks-maids-db zacks-cleaners-docroot-sync zacks-cleaners-docroot-sync-apply \
           acme-zacks.cleaners.tesko.io acme-order-renew-zacks.cleaners.tesko.io; do
    systemctl cat "${u}.service" > "$(dirname "$0")/${u}.service"
  done
  systemctl cat acme-renew-zacks.cleaners.tesko.io.timer > "$(dirname "$0")/acme-renew-zacks.cleaners.tesko.io.timer"
