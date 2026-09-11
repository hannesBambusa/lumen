#!/bin/sh
# What `pnpm tauri …` runs.
#
# Two jobs: put cargo on PATH, and on macOS route dev and build through the signing
# wrapper so the keychain stops asking on every launch. Every other subcommand is passed
# straight through.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$HOME/.cargo/bin:$PATH"
TAURI="$ROOT/node_modules/.bin/tauri"

if [ "$(uname)" = "Darwin" ]; then
  case "$1" in
    dev|build)
      SUB="$1"
      shift
      exec "$TAURI" "$SUB" --runner "$ROOT/scripts/cargo-sign.sh" "$@"
      ;;
  esac
fi

exec "$TAURI" "$@"
