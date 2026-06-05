Mail apps (Android, etc.) still use the **public hostname** and port **993**, not 127.0.0.1.

**INFO_MAILDIR:** On NixOS with `mail.enable`, **`zacks-maids-node`** gets **`INFO_MAILDIR`** pointing at the info@ Maildir (`…/info/mail`). The API **imports those files first**, so Messages works **even when IMAPS on :993 is down**, as long as Postfix delivers into that Maildir. The app user is added to the **`vmail`** group so it can read the mailbox. After **`nixos-rebuild switch`**, run **`sudo systemctl restart zacks-maids-node`** so the new group membership applies.

Manual docroot sync without rebuild:`headless-server.nix` applies **`nixpkgs.overlays` with `lib.mkAfter`** so it overrides competing overlays; it (a)
forces **`mailutils`** checks off (**`doCheck` + noop `checkPhase`**) and (b) rebuilds **`emacs30*`** variants with
**`withMailutils = false`** when those attributes exist, so Emacs no longer pulls **`mailutils`** at all (fine unless you
need Emacs **`movemail`** on that host).
NixOS: Postgres via Docker Compose ("db" service; root Docker by default)
=========================================================================

1) Import the module from your real NixOS config.

   If you use a Nix flake with pure evaluation, you cannot import from
   /home/tbox/... — copy this file into your flake tree and import relatively:

     sudo cp /path/to/cleaning/nixos/zacks-maids.nix /etc/nixos/zacks-maids.nix

   Then in configuration.nix (or your flake’s nixosModules):

     imports = [ ./zacks-maids.nix ];
     services.zacksMaids.podmanDb = { enable = true; user = "…"; projectRoot = "…"; };
     # useDockerDaemon defaults to true (root Docker). Set useDockerDaemon = false for rootless Podman only.

   With impure nixos-rebuild only, an absolute path under $HOME can work; pure
   flakes will not.

2) Merge zacks-maids*.nix via your flake (see flake.nix) or `/etc/nixos/configuration.nix`, merge (do not delete your existing imports).
   Minimal bundle (only Zack’s Maids):

   imports = [
     ./hardware-configuration.nix
     ./configuration.zacks-snippet.example.nix
   ];

   This repo also tracks **`configuration.nix`**, which is the **full** piwibox `/etc/nixos/configuration.nix` snapshot,
   not portable as-is — use **`configuration.zacks-snippet.example.nix`** when wiring a fresh host.

   Easiest historically: import the bundle path under the repo tree:

     imports = [
       ./hardware-configuration.nix
       /home/tbox/cleaning/nixos/configuration.zacks-snippet.example.nix
     ];

   Or import only the module and set options yourself:

   imports = [
     ./hardware-configuration.nix
     /home/tbox/cleaning/nixos/zacks-maids.nix
   ];

   services.zacksMaids.podmanDb = {
     enable = true;
     useDockerDaemon = true;   # root Docker: avoids broken rootless cgroup trees (nested VPS)
     user = "tbox";
     projectRoot = "/home/tbox/cleaning";
   };

3) Rebuild:
     sudo nixos-rebuild switch
     (or your usual flake command, e.g. nixos-rebuild switch --flake /etc/nixos)

   Flake note: only if /etc/nixos is a *git* repo, Nix may ignore untracked files.
   Then run:  cd /etc/nixos && git add zacks-maids.nix configuration.nix
   If `git status` says "not a git repository", skip this — it does not apply.

4) Confirm the DB unit matches how you configured `useDockerDaemon`:

   Root Docker (default): **system** unit — inspect with:
     systemctl cat zacks-maids-db.service | grep -E '^ExecStart=|^User='|^Environment='

   ExecStart should invoke **docker-compose** from the Nix store against `docker-compose.yml`.

   Rootless Podman (`useDockerDaemon = false`): **user** unit — inspect with:
     systemctl --user cat zacks-maids-db.service | grep -E '^ExecStart='

   ExecStart should point at the nix-store **podman-up** shell script, not hand-edited compose.

5) Start Postgres after rebuild:

     sudo systemctl start zacks-maids-db.service    # root Docker (default)

   Podman-only (`useDockerDaemon = false`): enable user socket once per user, then log in / boot:
     systemctl --user enable --now podman.socket

6) Optional for Podman-only: point Docker-compatible CLIs at the user socket:
     export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock

Notes
-----
- Default path enables **virtualisation.docker** and starts the DB via **system**
  `zacks-maids-db` (root Docker).
- With `useDockerDaemon = false`, Podman + dockerCompat are enabled and the DB runs under
  **your user's** systemd (linger lets it start at boot).
- On a shared machine, every logged-in user would see the same user-unit name;
  for multi-user systems prefer Home Manager's systemd.user.services for one
  user only. This setup assumes a single primary dev account.

