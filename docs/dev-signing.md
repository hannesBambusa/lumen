# Stopping the keychain prompt in dev builds

macOS grants keychain access to a *code signature*, and "Always allow" is remembered for
that signature. A dev build is ad-hoc signed by the linker with a new identity every time
it is rebuilt, so as far as the keychain is concerned each build is a different program
asking for the first time. The prompt returns on every launch no matter what you click.

The fix is to sign every dev build with the same certificate, so it has one identity.

## How it works

`pnpm tauri` runs `scripts/tauri.sh`, which on macOS hands `dev` and `build` a cargo
wrapper, `scripts/cargo-sign.sh`. The wrapper runs the real cargo and then signs the
binary with a fixed identifier, `se.bambusa.lumen`.

It picks a certificate in this order:

1. `LUMEN_DEV_SIGNING_IDENTITY`, if you set it.
2. A self-signed certificate named `Lumen Dev`, if one exists.
3. The machine's **Apple Development** identity, which anyone with Xcode signed in already
   has. This is the usual case and needs no setup at all.

With none of the three the build runs unsigned, exactly as it did before, so a fresh clone
still works.

**The next keychain prompt after the first signed build is the last one.** Click
**Tillåt alltid**. The keychain's existing record was granted to the old ad-hoc identity,
so it has to be granted once more to the new one.

## If you have no Apple Development certificate

Make a self-signed one, about two minutes:

1. Open **Keychain Access** (Nyckelhanterare).
2. Menu **Keychain Access → Certificate Assistant → Create a Certificate…**
3. Name: `Lumen Dev`. Identity Type: **Self Signed Root**. Certificate Type:
   **Code Signing**. Leave the rest at defaults. Create.
4. The certificate appears in the **login** keychain. Double-click it, open **Trust**, set
   **Code Signing** to **Always Trust**, close (it asks for your password once).
5. Restart `pnpm tauri dev`.

## Why it cannot be cargo's own runner

Cargo has a `[target.*] runner` setting, and it looks like the obvious place for this. It
is not: `runner` applies to `cargo run` and `cargo test` only, and Tauri runs `cargo build`
and then launches the binary itself. A runner configured there never executes. The cargo
wrapper passed through `tauri dev --runner` is the only hook that sits between the build
finishing and the app starting.

## Why not skip the keychain in dev instead

It would be simpler to keep the Google refresh token in a plain file for dev builds. It
would also mean a file on disk that opens your entire mailbox, in the build you actually
use every day. Signing is cheaper than that trade.
