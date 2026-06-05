{
  # Mirrors /etc/nixos/flake.nix — deploy with: sudo cp …/nixos/flake.nix /etc/nixos/flake.nix
  description = "vpsAdminOS container";

  inputs = {
    vpsadminos.url = "github:vpsfreecz/vpsadminos";

    #nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    nixpkgs.url = "github:nixos/nixpkgs/master";

  };

  outputs =
    inputs@{
      nixpkgs,
      vpsadminos,
      ...
    }:
    let
      system = "x86_64-linux";

      piwiSystem = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          vpsadminos.nixosModules.containerUnstable
          ./configuration.nix
          ./zacks-maids.nix
          ./zacks-maids-production.nix
          ./rei-maids.nix
          ./rei-maids-production.nix
          ./maids-shared-mail.nix
          (
            { config, lib, ... }:
            {
              services.zacksMaids.podmanDb = {
                enable = true;
                useDockerDaemon = true;
                user = "tbox";
                projectRoot = "/home/tbox/cleaning";
              };

              services.zacksMaidsProduction.enable = true;
              services.zacksMaidsProduction.mail.enable = true;

              services.reiMaids.podmanDb = {
                enable = true;
                useDockerDaemon = true;
                user = "tbox";
                projectRoot = "/home/tbox/rei";
              };

              services.reiMaidsProduction.enable = true;
              services.reiMaidsProduction.mail.enable = true;
              services.reiMaidsProduction.mail.imapsPort = 2993;
              services.reiMaidsProduction.vueFrontend.enable = true;

              environment.variables = lib.mkMerge [
                (lib.mkIf config.services.zacksMaidsProduction.enable {
                  ZACKS_NGINX_DOCROOT = config.services.zacksMaidsProduction.docroot;
                })
                (lib.mkIf config.services.reiMaidsProduction.enable {
                  REI_NGINX_DOCROOT = config.services.reiMaidsProduction.docroot;
                })
              ];
            }
          )
        ];
        specialArgs = {
          inherit inputs;
        };
      };
    in
    {
      # Hostname is `piwibox`; `nixos-rebuild` picks `nixosConfigurations.<hostname>` by default.
      nixosConfigurations = {
        nixos = piwiSystem;
        piwibox = piwiSystem;
      };
    };
}