Session bus over SSH (systemctl --user)
---------------------------------------
- With fixSessionBusEnvInShell = true (default), the system installs the same
  XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS exports when /run/user/$UID exists.
  Login shells get /etc/profile.d/70-xdg-runtime-user.sh.
- Interactive zsh (common over SSH) reads /etc/zshrc: enable the NixOS zsh module
  so that hook is applied:

    programs.zsh.enable = true;

  Or set services.zacksMaids.podmanDb.fixSessionBusEnvInShell = false and add
  the two exports to ~/.zshrc yourself.


Production: nginx static demo + /api proxy to Node (zacks.cleaners.tesko.io)
--------------------------------------------------------------------------
Copy zacks-maids-production.nix into your flake or /etc/nixos, then:

  imports = [
    …
    ./zacks-maids-production.nix
  ];

  services.zacksMaidsProduction.enable = true;

Requires:
- services.nginx.virtualHosts.<same domain> already exists with TLS. The module **mkForce**s `location /` for the docroot:
  **Vue SPA** (default): `try_files $uri $uri/ /index.html` so `/demo.html`, `/messages.html`, … hit `index.html`.
  **Legacy-only** (`services.zacksMaidsProduction.vueFrontend.enable = false`): `rewrite` + `try_files $uri =404` as before.
  Do not keep a catch-all `proxy_pass` on `/` for this host (only `/api/` is proxied to Node).
- `npm install` in `${projectRoot}/server` (Node reads host node_modules).
- When **Vue SPA** is enabled (default): `${projectRoot}/frontend/package-lock.json` and network access during docroot-sync for **`npm ci`** (npm registry).
  The docroot-sync wrapper puts **`bash`** on **`PATH`** so **`npm`** can spawn **`sh`** (systemd has no **`/bin/sh`**).
- Repo-root **demo.html** and **about.html** must exist — they feed both the Vue legacy sync (`npm run build`) and legacy-only flat copy.
- Repo `.env` readable by the Node user (`DATABASE_URL`, `SESSION_SECRET`, etc.).

Effects:
- systemd **zacks-cleaners-docroot-sync** — fills `${docroot}` (default `/var/lib/zacks-cleaners`):
  • **Vue SPA** (`vueFrontend.enable`, default **true**): runs **`npm ci`** and **`npm run build`** in **`${projectRoot}/frontend`**, then **`rsync --delete`** from **`frontend/dist/`** into the docroot (SPA shell `index.html`, `/assets/*`, `/legacy/*`, shared CSS/JS copied by Vite).
    Ordered **after `network-online.target`** so npm can reach the registry on boot.
  • **Legacy-only** (`services.zacksMaidsProduction.vueFrontend.enable = false`): copies flat **`*.html`**, **`*.css`**, **`*.js`** from `projectRoot` into the docroot (previous behaviour).
  At boot this unit runs once and stays "active" (RemainAfterExit). A plain
  **`systemctl start zacks-cleaners-docroot-sync`** after boot does nothing — use
  **`sudo systemctl restart zacks-cleaners-docroot-sync`** or
  **`sudo systemctl start zacks-cleaners-docroot-sync-apply.service`** to rebuild/copy again.
  Journal logs **sha256sum** of **`docroot/index.html`** (Vue) or **`docroot/about.html`** (legacy-only).
- systemd **zacks-cleaners-docroot-sync-apply** — same script; safe **`systemctl start`** any time (always re-runs).
- systemd **zacks-maids-node** — Express on 127.0.0.1:$PORT with SERVE_STATIC=false (API only).
- nginx — **`location /`** serves **Vue SPA + legacy iframe assets** from the docroot (or legacy flat files); **`location /api/`** proxies to Node.

You can drop the old zacks-cleaners-demo-static unit if it only duplicated those copies.

Legacy-only rollback:

  services.zacksMaidsProduction.vueFrontend.enable = false;

Headless VPS (no XFCE / Mesa / intel-graphics-compiler pulls)
--------------------------------------------------------------
`nixos/configuration.nix` imports `./headless-server.nix` **last**, forcing X11/XFCE off, clearing GPU driver bundles,
empty VA/OpenCL extras, portals, and Xwayland — typical cure for huge rebuilds (`intel-graphics-compiler`) on tiny VPS RAM.

If you assemble `nixosConfigurations.<host>.modules` manually in a flake, either:

- import `…/cleaning/nixos/configuration.nix` **after** desktop-oriented modules, **or**
- append `./headless-server.nix` as the **final** module.

Then verify:

  nix eval .#nixosConfigurations.<host>.config.hardware.graphics.enable   # should be false
  nix eval .#nixosConfigurations.<host>.config.services.xserver.enable # should be false

