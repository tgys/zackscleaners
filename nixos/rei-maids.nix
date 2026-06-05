{ config, lib, pkgs, ... }:

let
  cfg = config.services.reiMaids.podmanDb;
  composeFile = "${cfg.projectRoot}/docker-compose.yml";

  # docker-compose + Podman socket can be flaky on nested hosts; Podman backend uses plain
  # `podman run`. Keep fields aligned with docker-compose.yml when using Docker backend too.
  projectSlug =
    lib.last (lib.splitString "/" (lib.removeSuffix "/" cfg.projectRoot));
  composeVolume = "${projectSlug}_rei_pgdata";
  dbContainer = "${projectSlug}-db-1";

  reiMaidsPodmanUp = pkgs.writeShellScript "rei-maids-db-podman-up" ''
    set -euo pipefail
    PODMAN="${lib.getExe pkgs.podman}"
    vol="${composeVolume}"
    ctr="${dbContainer}"
    "$PODMAN" volume inspect "$vol" >/dev/null 2>&1 || "$PODMAN" volume create "$vol"
    exec "$PODMAN" run -d \
      --name "$ctr" \
      --replace \
      -e POSTGRES_USER=rei \
      -e POSTGRES_PASSWORD=rei_dev \
      -e POSTGRES_DB=rei_maids \
      -p 5434:5432 \
      -v "$vol:/var/lib/postgresql/data" \
      docker.io/library/postgres:16-alpine
  '';

  reiMaidsPodmanStop = pkgs.writeShellScript "rei-maids-db-podman-stop" ''
    set -euo pipefail
    exec "${lib.getExe pkgs.podman}" stop -t 60 "${dbContainer}" || true
  '';

  # When /run/user/$UID exists but pam/SSH did not set session env (common over SSH),
  # systemctl --user needs these. See nixos/README.txt.
  sessionBusEnvSnippet = ''
    if [ -z "''${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
      export XDG_RUNTIME_DIR="/run/user/$(id -u)"
      export DBUS_SESSION_BUS_ADDRESS="unix:path=''${XDG_RUNTIME_DIR}/bus"
    fi
  '';
in
{
  options.services.reiMaids.podmanDb = {
    enable = lib.mkEnableOption ''
      Dev Postgres for rei.tesko.io: **root Docker** (default) uses a **system** unit
      (`rei-maids-db`); set useDockerDaemon to false for rootless Podman (**user** unit).
      See nixos/README.txt.
    '';

    useDockerDaemon = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        If true (default), run **docker-compose** against root Docker via **systemd**
        service `rei-maids-db` as option `user`, with the `docker` supplementary group.
        Prefer this on NixOS when rootless Podman hits cgroup errors (e.g. nested VPS).

        If false, enable Podman with dockerCompat and start Postgres from that user's
        systemd user unit instead.

        Enables `virtualisation.docker` (mkDefault) when true and forces Podman
        `dockerCompat` off so nixpkgs’ Docker/Podman assertion passes.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "tbox";
      description = "Login name: Podman path runs as this user’s systemd; Docker path runs systemd service as this User.";
    };

    projectRoot = lib.mkOption {
      type = lib.types.str;
      default = "/home/tbox/rei";
      description = "Absolute path to the repo (must contain docker-compose.yml).";
    };

    fixSessionBusEnvInShell = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Install small shell snippets that export XDG_RUNTIME_DIR and
        DBUS_SESSION_BUS_ADDRESS when they are unset but /run/user/$UID exists.
        Helps systemctl --user over SSH; disable if you manage session env elsewhere.
      '';
    };
  };

  config = lib.mkMerge [
    (lib.mkIf (cfg.enable && cfg.useDockerDaemon) {
      virtualisation.docker.enable = lib.mkDefault true;
      virtualisation.podman = {
        enable = lib.mkDefault true;
        # dockerCompat + virtualisation.docker together fails nixpkgs' consistency assertion.
        dockerCompat = lib.mkForce false;
        dockerSocket.enable = lib.mkForce false;
        defaultNetwork.settings.dns_enabled = lib.mkDefault true;
      };

      users.users.${cfg.user} = {
        extraGroups = lib.mkAfter [ "docker" ];
      };

      # User systemd cannot raise supplementary groups (docker socket); use a system unit.
      systemd.services.rei-maids-db = {
        description =
          "rei.tesko.io Postgres (docker-compose → root Docker; docker-compose.yml)";
        unitConfig = {
          Documentation = "file://${composeFile}";
          ConditionPathExists = composeFile;
        };
        after = [ "network-online.target" "docker.service" ];
        wants = [ "docker.service" ];
        wantedBy = [ "multi-user.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          User = cfg.user;
          Group = config.users.users.${cfg.user}.group;
          SupplementaryGroups = [ "docker" ];
          WorkingDirectory = cfg.projectRoot;
          Environment = [
            "DOCKER_HOST=unix:///var/run/docker.sock"
          ];
          ExecStart =
            "${lib.getExe pkgs.docker-compose} -f ${composeFile} up -d db migrate";
          ExecStop =
            "${lib.getExe pkgs.docker-compose} -f ${composeFile} stop db migrate";
          TimeoutStopSec = 120;
        };
      };
    })

    (lib.mkIf (cfg.enable && !cfg.useDockerDaemon) {
      virtualisation.podman = {
        enable = true;
        dockerCompat = true;
        defaultNetwork.settings.dns_enabled = true;
      };

      users.users.${cfg.user}.linger = lib.mkDefault true;

      systemd.user.services.rei-maids-db = {
        description =
          "rei.tesko.io Postgres (rootless podman run; docker-compose.yml in sync)";
        unitConfig = {
          Documentation = "file://${composeFile}";
          ConditionPathExists = composeFile;
        };
        after = [ "network-online.target" ];
        wants = [ "podman.socket" ];
        wantedBy = [ "default.target" ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          WorkingDirectory = cfg.projectRoot;
          ExecStart = "${reiMaidsPodmanUp}";
          ExecStop = "${reiMaidsPodmanStop}";
          TimeoutStopSec = 120;
        };
      };
    })

    (lib.mkIf (cfg.enable && cfg.fixSessionBusEnvInShell) {
      environment.etc."profile.d/70-xdg-runtime-user.sh".text = sessionBusEnvSnippet;

      programs.zsh.interactiveShellInit =
        lib.mkIf config.programs.zsh.enable (lib.mkAfter sessionBusEnvSnippet);
    })
  ];
}
