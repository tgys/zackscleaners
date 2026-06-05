# zacks.cleaners.tesko.io (Zack's Maids)

Node/Express API, Vue SPA frontend, Postgres, and NixOS deployment modules for **`zacks.cleaners.tesko.io`**.

- **App**: `server/`, migrations in `migrations/`, frontend in `frontend/`.
- **NixOS**: `nixos/` — modules plus `flake.nix` used on production (see `nixos/DEPLOYMENT_FILES.txt`).
- **Systemd snapshots**: `nixos/systemd-effective/` — rendered units from `systemctl cat` at capture time.

`.env` is **not** committed (see `.env.example`). Secrets stay on the server.

## Database (local dev)

```bash
docker compose up -d db
docker compose run --rm migrate
cp .env.example .env   # edit DATABASE_URL if needed
cd server && npm install && node index.js
```

Postgres listens on **5433** with database `zacks_maids` (see `docker-compose.yml`).

## Mail (shared stack with rei.tesko.io)

Both sites share Postfix + Dovecot + rspamd via `nixos/maids-shared-mail.nix`:

- **Outbound**: `SMTP_HOST=127.0.0.1`, `MAIL_FROM` / `MAIL_FROM_INFO` use `@zacks.cleaners.tesko.io`.
- **Inbound info@**: Postfix → LMTP → `/var/vmail/zacks.cleaners.tesko.io/info/mail` (`INFO_MAILDIR`).
- **IMAP**: port **993** (rei uses 2993 on the same host).

After `nixos-rebuild switch`, restart `zacks-maids-node` so the `vmail` group membership applies.

**After code or `.env` edits:**

```bash
sudo systemctl start zacks-maids-reload.service
```

Or run `./scripts/deploy-zacks.sh` on the host.

## NixOS deploy

Copy modules to `/etc/nixos` and rebuild:

```bash
./scripts/deploy-zacks.sh
```

See `nixos/README.txt` for Postgres via Docker, docroot sync, and DNS (SPF/DKIM/DMARC).