Deprecation warnings naming `xfce.*` / `xorg.*` during `nixos-rebuild` usually mean another flake module still enables a
desktop stack — grep `/etc/nixos` for `xfce`, `xserver`, `desktopManager`, `displayManager`, `pipewire` (desktop audio),
and delete those imports on servers.

`headless-server.nix` also applies **`nixpkgs.overlays` with `lib.mkAfter`** so it wins over competing overlays; it (a)
forces **mailutils** checks off (`doCheck` + noop `checkPhase`) because its DEJAGNU tests can fail in the sandbox and
break dependents, and (b) rebuilds **emacs30** variants with **`withMailutils = false`** when those attributes exist, so
Emacs no longer pulls **mailutils** (fine unless you need Emacs **movemail** on that host). On a pure server, removing
**emacs** from `environment.systemPackages` avoids compiling it at all.

Transactional mail (Postfix + rspamd DKIM on the app host)
-----------------------------------------------------------
Requires a recent NixOS/nixpkgs Postfix module (structured `services.postfix.settings.main`; legacy `extraConfig` is removed upstream).

DKIM signing uses **rspamd** (not OpenDKIM). That avoids nixpkgs’ “insecure” OpenDKIM package and avoids relying on `nixpkgs.config.permittedInsecurePackages`, which **does not apply** when your flake pins `nixpkgs.pkgs` (see NixOS `nixpkgs` module: external `pkgs` ignores module `nixpkgs.config`).

Enable loopback-only Postfix and rspamd DKIM signing (no open relay; only 127.0.0.1 may submit):

  services.zacksMaidsProduction.mail.enable = true;

Optional: change the DKIM selector (default `mail`):

  services.zacksMaidsProduction.mail.dkimSelector = "mail";

In the repo `.env` on the server (same paths as `projectRoot`), prefer SMTP to localhost so the app does not use SendGrid:

  MAIL_FROM="Zack's Maids <noreply@zacks.cleaners.tesko.io>"
  PUBLIC_ORIGIN=https://zacks.cleaners.tesko.io
  SMTP_HOST=127.0.0.1
  SMTP_PORT=25
  SMTP_SECURE=0

Leave `SMTP_USER` and `SMTP_PASS` unset for trusted loopback submission.

After `nixos-rebuild switch`, publish DNS for deliverability:

  • DKIM: TXT at `<selector>._domainkey.<your Maids domain>`. On first boot the unit creates the private key
    `/var/lib/rspamd/dkim/<selector>.key` and writes the DNS record text to
    `/var/lib/rspamd/dkim/<selector>.dns.txt` (`rspamadm dkim_keygen` stdout).

    Publish:

      sudo cat /var/lib/rspamd/dkim/mail.dns.txt

    (Replace `mail` if you changed `mail.dkimSelector`.)

    If that path does not exist yet: `sudo systemctl status rspamd`, then `sudo ls -la /var/lib/rspamd/dkim/`.
    After syncing this repo module, `sudo systemctl restart rspamd` runs `preStart` again — it creates the key (if missing)
    or rebuilds only the `.dns.txt` file from the existing key when the DNS snippet was never saved.

  • SPF: TXT on the mail domain or subdomain you send From (often `@` or bare hostname), e.g.
    `v=spf1 a mx ip4:YOUR.VPS.PUBLIC.IP ~all` (tighten `-all` once verified).

  • DMARC: TXT at `_dmarc.<domain>`, e.g. `v=DMARC1; p=none; rua=mailto:postmaster@…`

Ensure the VPS reverse DNS (PTR) is sensible for the IP you send from; align SMTP banner / EHLO with PTR.
Postfix uses `services.zacksMaidsProduction.mail.postfixHostname` (default `mail.zacks.tesko.io`), not the Maids mail domain.

If outbound mail to Gmail fails with **550 5.7.1** / **IPv6AuthError** over **IPv6** while IPv4 delivery works, fix IPv6 PTR
and SPF alignment for your sending IPv6 address—or rely on the module default **`smtp_address_preference = ipv4`** so Postfix
prefers IPv4 when the recipient MX publishes both A and AAAA records.

Smoke tests:

  printf '%s\n' 'Subject: test' '' 'body' | sendmail -f noreply@zacks.cleaners.tesko.io you@gmail.com
  journalctl -u postfix -n 50 --no-pager
  journalctl -u rspamd -n 50 --no-pager

Inbound spam filtering is separate from this outbound relay; RBLs on port 25 matter only if you expose SMTP publicly.

Dovecot IMAP (same `services.zacksMaidsProduction.mail.enable`)
----------------------------------------------------------------
You also get Postfix on public :25, LMTP into Dovecot, and IMAPS on :993 (TLS = same ACME cert as nginx).
Postfix is given **virtual_mailbox_maps** for **info@** your Maids domain so external SMTP `RCPT TO` is accepted and mail is handed to LMTP (without this, Gmail can be rejected before Dovecot ever sees the message).
Virtual mailbox: **info@** your Maids domain; default IMAP password **cleaning12345** (hash in
`nixos/zacks-maids-production.nix` — edit and rebuild to change).

