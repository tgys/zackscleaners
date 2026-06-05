# Zack's Maids: nginx serves demo UI from disk; Node listens on localhost for /api only.
# Merge into your NixOS config (with services.zacksMaids.podmanDb or Docker DB already running):
#
#   imports = [ ./zacks-maids-production.nix ];
#   services.zacksMaidsProduction.enable = true;
#
# After code or .env edits:
#   sudo systemctl start zacks-maids-reload.service

{ config, lib, pkgs, ... }:

let
  cfg = config.services.zacksMaidsProduction;
  mailStack = cfg.enable && cfg.mail.enable;
  combinedMail = mailStack && config.services.reiMaidsProduction.enable && config.services.reiMaidsProduction.mail.enable;
in
{
  options.services.zacksMaidsProduction = {
    enable = lib.mkEnableOption ''
      Local Express API on 127.0.0.1, nginx reverse-proxy for /api on the Maids vhost,
      and sync static HTML/CSS/JS linked from the demo (demo, auth pages, bookings, overview)
      into the nginx docroot.
    '';

    domain = lib.mkOption {
      type = lib.types.str;
      default = "zacks.cleaners.tesko.io";
      description = "Must match existing services.nginx.virtualHosts.<name> TLS host.";
    };

    projectRoot = lib.mkOption {
      type = lib.types.str;
      default = "/home/tbox/cleaning";
      description = "Repo root (contains demo.html, auth pages, server/, .env).";
    };

    docroot = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/zacks-cleaners";
      description = "nginx root for the Maids site (static demo UI files).";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "tbox";
      description = "Unix user running Node (needs read access to projectRoot and .env).";
    };

    apiPort = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Loopback port for Express (nginx proxies /api here).";
    };

    mail = {
      enable = lib.mkEnableOption ''
        Local Postfix (loopback submission only) plus rspamd (DKIM signing via milter) for outgoing mail.
        Configure MAIL_FROM and SMTP_* in the repository `.env` (see option projectRoot).
        See nixos/README.txt for DNS (SPF, DKIM, DMARC).
      '';

      dkimSelector = lib.mkOption {
        type = lib.types.str;
        default = "mail";
        description = "DKIM selector; DNS TXT lives at <selector>._domainkey.<domain>.";
      };

      imapsPort = lib.mkOption {
        type = lib.types.port;
        default = 993;
        description = ''
          TCP port for IMAPS (TLS). Rei uses 2993 when both sites share Dovecot (maids-shared-mail.nix).
        '';
      };

      postfixHostname = lib.mkOption {
        type = lib.types.str;
        default = "mail.zacks.cleaners.tesko.io";
        description = ''
          Postfix myhostname / EHLO when this site is the primary in combined mail (maids-shared-mail.nix).
        '';
      };
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enable (let
      docrootSyncScript = ''
        set -euo pipefail
        PROOT="${cfg.projectRoot}"
        DOC="${cfg.docroot}"
        mkdir -p "$DOC"
        install -m0644 "$PROOT/demo.html" "$DOC/demo.html"
        install -m0644 "$PROOT/auth-client.js" "$DOC/auth-client.js"
        install -m0644 "$PROOT/auth.css" "$DOC/auth.css"
        install -m0644 "$PROOT/login.html" "$DOC/login.html"
        install -m0644 "$PROOT/register.html" "$DOC/register.html"
        install -m0644 "$PROOT/registration-complete.html" "$DOC/registration-complete.html"
        install -m0644 "$PROOT/forgot-password.html" "$DOC/forgot-password.html"
        install -m0644 "$PROOT/reset-password.html" "$DOC/reset-password.html"
        install -m0644 "$PROOT/verify-email.html" "$DOC/verify-email.html"
        install -m0644 "$PROOT/resend-verification.html" "$DOC/resend-verification.html"
        install -m0644 "$PROOT/bookings.html" "$DOC/bookings.html"
        install -m0644 "$PROOT/overview.html" "$DOC/overview.html"
        install -m0644 "$PROOT/overview.css" "$DOC/overview.css"
        install -m0644 "$PROOT/overview.js" "$DOC/overview.js"
        install -m0644 "$PROOT/all-users.html" "$DOC/all-users.html"
        install -m0644 "$PROOT/all-users.css" "$DOC/all-users.css"
        install -m0644 "$PROOT/all-users.js" "$DOC/all-users.js"
        if [[ -r "$PROOT/about.html" ]]; then
          install -m0644 "$PROOT/about.html" "$DOC/about.html"
        fi
        if [[ -r "$PROOT/favicon.ico" ]]; then
          install -m0644 "$PROOT/favicon.ico" "$DOC/favicon.ico"
        fi
        if [[ -r "$PROOT/apple-touch-icon.png" ]]; then
          install -m0644 "$PROOT/apple-touch-icon.png" "$DOC/apple-touch-icon.png"
        fi
        if [[ -r "$PROOT/user-svgrepo-com.svg" ]]; then
          install -m0644 "$PROOT/user-svgrepo-com.svg" "$DOC/user-svgrepo-com.svg"
        fi
      '';
    in {
      systemd.services.zacks-cleaners-docroot-sync = {
        description = "Sync Zack's Maids static site files into nginx docroot (boot). After edits: sudo systemctl start zacks-maids-reload.service";
        wantedBy = [ "multi-user.target" ];
        before = [ "nginx.service" ];
        after = [ "local-fs.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = docrootSyncScript;
      };

      systemd.services.zacks-cleaners-docroot-sync-apply = {
        description = "Copy zacks.cleaners.tesko.io static site files into nginx docroot (manual apply)";
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = false;
        };
        script = docrootSyncScript;
      };

      systemd.services.zacks-maids-reload = {
        description = "Re-sync zacks.cleaners.tesko.io static site and restart API (after code or .env edits)";
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = false;
          ExecStart = pkgs.writeShellScript "zacks-maids-reload" ''
            set -euo pipefail
            ${pkgs.systemd}/bin/systemctl start zacks-cleaners-docroot-sync-apply.service
            ${pkgs.systemd}/bin/systemctl restart zacks-maids-node.service
            ${pkgs.systemd}/bin/systemctl try-reload-or-restart nginx.service
          '';
        };
      };

      systemd.services.nginx = {
        requires = lib.mkAfter [ "zacks-cleaners-docroot-sync.service" ];
        after = lib.mkAfter [ "zacks-cleaners-docroot-sync.service" ];
      };

      systemd.services.zacks-maids-node = {
        description = "Zack's Maids Express API (loopback; nginx proxies /api)";
        after = [
          "network-online.target"
          "zacks-maids-db.service"
          "zacks-cleaners-docroot-sync.service"
        ];
        wants = [ "zacks-maids-db.service" ];
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

      services.nginx.appendHttpConfig = let
        nginxEmptyUpgrade = "'" + "'";
      in ''
        map $http_upgrade $connection_upgrade_zacks_maids {
          default upgrade;
          ${nginxEmptyUpgrade}      close;
        }
      '';

      services.nginx.virtualHosts.${cfg.domain} = {
        forceSSL = true;
        enableACME = true;
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
          extraConfig = ''
            try_files $uri $uri/ /index.html;
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
            proxy_set_header Connection $connection_upgrade_zacks_maids;
            proxy_redirect off;
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
          '';
        };
      };
    }))

    (lib.mkIf (mailStack && !combinedMail) {
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
            -d '${cfg.domain}' \
            -s '${cfg.mail.dkimSelector}' \
            -k "$key" \
            > "$dnsTxt"
          chmod 600 "$key"
          chmod 644 "$dnsTxt"
          chown rspamd:rspamd "$key" "$dnsTxt"
          echo "[rspamd-pre] DKIM DNS TXT saved to $dnsTxt (publish at ${cfg.mail.dkimSelector}._domainkey.${cfg.domain})" >&2
        fi
      '';

      services.postfix.enable = true;
      services.postfix.enableSubmission = false;
      services.postfix.enableSubmissions = false;
      services.postfix.settings.main = {
        myhostname = cfg.domain;
        mydomain = cfg.domain;
        myorigin = cfg.domain;
        mynetworks = [
          "127.0.0.0/8"
          "[::1]/128"
        ];
        mydestination = [ "localhost" ];
        inet_interfaces = "loopback-only";
        smtp_tls_security_level = "may";
        smtpd_recipient_restrictions = "permit_mynetworks, reject_unauth_destination";
      };

      systemd.services.postfix = {
        after = [ "rspamd.service" ];
        requires = [ "rspamd.service" ];
      };

      systemd.services.zacks-maids-node = {
        after = [
          "postfix.service"
          "rspamd.service"
        ];
        wants = [ "postfix.service" ];
      };
    })
  ];
}
