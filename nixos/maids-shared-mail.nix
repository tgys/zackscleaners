# Shared Postfix + Dovecot + rspamd when both zacks.cleaners.tesko.io and rei.tesko.io
# run with mail.enable. Avoids the second site overwriting virtual_mailbox_maps / Dovecot passwd.
#
# Import after zacks-maids-production.nix and rei-maids-production.nix.

{ config, lib, pkgs, ... }:

let
  zacksCfg = config.services.zacksMaidsProduction;
  reiCfg = config.services.reiMaidsProduction;
  zacksMail = zacksCfg.enable && zacksCfg.mail.enable;
  reiMail = reiCfg.enable && reiCfg.mail.enable;
  combinedMail = zacksMail && reiMail;

  vmailUid = 5000;
  vmailGid = 5000;
  infoMailboxSha512 = "$6$GI8W/VCqc4yo7TZe$fZY0BaOqzjZFkUepeuwaZjyUrFefH03rBkA5KO1RFg9dtWujZdq85UI9V6zxznTrBC0G0qom46yPV/uLX67AN.";

  siteFor = cfg: {
    domain = cfg.domain;
    imapsPort = cfg.mail.imapsPort;
    dkimSelector = cfg.mail.dkimSelector;
    postfixHostname = cfg.mail.postfixHostname;
    infoMailUser = "info@${cfg.domain}";
    mailHome = "/var/vmail/${cfg.domain}/info";
    acmeCertDir = config.security.acme.certs.${cfg.domain}.directory;
    dkimKeyPath = "/var/lib/rspamd/dkim/${cfg.mail.dkimSelector}.${cfg.domain}.key";
    dkimDnsPath = "/var/lib/rspamd/dkim/${cfg.mail.dkimSelector}.${cfg.domain}.dns.txt";
  };

  zacksSite = siteFor zacksCfg;
  reiSite = siteFor reiCfg;
  primarySite = zacksSite;

  dovecotPasswdFile = pkgs.writeText "maids-combined-dovecot-passwd" ''
    ${zacksSite.infoMailUser}:${infoMailboxSha512}:${toString vmailUid}:${toString vmailGid}::${zacksSite.mailHome}::
    ${reiSite.infoMailUser}:${infoMailboxSha512}:${toString vmailUid}:${toString vmailGid}::${reiSite.mailHome}::
  '';

  imapListenerForSite = site: label: {
    # Single IPv6 listener — with net.ipv6.bindv6only=0 (this host), :: accepts IPv4 too.
    # Using 0.0.0.0 causes Dovecot 2.4 to also bind ::993, then fail on the explicit 0.0.0.0:993.
    "inet_listener imaps_${label}" = {
      listen = "::";
      port = site.imapsPort;
      ssl = true;
    };
  };

  dkimDomainBlock = site: ''
    "${site.domain}" {
      path = "${site.dkimKeyPath}";
      selector = "${site.dkimSelector}";
    }
  '';

  dkimPreStartFor = site: ''
    key="${site.dkimKeyPath}"
    dnsTxt="${site.dkimDnsPath}"
    if [[ ! -f "$key" ]]; then
      ${pkgs.rspamd}/bin/rspamadm dkim_keygen \
        -b 2048 \
        -d '${site.domain}' \
        -s '${site.dkimSelector}' \
        -k "$key" \
        > "$dnsTxt"
      chmod 600 "$key"
      chmod 644 "$dnsTxt"
      chown rspamd:rspamd "$key" "$dnsTxt"
      echo "[rspamd-pre] DKIM DNS TXT saved to $dnsTxt (publish at ${site.dkimSelector}._domainkey.${site.domain})" >&2
    elif [[ ! -f "$dnsTxt" ]] && [[ -f "$key" ]]; then
      pub=$(${pkgs.openssl}/bin/openssl rsa -in "$key" -pubout -outform DER 2>/dev/null | ${pkgs.coreutils}/bin/base64 -w0)
      printf '%s._domainkey.%s. IN TXT ( "v=DKIM1; k=rsa; " "p=%s" )\n' \
        '${site.dkimSelector}' '${site.domain}' "$pub" > "$dnsTxt"
      chmod 644 "$dnsTxt"
      chown rspamd:rspamd "$dnsTxt"
      echo "[rspamd-pre] Recreated missing DKIM DNS file at $dnsTxt" >&2
    fi
  '';

  maildirTmpfiles = site: [
    "d ${site.mailHome} 0770 vmail vmail -"
    "d ${site.mailHome}/mail 0770 vmail vmail -"
    "d ${site.mailHome}/mail/new 0770 vmail vmail -"
    "d ${site.mailHome}/mail/cur 0770 vmail vmail -"
    "d ${site.mailHome}/mail/tmp 0770 vmail vmail -"
  ];
