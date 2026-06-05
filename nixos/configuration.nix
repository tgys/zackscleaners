# Zack's-only NixOS snippet (see configuration.zacks-snippet.example.nix for the same content).
# The production host uses flake.nix with both zacks + rei enabled.

{ config, lib, ... }:
{
  imports = [
    ./zacks-maids.nix
    ./zacks-maids-production.nix
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
    vueFrontend.enable = true;
  };

  environment.variables = lib.mkIf config.services.zacksMaidsProduction.enable {
    ZACKS_NGINX_DOCROOT = config.services.zacksMaidsProduction.docroot;
  };
}
