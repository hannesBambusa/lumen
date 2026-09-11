# Shipping Lumen as a downloadable app

Tauri bundles a native installer per platform. The code is already cross-platform; what
stands between a build and something a stranger can install is signing and, for Gmail
access, Google's review.

## Building

```
pnpm tauri build
```

Produces, in `src-tauri/target/release/bundle/`:

| Platform | Output |
|---|---|
| macOS | `Lumen.app`, `Lumen_<version>_<arch>.dmg` |
| Windows | `.msi` and a NSIS `.exe` |
| Linux | `.deb` and `.AppImage` |

**One build per platform.** Tauri cannot cross-compile: each installer links against that
system's webview and toolchain. `.github/workflows/release.yml` runs all four (Apple
silicon, Intel Mac, Windows, Linux) on GitHub's runners and uploads the installers. Run it
by hand from the Actions tab, or push a `v*` tag.

The Mac's translation helper is declared in `tauri.macos.conf.json`, not the shared config.
Tauri fails a bundle when a declared `externalBin` has no build for the target triple, and
that helper exists only on macOS, so declaring it globally breaks the Windows and Linux jobs
looking for a file that will never exist.

macOS builds also need the minimum system version at **11.0 or higher**: llama.cpp uses
`std::filesystem`, which Apple marks unavailable below 10.15, and the build fails with dozens
of "introduced in macOS 10.15" errors otherwise. It is set in `tauri.conf.json`. If you
change it, delete `src-tauri/target/release/build/llama-cpp-sys-2-*` first — CMake caches the
old deployment target and will keep using it, which looks exactly like the setting being
ignored.

### The DMG step needs permission to drive Finder

Locally, `bundle_dmg.sh` arranges the disk image window with AppleScript and fails with
`Ej auktoriserad att skicka Apple-händelser till Finder (-1743)` unless the terminal is
allowed to control Finder: **System Settings → Privacy & Security → Automation → your
terminal → Finder**. The `.app` is already built and usable at that point; only the `.dmg`
is missing. CI is unaffected.

## What is still needed before other people can install it

**macOS — a Developer ID and notarization.** Dev builds are signed with an Apple Development
certificate, which is for this machine, not for distribution. Anyone else downloading it
gets Gatekeeper's "cannot be opened because the developer cannot be verified". Distribution
needs an Apple Developer account (99 USD a year), a *Developer ID Application* certificate,
and notarization through Apple. Tauri does this in the build when `APPLE_CERTIFICATE`,
`APPLE_ID` and the related variables are set.

**Windows — a code-signing certificate.** An unsigned `.msi` triggers SmartScreen's "Windows
protected your PC", which most people obey. A certificate is a few hundred a year, and a new
one earns trust slowly regardless.

**Linux — nothing.** `.deb` and `.AppImage` both install unsigned without ceremony.

**Google, and this is the real one.** Lumen asks for `gmail.modify`, which Google classes as
a *restricted* scope. While the OAuth app is unverified, only accounts on the test-user list
can sign in, up to 100, added by hand in the Cloud console. Letting anyone sign in requires
Google's verification, which for a restricted scope includes a third-party security
assessment (CASA). That costs money and takes weeks, and it is the gate that actually decides
whether this can be a public download — not the installers.

A narrower scope would avoid the assessment, but `gmail.readonly` is restricted too, and
marking mail as read needs `modify`. There is no lighter path that keeps the features.

## What the bundle contains

About 13 MB on macOS: the Rust binary with llama.cpp compiled in, the web assets, and
`lumen-translate`, the Swift helper for the Mac's own translator. **No model.** Models are
downloaded on demand from Settings, so the download stays small and nobody pays for
gigabytes they may not use.

## Sending a build to a tester

1. **Add their Google account as a test user**, in the Cloud console under the OAuth consent
   screen's audience. Without this they cannot sign in at all: they reach Google, and Google
   refuses. Up to 100 accounts.
2. **Build for their platform.** You cannot make a Windows installer on a Mac. Run the
   release workflow from the Actions tab, wait for the Windows job, and download the
   `lumen-x86_64-pc-windows-msvc` artifact. It unzips to a `bundle` folder holding two
   installers:

   | File | |
   |---|---|
   | `nsis/Lumen_0.1.0_x64-setup.exe` | **Send this one.** Double-click, next, done. |
   | `msi/Lumen_0.1.0_x64_en-US.msi` | The same app for anyone who deploys by MSI. |

   Send one, not both: two installers for the same program invites installing both.
3. **Warn them about SmartScreen.** Unsigned, Windows shows "Windows protected your PC".
   They have to click **More info → Run anyway**. There is no way around this except a code
   signing certificate.
4. **Warn them about Google's warning screen too.** The app is unverified, so consent shows
   "Google hasn't verified this app". **Advanced → Go to Lumen (unsafe)**.
5. **Tell them a sign-in lasts seven days.** Google expires refresh tokens for unverified
   apps after a week. When it lapses, mail stops arriving and Lumen says so; **Sign in to
   Google again** in the sidebar fixes it. That link is always there, not only after a
   failure, because re-consenting is the fix for a whole class of problems.

What they will not get on Windows: GPU acceleration for the assistant. It is CPU-only
outside macOS, so a model that takes a second here takes closer to ten there. The Mac's
built-in translator is not there either, and Settings hides that option rather than offering
something that cannot work.