in
{
  config = lib.mkIf combinedMail {
    users.users.vmail = {
      uid = vmailUid;
      group = "vmail";
      description = "Virtual mailboxes (Dovecot/Postfix)";
      isSystemUser = true;
    };
    users.groups.vmail.gid = vmailGid;

    users.users.${zacksCfg.user}.extraGroups = [ "vmail" ];

    systemd.tmpfiles.rules =
      [ "d /var/vmail 0755 root root -" ]
      ++ maildirTmpfiles zacksSite
      ++ maildirTmpfiles reiSite;

    networking.firewall.allowedTCPPorts = lib.unique [
      25
      zacksSite.imapsPort
      reiSite.imapsPort
    ];

    security.acme.certs.${zacksSite.domain}.reloadServices = lib.mkAfter [ "dovecot.service" ];
    security.acme.certs.${reiSite.domain}.reloadServices = lib.mkAfter [ "dovecot.service" ];

    services.dovecot2 = {
      enable = true;
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
        ssl_server_cert_file = "${primarySite.acmeCertDir}/fullchain.pem";
        ssl_server_key_file = "${primarySite.acmeCertDir}/key.pem";
        "local_name ${reiSite.domain}" = {
          ssl_server_cert_file = "${reiSite.acmeCertDir}/fullchain.pem";
          ssl_server_key_file = "${reiSite.acmeCertDir}/key.pem";
        };
        mail_driver = "maildir";
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
          ({
            _section.name = "imap-login";
            "inet_listener imap" = {
              port = 0;
            };
            # Disable nixpkgs/Dovecot default IMAPS on :993 before site-specific listeners.
            "inet_listener imaps" = {
              port = 0;
            };
          }
          // imapListenerForSite zacksSite "zacks"
          // imapListenerForSite reiSite "rei")
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

    services.rspamd.enable = lib.mkForce true;
    services.rspamd.postfix.enable = lib.mkForce true;

    services.rspamd.locals."dkim_signing.conf".text = lib.mkForce ''
      domain {
        ${dkimDomainBlock zacksSite}
        ${dkimDomainBlock reiSite}
      }
      sign_authenticated = true;
      sign_local = true;
      use_domain = "header";
      allow_username_mismatch = true;
    '';

    systemd.services.rspamd.preStart = lib.mkAfter ''
      install -d -m0700 -o rspamd -g rspamd /var/lib/rspamd/dkim
      ${dkimPreStartFor zacksSite}
      ${dkimPreStartFor reiSite}
    '';

    services.postfix.enable = lib.mkForce true;
    services.postfix.enableSubmission = lib.mkForce false;
    services.postfix.enableSubmissions = lib.mkForce false;
    services.postfix.mapFiles.virtual-mailbox = lib.mkForce (
      pkgs.writeText "maids-combined-vmailbox-map" ''
        ${zacksSite.infoMailUser} OK
        ${reiSite.infoMailUser} OK
      ''
    );

    services.postfix.settings.main = {
      myhostname = lib.mkForce primarySite.postfixHostname;
      smtp_helo_name = lib.mkForce primarySite.postfixHostname;
      mydomain = lib.mkForce primarySite.domain;
      myorigin = lib.mkForce primarySite.domain;
      mynetworks = [
        "127.0.0.0/8"
        "[::1]/128"
      ];
      mydestination = [ "localhost" ];
      inet_interfaces = "all";
      smtp_address_preference = "ipv4";
      smtp_tls_security_level = "may";
      smtpd_recipient_restrictions = "permit_mynetworks, reject_unauth_destination";
      virtual_mailbox_domains = lib.mkForce [
        zacksSite.domain
        reiSite.domain
      ];
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

    systemd.services.zacks-maids-node = {
      after = [
        "postfix.service"
        "rspamd.service"
        "dovecot.service"
      ];
      wants = [
        "postfix.service"
        "dovecot.service"
      ];
      environment = {
        IMAP_TLS_SERVERNAME = zacksSite.domain;
        INFO_MAILDIR = "${zacksSite.mailHome}/mail";
      };
      serviceConfig.SupplementaryGroups = [ "vmail" ];
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
      environment = {
        IMAP_TLS_SERVERNAME = reiSite.domain;
        INFO_MAILDIR = "${reiSite.mailHome}/mail";
      };
      serviceConfig.SupplementaryGroups = [ "vmail" ];
    };
  };
}
