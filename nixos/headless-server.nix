# VPS / headless defaults: never pull X11 desktops, GPU driver bundles (Mesa → intel-graphics-compiler),
# VA/OpenCL extras, or desktop portals.
#
# Import this module **after** any flake fragment that enables XFCE/GDM/etc., or merge cleaning’s
# `configuration.nix` **last** in `nixosConfigurations.<host>.modules` so these `mkForce` values win.
#
# Deprecation warnings about `xfce.*` / `xorg.*` aliases usually mean something still enables a desktop
# module elsewhere — grep `/etc/nixos` for xfce/xserver and remove those imports on servers.

{ lib, ... }:

{
  services.xserver.enable = lib.mkForce false;
  services.xserver.desktopManager.xfce.enable = lib.mkForce false;

  # Prevent leftover installer/hardware configs from selecting GPU X drivers.
  services.xserver.videoDrivers = lib.mkForce [ ];

  hardware.graphics.enable = lib.mkForce false;
  hardware.graphics.enable32Bit = lib.mkForce false;
  hardware.graphics.extraPackages = lib.mkForce [ ];
  hardware.graphics.extraPackages32 = lib.mkForce [ ];

  xdg.portal.enable = lib.mkForce false;

  programs.xwayland.enable = lib.mkForce false;

  # --- mailutils / Emacs (headless VPS): Emacs defaults `withMailutils = true`, which pulls GNU mailutils;
  # its DEJAGNU tests often fail in Nix’s sandbox and blocks `system-path`. We fix two ways:
  #   (a) disable mailutils’ checkPhase entirely;
  #   (b) strip mailutils from Emacs variants so servers never depend on it for movemail.
  #
  # Overlays are appended with mkAfter so they win over earlier flake overlays on `mailutils` / `emacs*`.
  nixpkgs.overlays = lib.mkAfter [
    (final: prev:
      let
        stripMailutils =
          attr:
          prev.${attr}.override { withMailutils = false; };
        emacsAttrs = [
          "emacs30"
          "emacs30-gtk3"
          "emacs30-nox"
          "emacs30-pgtk"
        ];
        emacsStripped =
          lib.listToAttrs (
            map (a: lib.nameValuePair a (stripMailutils a)) (
              lib.filter (a: lib.hasAttr a prev) emacsAttrs
            )
          );
      in
      {
        mailutils = prev.mailutils.overrideAttrs (old: {
          doCheck = false;
          checkPhase = "${prev.coreutils}/bin/true";
        });
      }
      // emacsStripped
    )
  ];
}
