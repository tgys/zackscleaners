# Zack's Maids: nginx serves demo UI from disk; Node listens on localhost for /api only.
# Merge into your NixOS config (with services.zacksMaids.podmanDb or Docker DB already running):
#
#   imports = [ ./zacks-maids-production.nix ];
#   services.reiMaidsProduction.enable = true;
#
# Optional mail stack (when services.reiMaidsProduction.mail.enable = true):
#   • Postfix on port 25 (internet + loopback): inbound for @domain → LMTP → Dovecot; outbound from Node (127.0.0.1).
#   • rspamd: DKIM signing.
#   • Dovecot: IMAPS (default port 993; override services.reiMaidsProduction.mail.imapsPort if busy), LMTP for Postfix, virtual mailbox info@domain.
#   • Firewall: TCP 25 and the configured IMAPS port opened.
#   • Set MX for the domain to this host if you want Internet delivery to info@.
# Default IMAP password for info@ is cleaning12345 (passwd hash is baked into this module; change by editing nix and rebuilding).
#
# Then set MAIL_FROM, PUBLIC_ORIGIN, SMTP_HOST=127.0.0.1, SMTP_PORT=25 in projectRoot/.env
# (see nixos/README.txt). After first boot, publish the DKIM TXT (rspamadm output in journal).
#
# Requires `npm install` in ${projectRoot}/server (impure host paths).
# Static UI: when vueFrontend.enable (default): docroot-sync runs `npm ci` + `npm run build` in
# ${projectRoot}/frontend and rsyncs dist/ into docroot (Vue SPA + legacy iframe assets).
# Repo-root demo.html / about.html must still exist — they are copied into the SPA during `npm run build`.
# Legacy-only mode (vueFrontend.enable = false): flat *.html / *.css / *.js from projectRoot as before.

{ config, lib, pkgs, ... }:

let
  cfg = config.services.reiMaidsProduction;
  mailStack = cfg.enable && cfg.mail.enable;
  combinedMail = mailStack && config.services.zacksMaidsProduction.enable && config.services.zacksMaidsProduction.mail.enable;
  vmailUid = 5000;
  vmailGid = 5000;
  acmeCertDir = config.security.acme.certs.${cfg.domain}.directory;
  # SHA512-CRYPT for "cleaning12345" (same as ADMIN_PASSWORD demo); change via `doveadm pw` + edit passwd if needed.
  infoMailboxSha512 = "$6$GI8W/VCqc4yo7TZe$fZY0BaOqzjZFkUepeuwaZjyUrFefH03rBkA5KO1RFg9dtWujZdq85UI9V6zxznTrBC0G0qom46yPV/uLX67AN.";
  infoMailUser = "info@${cfg.domain}";
  mailHome = "/var/vmail/${cfg.domain}/info";
  dovecotPasswdFile = pkgs.writeText "rei-maids-dovecot-passwd" ''
    ${infoMailUser}:${infoMailboxSha512}:${toString vmailUid}:${toString vmailGid}::${mailHome}::
  '';
