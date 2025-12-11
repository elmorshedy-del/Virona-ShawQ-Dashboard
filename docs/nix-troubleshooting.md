# Nix/Nixpacks download failure (HTTP 504)

When the app is built with Nixpacks, Nix fetches a pinned `nixpkgs` archive
(`ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7`) from GitHub. If GitHub or its CDN
returns a 504, Nix reports an error like:

```
warning: error: unable to download 'https://github.com/NixOS/nixpkgs/archive/ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.tar.gz': HTTP error 504
```

The failure is not caused by project code. It happens when GitHub temporarily
denies or times out the tarball request (common on busy networks or during
GitHub incidents) and Nix has no cached copy of that commit.

## How to fix or work around it

1. **Retry with a mirror that is less likely to 504.** Point Nix at the
   official NixOS release mirror instead of GitHub:

   ```bash
   export NIX_PATH="nixpkgs=https://releases.nixos.org/nixpkgs/nixpkgs-23.11-darwin/nixexprs.tar.xz"
   nix-shell --run "echo nixpkgs is reachable"
   ```

   Adjust the release path if you need a different nixpkgs branch; any
   `https://releases.nixos.org/nixpkgs/<channel>/nixexprs.tar.xz` URL works.

2. **Seed a local cache before running Nixpacks.** Manually download the
   tarball and put it in Nix's store so later builds do not need to hit GitHub:

   ```bash
   nix-store --add-fixed sha256 \
     https://releases.nixos.org/nixpkgs/nixpkgs-23.11-darwin/nixexprs.tar.xz
   ```

3. **If the build environment blocks GitHub, add a proxy.** Configure
   `NIX_CONFIG` with a proxy that can reach GitHub and include it in the
   environment where Nixpacks runs:

   ```bash
   export NIX_CONFIG="http-connections = 40\nconnect-timeout = 10\nproxy = http://<your-proxy-host>:<port>"
   ```

In most cases simply retrying or pointing `nixpkgs` at the NixOS release CDN
is enough to get past the 504s.
