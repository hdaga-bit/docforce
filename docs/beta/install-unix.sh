#!/bin/sh
set -eu
pkg_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tarball=$(ls "$pkg_dir"/mary-docforce-*.tgz 2>/dev/null | head -n 1)
if [ -z "$tarball" ]; then
  echo "mary-docforce-*.tgz not found next to install-unix.sh" >&2
  exit 1
fi
echo "Installing $(basename "$tarball") into the current repository..."
npm install --no-fund "$tarball"
echo "Installed. From this repository run: npx docforce try"
