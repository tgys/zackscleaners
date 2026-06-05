# Imports `./headless-server.nix` last — keeps VPS builds from pulling XFCE/Mesa (see nixos/README.txt).
#
# Import this from /etc/nixos/configuration.nix (keep your hardware-configuration.nix import):
#
#   imports = [
#     ./hardware-configuration.nix
#     /path/to/repo/nixos/configuration.zacks-snippet.example.nix
#   ];
#
# Or import only ./zacks-maids.nix and set services.zacksMaids.podmanDb yourself — see nixos/README.txt

{ config, lib, ... }:
{
  imports = [
    ./zacks-maids.nix
    ./zacks-maids-production.nix
    # Must stay last so mkForce headless settings beat graphical defaults from other flake modules.
    ./headless-server.nix
  ];

  services.zacksMaids.podmanDb = {
    enable = true;
    useDockerDaemon = true;
    user = "tbox";
    projectRoot = "/home/tbox/cleaning";
  };

  services.zacksMaidsProduction = {
    enable = true;
    mail.enable = true;
    # Vue SPA: docroot-sync runs npm ci + build in frontend/ then rsyncs dist/ → docroot (not legacy flat HTML).
    vueFrontend.enable = true;
  };

  # Used by scripts/sync-zacks-nginx-docroot.sh (same path nginx uses; override via services.zacksMaidsProduction.docroot).
  environment.variables = lib.mkIf config.services.zacksMaidsProduction.enable {
    ZACKS_NGINX_DOCROOT = config.services.zacksMaidsProduction.docroot;
  };

  # Cache-Control for static HTML is set on `location /` in zacks-maids-production.nix (mkForce docroot).
}
