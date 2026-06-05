# Imports `./headless-server.nix` last — keeps VPS builds from pulling XFCE/Mesa (see nixos/README.txt).
#
# Import this from /etc/nixos/configuration.nix (keep your hardware-configuration.nix import):
#
#   imports = [
#     ./hardware-configuration.nix
#     /home/tbox/rei/nixos/configuration.rei-snippet.example.nix
#   ];
#
# Or import only ./rei-maids.nix and set services.reiMaids.podmanDb yourself — see nixos/README.txt

{ config, lib, ... }:
{
  imports = [
    ./rei-maids.nix
    ./rei-maids-production.nix
    # Must stay last so mkForce headless settings beat graphical defaults from other flake modules.
    ./headless-server.nix
  ];

  services.reiMaids.podmanDb = {
    enable = true;
    useDockerDaemon = true;
    user = "tbox";
    projectRoot = "/home/tbox/rei";
  };

  services.reiMaidsProduction = {
    enable = true;
    mail.enable = true;
    mail.imapsPort = 2993;
    # Legacy flat HTML in repo root (demo.html, gallery/, logo/).
    vueFrontend.enable = false;
  };

  environment.variables = lib.mkIf config.services.reiMaidsProduction.enable {
    REI_NGINX_DOCROOT = config.services.reiMaidsProduction.docroot;
  };
}
