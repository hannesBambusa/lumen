/// Build the Mac's translation helper and put it next to the app binary.
///
/// Swift, because Apple's translator is only reachable from SwiftUI (see
/// `src/assistant/apple.rs`). Absence is not an error: without Xcode's toolchain the app
/// builds and runs exactly as before, minus that one option.
#[cfg(target_os = "macos")]
fn build_translate_helper() {
    use std::path::PathBuf;
    use std::process::Command;

    let source = PathBuf::from("../macos/lumen-translate.swift");
    println!("cargo:rerun-if-changed=../macos/lumen-translate.swift");
    if !source.exists() {
        return;
    }

    // OUT_DIR is <target>/<profile>/build/<pkg>-<hash>/out, and the app binary sits three
    // levels up from it. There is no tidier way to learn the profile directory.
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let Some(profile_dir) = out_dir.ancestors().nth(3) else { return };

    let binary = profile_dir.join("lumen-translate");
    let status = Command::new("swiftc")
        .args(["-O", "-target", "arm64-apple-macos15.0", "-o"])
        .arg(&binary)
        .arg(&source)
        .status();

    match status {
        Ok(status) if status.success() => {
            // The bundler copies this one into Lumen.app; the triple suffix is Tauri's
            // convention for an external binary.
            let bundled = PathBuf::from("binaries/lumen-translate-aarch64-apple-darwin");
            if let Some(parent) = bundled.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(&binary, &bundled);
        }
        _ => println!(
            "cargo:warning=could not build the Mac translation helper; that option will be hidden"
        ),
    }
}

#[cfg(not(target_os = "macos"))]
fn build_translate_helper() {}

fn main() {
    build_translate_helper();

    // LUMEN_GOOGLE_CLIENT_ID overrides the compiled-in default at runtime; see
    // src/auth/mod.rs. Declared here so a changed value triggers a rebuild.
    println!("cargo:rerun-if-env-changed=LUMEN_GOOGLE_CLIENT_ID");

    tauri_build::build()
}