`.env` for the Messages page sync (same machine as Dovecot — use loopback; systemd also forces this when `mail.enable`):

  IMAP_HOST=127.0.0.1
  IMAP_TLS_SERVERNAME=zacks.cleaners.tesko.io
  IMAP_USER=info@zacks.cleaners.tesko.io
  IMAP_PASS=cleaning12345
  IMAP_PORT=993
  IMAP_TLS=1

Mail apps (Android, etc.) still use the **public hostname** and port **993**, not 127.0.0.1.

**INFO_MAILDIR (recommended for the web app):** With `mail.enable`, systemd sets **`INFO_MAILDIR`** on **`zacks-maids-node`** to the info@ Maildir (`…/info/mail`). The API ingests those files **before** trying IMAP, so the Messages inbox updates **even when `ECONNREFUSED` on :993**, as long as Postfix/LMTP delivers into that Maildir. The Node user is in the **`vmail`** group. After **`nixos-rebuild switch`**, run **`sudo systemctl restart zacks-maids-node`** so the new group applies (log out is not enough for an already-running service).

**LMTP Maildir path:** Sync uses ``${mailHome}/mail`` (e.g. ``/var/vmail/<domain>/info/mail``). NixOS **tmpfiles** create ``mail/new``, ``mail/cur``, and ``mail/tmp`` on boot so the path exists even before the first message. If you still see “No such file” after rebuild, run ``sudo systemd-tmpfiles --create`` once, or check ``ls /var/vmail`` and that **services.zacksMaidsProduction.domain** matches your MX host.

DNS: set **MX** for the domain to this VPS or inbound mail will not arrive.

Public IMAP for phone apps (e.g. Android Gmail / FairEmail)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
The website does **not** proxy IMAP. Mail apps open **TLS to Dovecot** on your VPS (same hostname as the site is fine if
that hostname’s **A/AAAA** records point at the machine where Dovecot runs).

**Android (typical settings)**

  • **Server / IMAP host:** your Maids domain, e.g. `zacks.cleaners.tesko.io` (must match the **certificate name** Dovecot presents — same ACME cert as nginx for that vhost when using this module).
  • **Port:** `993`
  • **Security:** SSL/TLS (IMAPS) — not “STARTTLS on 143” unless you add that separately.
  • **Username:** full address, e.g. `info@zacks.cleaners.tesko.io`
  • **Password:** the real mailbox password (see hashed default in `zacks-maids-production.nix` if you never changed it)
  • **SMTP** for sending from the same app: often **587** with STARTTLS and SMTP auth — this module’s focus is **inbound Postfix on :25** and **IMAPS**; outbound SMTP from clients may need extra Postfix `submission` listener and auth, or use another provider for “send” only.

**Making :993 actually reachable from the internet**

  1. In NixOS: `services.zacksMaidsProduction.enable = true` **and** `services.zacksMaidsProduction.mail.enable = true`, then `nixos-rebuild switch`. Mail stack disabled ⇒ no Dovecot listener ⇒ connection refused.
  2. On the VPS: `systemctl is-active dovecot2` (or `dovecot`), and `ss -tlnp | grep ':993'` — you should see Dovecot listening (adjust port if you set `mail.imapsPort`).
  3. **Cloud / hosting firewall:** open **TCP 993** to the world (and **25** if you want inbound SMTP). NixOS `networking.firewall` only applies on the VM; Hetzner/OVH/AWS **security groups** often still block 993 by default.
  4. Test from a **phone on cellular** or `openssl s_client -connect zacks.cleaners.tesko.io:993 -servername zacks.cleaners.tesko.io` from an external network (not only `localhost` on the server).

**Messages tab (Node) vs. mail apps**

  • When `services.zacksMaidsProduction.mail.enable = true`, **`zacks-maids-node`** sets **`IMAP_HOST=127.0.0.1`** so the API sync always talks to Dovecot on loopback (overrides the same variable in `.env`).
  • Android and other clients still use **`IMAP_HOST=<public hostname>`** and port **993** as above.
  • Dovecot is configured with **separate IMAPS listeners on `0.0.0.0` and `::`** so IPv4 clients (typical on cellular) see an open port even if `net.ipv6.bindv6only=1` would block IPv4 on a single `::` listener.

Manual docroot sync without rebuild:

  sudo bash /home/tbox/cleaning/scripts/sync-zacks-nginx-docroot.sh

Or after `nixos-rebuild`:

  sudo systemctl start zacks-cleaners-docroot-sync-apply.service

(static HTML/CSS/JS changes do not require reloading nginx.)
