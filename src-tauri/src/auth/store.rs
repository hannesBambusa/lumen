//! Refresh tokens live in the OS keychain, never on disk in the clear.
//!
//! macOS Keychain, Windows Credential Manager, Secret Service on Linux. The database holds
//! the account row; the platform holds the secret, so a copied `mail.db` is useless alone.

use keyring::Entry;

const SERVICE: &str = "se.bambusa.lumen";

// Which accounts exist is recorded in the database, not here. Reading the keychain makes
// macOS prompt for permission, and asking for that on every launch just to find out whether
// anyone is signed in is intolerable. The keychain now holds secrets and nothing else, so it
// is only touched when a token is actually needed.

fn entry(key: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, key)
}

pub fn save_refresh_token(email: &str, refresh_token: &str) -> keyring::Result<()> {
    entry(email)?.set_password(refresh_token)
}

pub fn load_refresh_token(email: &str) -> keyring::Result<Option<String>> {
    match entry(email)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_refresh_token(email: &str) -> keyring::Result<()> {
    match entry(email)?.delete_credential() {
        // Already gone is the desired end state, not a failure.
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}