in
{
  options.services.reiMaidsProduction = {
    enable = lib.mkEnableOption ''
      Local Express API on 127.0.0.1, nginx reverse-proxy for /api on the Maids vhost,
      and sync static HTML/CSS/JS linked from the demo (demo, auth pages, bookings, overview)
      into the nginx docroot.
    '';

    domain = lib.mkOption {
      type = lib.types.str;
      default = "rei.tesko.io";
      description = "Must match existing services.nginx.virtualHosts.<name> TLS host.";
    };

    projectRoot = lib.mkOption {
      type = lib.types.str;
      default = "/home/tbox/rei";
      description = "Repo root (contains demo.html, auth pages, server/, .env).";
    };

    docroot = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/rei";
      description = "nginx root for the Maids site (static demo UI files).";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "tbox";
      description = "Unix user running Node (needs read access to projectRoot and .env).";
    };

    apiPort = lib.mkOption {
      type = lib.types.port;
      default = 3001;
      description = "Loopback port for Express (nginx proxies /api here).";
    };

    vueFrontend.enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        When true (default), **rei-docroot-sync** runs ``npm ci`` and ``npm run build`` in
        ``projectRoot/frontend``, then ``rsync --delete`` from ``frontend/dist/`` into ``docroot``.
        Requires network access during sync (npm registry). When false, restores the previous behaviour:
        copy ``*.html``, ``*.css``, ``*.js`` from ``projectRoot`` into ``docroot`` only.
      '';
    };

    mail = {
      enable = lib.mkEnableOption ''
        Postfix on port 25 (internet and loopback), rspamd DKIM, and Dovecot (IMAPS + LMTP delivery; IMAPS port defaults to 993, see imapsPort).
        Creates virtual mailbox info @ the configured Maids domain with default IMAP password cleaning12345
        (change by editing the hashed password in zacks-maids-production.nix and rebuilding).
        Set MAIL_FROM and SMTP_* in the repository .env. Publish MX to this host for inbound mail. See nixos/README.txt for DNS (SPF, DKIM, DMARC).
      '';

      dkimSelector = lib.mkOption {
        type = lib.types.str;
        default = "mail";
        description = "DKIM selector; DNS TXT lives at <selector>._domainkey.<domain>.";
      };

      imapsPort = lib.mkOption {
        type = lib.types.port;
        default = 2993;
        description = ''
          TCP port for IMAPS (TLS). If Dovecot fails with "listen(*, 993): Address already in use",
          set this to a free port (e.g. 2993) and set IMAP_PORT in projectRoot/.env to match.
          Find the conflicting process with: ss -ltnp | grep ':993'
        '';
      };

      postfixHostname = lib.mkOption {
        type = lib.types.str;
        default = "mail.rei.tesko.io";
        description = ''
          Postfix `myhostname` (SMTP banner / EHLO unless overridden). Must match VPS PTR and forward DNS (A/AAAA)
          for this machine's public IP(s).
        '';
      };
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enable (let
      useVueSpa = cfg.vueFrontend.enable;
      docrootSyncExe = pkgs.writeShellScript "rei-docroot-sync" ''
        export PATH="${
          lib.makeBinPath (
            [
              pkgs.bash
              pkgs.coreutils
              pkgs.findutils
              pkgs.gnugrep
              pkgs.rsync
            ]
            ++ lib.optionals useVueSpa [ pkgs.nodejs ]
          )
        }"
        set -euo pipefail
        PROOT="${cfg.projectRoot}"
        DOC="${cfg.docroot}"
        USE_VUE="${if useVueSpa then "true" else "false"}"
        mkdir -p "$DOC"
        # nginx runs as an unprivileged user — it needs search bit on every path component.
        chmod 0755 "$DOC"

        RUN_LOG=/run/rei-docroot-sync-last.txt
        printf '%s\n' "$(date -Is)" "PROOT=$PROOT DOC=$DOC USE_VUE=$USE_VUE (started)" > "$RUN_LOG"
        chmod 0644 "$RUN_LOG"

        echo "[rei-docroot-sync] PROOT=$PROOT DOC=$DOC USE_VUE=$USE_VUE"
        echo "PROOT=$PROOT DOC=$DOC USE_VUE=$USE_VUE" | ${pkgs.systemd}/bin/systemd-cat -t rei-docroot-sync -p info

        for req in demo.html about.html; do
          if [[ ! -r "$PROOT/$req" ]]; then
            echo "[rei-docroot-sync] ERROR: missing \"$PROOT/$req\" — required for Vue legacy sync + legacy flat copy."
            exit 1
          fi
        done

        if [[ "$USE_VUE" == "true" ]]; then
          FRONT="$PROOT/frontend"
          if [[ ! -f "$FRONT/package.json" ]] || [[ ! -f "$FRONT/package-lock.json" ]]; then
            echo "[rei-docroot-sync] ERROR: Vue frontend missing \"$FRONT/package.json\" or package-lock.json"
            exit 1
          fi
          echo "[rei-docroot-sync] npm ci + npm run build in \"$FRONT\""
          ( cd "$FRONT" && npm ci && npm run build )
          if [[ ! -f "$FRONT/dist/index.html" ]]; then
            echo "[rei-docroot-sync] ERROR: build produced no \"$FRONT/dist/index.html\""
            exit 1
          fi
          echo "[rei-docroot-sync] rsync --delete dist/ → \"$DOC\""
          rsync -a --delete "$FRONT/dist/" "$DOC/"
          chmod -R a+rX "$DOC" 2>/dev/null || true
          verify="$DOC/index.html"
          sum_line="$(sha256sum "$verify")"
        else
          sync_ext() {
            local ext="$1"
            local list
            list="$(mktemp)"
            find "$PROOT" -maxdepth 1 \( -type f -o -type l \) -name "*.$ext" > "$list"
            if ! grep -q . "$list"; then
              rm -f "$list"
              echo "[rei-docroot-sync] ERROR: no *.$ext under \"$PROOT\"."
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

          if [[ -r "$PROOT/favicon.ico" ]]; then
            install -m0644 "$PROOT/favicon.ico" "$DOC/favicon.ico"
          fi
          if [[ -r "$PROOT/apple-touch-icon.png" ]]; then
            install -m0644 "$PROOT/apple-touch-icon.png" "$DOC/apple-touch-icon.png"
          fi
          if [[ -r "$PROOT/user-svgrepo-com.svg" ]]; then
            install -m0644 "$PROOT/user-svgrepo-com.svg" "$DOC/user-svgrepo-com.svg"
          fi
          if [[ -r "$PROOT/email-banner-logo-static.svg" ]]; then
            install -m0644 "$PROOT/email-banner-logo-static.svg" "$DOC/email-banner-logo-static.svg"
          fi
          if [[ -d "$PROOT/gallery" ]]; then
            mkdir -p "$DOC/gallery"
            rsync -a "$PROOT/gallery/" "$DOC/gallery/"
          fi
          if [[ -d "$PROOT/logo" ]]; then
            mkdir -p "$DOC/logo"
            rsync -a "$PROOT/logo/" "$DOC/logo/"
          fi

          verify="$DOC/about.html"
          if [[ ! -f "$verify" ]]; then
            echo "[rei-docroot-sync] ERROR: about.html not written to \"$DOC\" after sync."
            exit 1
          fi
          sum_line="$(sha256sum "$verify")"
        fi

        ls -la "$verify"
        echo "[rei-docroot-sync] $sum_line"
        echo "$sum_line" | ${pkgs.systemd}/bin/systemd-cat -t rei-docroot-sync -p info
        {
          printf '%s\n' "$(date -Is)" "PROOT=$PROOT DOC=$DOC USE_VUE=$USE_VUE (finished)"
          ls -la "$verify"
          printf '%s\n' "$sum_line"
        } >> "$RUN_LOG"
        chmod 0644 "$RUN_LOG"
      '';
    in {
    # Ensure docroot is traversable by nginx (mode 0755) before sync / nginx run.
    systemd.tmpfiles.rules = [ "d ${cfg.docroot} 0755 root root -" ];

    systemd.services.rei-docroot-sync = {
      description = "Sync rei.tesko.io static files into nginx docroot (boot). After edits: sudo systemctl start rei-maids-reload.service";
      wantedBy = [ "multi-user.target" ];
      before = [ "nginx.service" ];
      after =
        [ "local-fs.target" ]
        ++ lib.optionals cfg.vueFrontend.enable [ "network-online.target" ];
      wants = lib.optionals cfg.vueFrontend.enable [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${docrootSyncExe}";
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "rei-docroot-sync";
      };
    };

    # Same script as rei-docroot-sync but RemainAfterExit=no so every `systemctl start` re-copies.
    systemd.services.rei-docroot-sync-apply = {
      description = "Copy rei.tesko.io static site files into nginx docroot (manual apply)";
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = false;
        ExecStart = "${docrootSyncExe}";
        StandardOutput = "journal";
        StandardError = "journal";
        SyslogIdentifier = "rei-docroot-sync";
      };
    };

    # After code or .env edits: re-sync docroot, restart API, reload nginx (same pattern as zacks-maids-reload).
    systemd.services.rei-maids-reload = {
      description = "Re-sync rei.tesko.io static site and restart API (after code or .env edits)";
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = false;
        ExecStart = pkgs.writeShellScript "rei-maids-reload" ''
          set -euo pipefail
          ${pkgs.systemd}/bin/systemctl start rei-docroot-sync-apply.service
          ${pkgs.systemd}/bin/systemctl restart rei-maids-node.service
          ${pkgs.systemd}/bin/systemctl try-reload-or-restart nginx.service
        '';
      };
    };

    # Do not serve stale/empty docroot: nginx waits for a successful sync at boot.
    systemd.services.nginx = {
      requires = lib.mkAfter [ "rei-docroot-sync.service" ];
      after = lib.mkAfter [ "rei-docroot-sync.service" ];
    };

    # WebSocket admin Messages → Node (/api/admin/messages-ws).
    # nginx map needs an empty-string key `''` — awkward inside a Nix `''` string; use antiquotation.
    services.nginx.appendHttpConfig = let
      # nginx map key for "no Upgrade header" must be two single quotes; spell without `''''` in a '' string.
      nginxEmptyUpgrade = "'" + "'";
    in ''
      map $http_upgrade $connection_upgrade_rei_maids {
        default upgrade;
        ${nginxEmptyUpgrade}      close;
      }
    '';

    systemd.services.rei-maids-node = {
      description = "Zack's Maids Express API (loopback; nginx proxies /api)";
      after = [
        "network-online.target"
        "rei-maids-db.service"
        "rei-docroot-sync.service"
      ];
      wants = [ "rei-maids-db.service" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        NODE_ENV = "production";
        SERVE_STATIC = "false";
        LISTEN_HOST = "127.0.0.1";
        TRUST_PROXY = "1";
        PORT = toString cfg.apiPort;
      };
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = "users";
        WorkingDirectory = "${cfg.projectRoot}/server";
        EnvironmentFile = "${cfg.projectRoot}/.env";
        ExecStart = "${lib.getExe pkgs.nodejs} ${cfg.projectRoot}/server/src/index.js";
        Restart = "on-failure";
        RestartSec = "4";
      };
    };

      # One assignment per vhost name — Nix rejects multiple `virtualHosts.''${domain}.locations…` lines in the same attrset.
      services.nginx.virtualHosts.${cfg.domain} = {
        forceSSL = true;
        enableACME = true;
        # Appended after structured `locations.*` so a conflicting merge on the host cannot drop it.
        extraConfig = lib.mkAfter ''
          # TLS renew: systemd ACME timers renew certs; reloadServices reloads nginx (no renew in nginx itself).
          location = / {
            return 302 /demo.html;
          }
        '';
        locations."/" = lib.mkForce {
          root = cfg.docroot;
          index = lib.mkForce null;
          tryFiles = lib.mkForce null;
          extraConfig =
            if cfg.vueFrontend.enable then ''
              try_files $uri $uri/ /index.html;
              add_header Cache-Control "no-store, max-age=0" always;
            '' else ''
              rewrite ^/$ /demo.html last;
              try_files $uri =404;
              add_header Cache-Control "no-store, max-age=0" always;
            '';
        };
        locations."= /about" = {
          priority = 20;
          return = "302 /about.html";
        };
        locations."= /about/" = {
          priority = 20;
          return = "302 /about.html";
        };
        locations."/api/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.apiPort}";
          extraConfig = ''
            client_max_body_size 2m;
            proxy_buffering off;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade_rei_maids;
            proxy_redirect off;
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
          '';
        };
      };
    }))

    (lib.mkIf (mailStack && !combinedMail) {
      users.users.vmail = {
        uid = vmailUid;
        group = "vmail";
        description = "Zack's Maids virtual mailbox (Dovecot/Postfix)";
        isSystemUser = true;
      };
      users.groups.vmail.gid = vmailGid;

      users.users.${cfg.user}.extraGroups = [ "vmail" ];

      systemd.tmpfiles.rules = [
        "d /var/vmail 0755 root root -"
        "d ${mailHome} 0770 vmail vmail -"
        # Maildir tree (LMTP/Dovecot expect new/cur/tmp; may not exist until first delivery otherwise).
        "d ${mailHome}/mail 0770 vmail vmail -"
        "d ${mailHome}/mail/new 0770 vmail vmail -"
        "d ${mailHome}/mail/cur 0770 vmail vmail -"
        "d ${mailHome}/mail/tmp 0770 vmail vmail -"
      ];

      networking.firewall.allowedTCPPorts = [
        25
        cfg.mail.imapsPort
      ];

      security.acme.certs.${cfg.domain}.reloadServices = lib.mkAfter [ "dovecot.service" ];

      services.dovecot2 = {
        enable = true;
        # NixOS defaults to dovecot_2_3 when stateVersion < 26.05; this module’s settings are 2.4-only.
        package = pkgs.dovecot;
        enablePAM = false;
        createMailUser = false;
        settings = {
          dovecot_config_version = config.services.dovecot2.package.version;
          dovecot_storage_version = config.services.dovecot2.package.version;
          protocols = {
            imap = true;
            lmtp = true;
          };
          ssl = true;
          ssl_server_cert_file = "${acmeCertDir}/fullchain.pem";
          ssl_server_key_file = "${acmeCertDir}/key.pem";
          mail_driver = "maildir";
          # Relative paths without ~/ resolve against Dovecot base_dir (/run/dovecot2), breaking LMTP delivery.
          mail_path = "~/mail";
          mail_uid = "vmail";
          mail_gid = "vmail";
          "namespace inbox" = {
            inbox = true;
            separator = "/";
          };
          auth_mechanisms = [
            "plain"
            "login"
          ];
          "passdb passwd-file" = {
            default_password_scheme = "SHA512-CRYPT";
            passwd_file_path = "${dovecotPasswdFile}";
          };
          "userdb passwd-file" = {
            passwd_file_path = "${dovecotPasswdFile}";
          };
          service = [
            {
              _section.name = "imap-login";
              # Plain IMAP disabled; IMAPS on imapsPort. Two listeners so IPv4 clients work even when
              # net.ipv6.bindv6only=1 (a single "::" socket would not accept IPv4 — common cause of
              # "993 works on localhost but connection refused from the internet on Android/cellular").
              "inet_listener imap" = {
                port = 0;
              };
              "inet_listener imaps" = {
                listen = "0.0.0.0";
                port = cfg.mail.imapsPort;
                ssl = true;
              };
              "inet_listener imaps_ipv6" = {
                listen = "::";
                port = cfg.mail.imapsPort;
                ssl = true;
              };
            }
            {
              _section.name = "lmtp";
              "unix_listener lmtp" = {
                path = "/var/lib/postfix/queue/private/dovecot-lmtp";
                mode = "0600";
                user = "postfix";
                group = "postfix";
              };
            }
          ];
        };
      };

      users.users.dovecot2.extraGroups = [ config.security.acme.defaults.group ];

      # rspamd signs outbound mail (DKIM) and attaches as a Postfix milter. Avoids OpenDKIM, which nixpkgs marks insecure
      # and which flakes often cannot whitelist when `nixpkgs.pkgs` is pinned (module `nixpkgs.config` is ignored).

      services.rspamd.enable = true;
      services.rspamd.postfix.enable = true;

      services.rspamd.locals."dkim_signing.conf".text = ''
        domain {
          "${cfg.domain}" {
            path = "/var/lib/rspamd/dkim/${cfg.mail.dkimSelector}.key";
            selector = "${cfg.mail.dkimSelector}";
          }
        }
        sign_authenticated = true;
        sign_local = true;
        use_domain = "header";
        allow_username_mismatch = true;
      '';

      systemd.services.rspamd.preStart = lib.mkAfter ''
        install -d -m0700 -o rspamd -g rspamd /var/lib/rspamd/dkim
        key="/var/lib/rspamd/dkim/${cfg.mail.dkimSelector}.key"
        dnsTxt="/var/lib/rspamd/dkim/${cfg.mail.dkimSelector}.dns.txt"
        if [[ ! -f "$key" ]]; then
          ${pkgs.rspamd}/bin/rspamadm dkim_keygen \
            -b 2048 \
            -d '${cfg.domain}' \
            -s '${cfg.mail.dkimSelector}' \
            -k "$key" \
            > "$dnsTxt"
          chmod 600 "$key"
          chmod 644 "$dnsTxt"
          chown rspamd:rspamd "$key" "$dnsTxt"
          echo "[rspamd-pre] DKIM DNS TXT saved to $dnsTxt (publish at ${cfg.mail.dkimSelector}._domainkey.${cfg.domain})" >&2
        elif [[ ! -f "$dnsTxt" ]] && [[ -f "$key" ]]; then
          pub=$(${pkgs.openssl}/bin/openssl rsa -in "$key" -pubout -outform DER 2>/dev/null | ${pkgs.coreutils}/bin/base64 -w0)
          printf '%s._domainkey.%s. IN TXT ( "v=DKIM1; k=rsa; " "p=%s" )\n' \
            '${cfg.mail.dkimSelector}' '${cfg.domain}' "$pub" > "$dnsTxt"
          chmod 644 "$dnsTxt"
          chown rspamd:rspamd "$dnsTxt"
          echo "[rspamd-pre] Recreated missing DKIM DNS file at $dnsTxt" >&2
        fi
      '';

      services.postfix.enable = true;
      services.postfix.enableSubmission = false;
      services.postfix.enableSubmissions = false;
      services.postfix.mapFiles.virtual-mailbox = pkgs.writeText "rei-maids-vmailbox-map" ''
        ${infoMailUser} OK
      '';

      services.postfix.settings.main = {
        # mkForce: vpsAdminOS/container stacks often tie mailname/host identity to networking.hostName (Maids domain).
        myhostname = lib.mkForce cfg.mail.postfixHostname;
        smtp_helo_name = cfg.mail.postfixHostname;
        mydomain = cfg.domain;
        myorigin = cfg.domain;
        mynetworks = [
          "127.0.0.0/8"
          "[::1]/128"
        ];
        mydestination = [ "localhost" ];
        inet_interfaces = "all";
        # Prefer IPv4 for outbound SMTP. Gmail (and others) enforce stricter checks on IPv6
        # (PTR + auth alignment); when only IPv4 is fully compliant, dual-stack MX targets
        # otherwise randomize/balance and can bounce with 5.7.1 IPv6AuthError.
        smtp_address_preference = "ipv4";
        smtp_tls_security_level = "may";
        smtpd_recipient_restrictions = "permit_mynetworks, reject_unauth_destination";
        virtual_mailbox_domains = [ cfg.domain ];
        virtual_mailbox_maps = [ "hash:/etc/postfix/virtual-mailbox" ];
        virtual_transport = "lmtp:unix:private/dovecot-lmtp";
        lmtp_destination_recipient_limit = 1;
      };

      systemd.services.postfix = {
        after = [
          "rspamd.service"
          "dovecot.service"
        ];
        requires = [ "rspamd.service" ];
        wants = [ "dovecot.service" ];
      };

      systemd.services.rei-maids-node = {
        after = [
          "postfix.service"
          "rspamd.service"
          "dovecot.service"
        ];
        wants = [
          "postfix.service"
          "dovecot.service"
        ];
        # IMAP_TLS_SERVERNAME: Dovecot presents ACME cert for cfg.domain; required for TLS when IMAP_HOST is a loopback address.
        # INFO_MAILDIR: import LMTP-delivered mail without IMAP (readable with SupplementaryGroups = vmail).
        environment = {
          IMAP_TLS_SERVERNAME = cfg.domain;
          INFO_MAILDIR = "${mailHome}/mail";
        };
        serviceConfig = {
          SupplementaryGroups = [ "vmail" ];
        };
      };
    })
  ];
}
