#!/bin/bash
# Stands in for cargo while Tauri builds and launches the app, so what launches is signed.
#
# macOS ties keychain permission to an app's code signature. A dev build is ad-hoc signed
# by the linker with a fresh identity on every rebuild, so "Always allow" is meaningless:
# the next build is, as far as the keychain is concerned, a different program asking for
# the first time. Signing every build with the same certificate gives it one identity and
# the permission sticks.
#
# Two things make this fiddlier than it looks:
#
#   * Cargo's own `[target.*] runner` cannot do it. That applies to `cargo run` and
#     `cargo test` only, and Tauri invokes cargo itself, so a runner configured there never
#     fires. This wrapper is passed in with `tauri dev --runner` instead.
#   * Tauri asks for `cargo run`, not `cargo build`. There is no gap between building and
#     launching to sign in, so the build is done first as a separate step, the binary is
#     signed, and only then is `run` handed back to cargo, which finds everything fresh and
#     just launches it.
#
# The certificate: LUMEN_DEV_SIGNING_IDENTITY if set, else a self-signed "Lumen Dev" if it
# exists, else the machine's Apple Development identity. With none of the three the build
# runs unsigned, exactly as before, so a fresh clone still works. See docs/dev-signing.md.
set -e

# Self-contained: this is also reachable directly, not only from scripts/tauri.sh.
PATH="$HOME/.cargo/bin:$PATH"
export PATH

# Say what happened, on the terminal and in a file. Silence was the reason this went
# unnoticed for two rounds: the wrapper looked installed, never ran, and nothing said so.
say() {
  echo "cargo-sign: $1" >&2
  mkdir -p target 2>/dev/null || true
  echo "$(date '+%H:%M:%S') $1" >> target/signing.log 2>/dev/null || true
}

sign_binary() {
  [ "$(uname)" = "Darwin" ] || return 0

  local profile=debug
  for arg in "$@"; do
    [ "$arg" = "--release" ] && profile=release
  done

  local binary=""
  for candidate in "target/$profile/lumen" "src-tauri/target/$profile/lumen"; do
    if [ -f "$candidate" ]; then
      binary="$candidate"
      break
    fi
  done
  if [ -z "$binary" ]; then
    say "no binary found to sign (profile $profile)"
    return 0
  fi

  local identities identity=""
  if ! identities=$(security find-identity -v -p codesigning 2>/dev/null); then
    say "no code-signing identities on this machine; running unsigned"
    return 0
  fi

  if [ -n "$LUMEN_DEV_SIGNING_IDENTITY" ]; then
    identity="$LUMEN_DEV_SIGNING_IDENTITY"
  elif printf '%s' "$identities" | grep -q '"Lumen Dev"'; then
    identity="Lumen Dev"
  else
    identity=$(printf '%s' "$identities" | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)
  fi
  if [ -z "$identity" ]; then
    say "no usable certificate; running unsigned, so the keychain will keep asking"
    return 0
  fi

  # A fixed identifier as well as a fixed certificate: the keychain's record of what it
  # granted covers both, and cargo's default identifier carries a build hash.
  local output
  if output=$(codesign --force --sign "$identity" --identifier se.bambusa.lumen "$binary" 2>&1); then
    say "signed $binary as \"$identity\""
  else
    say "could not sign $binary: $output"
  fi
}

if [ "$1" = "run" ]; then
  shift
  # The flags cargo needs, up to the bare `--` that separates the app's own arguments.
  build_args=()
  for arg in "$@"; do
    [ "$arg" = "--" ] && break
    build_args+=("$arg")
  done

  cargo build "${build_args[@]}"
  sign_binary "${build_args[@]}"
  # Nothing has changed since the build, so this launches rather than rebuilding, and the
  # signature survives.
  exec cargo run "$@"
fi

cargo "$@"

case " $* " in
  *" build "*) sign_binary "$@" ;;
esac
