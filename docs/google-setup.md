# Connecting Lumen to Google

Lumen is an **installed app**, so it is a public OAuth client: the client id ships inside the
binary, there is no usable client secret, and PKCE carries the security. This is Google's
documented setup for desktop apps, not a workaround.

## Where the credentials live

**Not in the source.** They are compiled in from the environment at build time, and read at
runtime from the environment first if it is set there.

| Where | What |
|---|---|
| `src-tauri/.cargo/config.toml` | Your local build. Not committed. Copy `config.example.toml` and fill it in. |
| GitHub Actions secrets | The CI builds. `LUMEN_GOOGLE_CLIENT_ID`, `LUMEN_GOOGLE_CLIENT_SECRET`. |
| `LUMEN_GOOGLE_CLIENT_ID` / `_SECRET` in the environment | Overrides both, for pointing a build at another project without recompiling. |

Neither value is a secret in the usual sense: whatever is compiled in ships inside every copy
of the binary and can be read out of it in seconds, which is exactly why Google's desktop
flow leans on PKCE instead. They are kept out of the repository anyway, for a different
reason: a public repository is not a binary. The id identifies *this* Cloud project, and
anyone holding it can put this app's name on their own consent screen. GitHub's push
protection blocks them for that reason, and it is right to.

A build with neither set still compiles. It says so when you try to sign in, rather than
sending you to a Google page that cannot work.

## One-time setup in Google Cloud

Done once by whoever builds the app. **Users never do any of this** — they only press Allow
on Google's own consent screen.

1. <https://console.cloud.google.com> → create a project.
2. **APIs & Services → Library** → Gmail API → **Enable**.
3. **Google Auth Platform → Branding** (older consoles: **OAuth consent screen**) → User type
   **External**, app name, support email, developer contact → Save.
4. **Data Access** → Add or remove scopes → add the three scopes below → Update → Save.
5. **Audience** → Test users → add every address that will sign in. Testing mode caps at 100.
6. **Clients → Create OAuth client** → Application type **Desktop app** → copy **both** the
   Client ID and the Client secret.

Both values go into `src-tauri/.cargo/config.toml` (copy `config.example.toml`), and into
the repository's Actions secrets if CI is going to build installers.

### Why a desktop app has a "secret"

Google is unusual here. Their installed-app flow **requires** `client_secret` in the token
exchange even when PKCE is used, and their own documentation states the value "is not treated
as confidential" for desktop clients, because it necessarily ships inside the binary and can
be read out of it. Leaving it out fails with:

```
invalid_request: client_secret is missing.
```

PKCE, not that string, is what stops an intercepted authorization code from being redeemed by
someone else. Open-source mail clients ship theirs in public source for exactly this reason.

## Scopes

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` | Read mail, change labels, archive. Not permanent delete. |
| `https://www.googleapis.com/auth/gmail.send` | Send and reply. |
| `https://www.googleapis.com/auth/userinfo.email` | Know which account signed in. |

`https://mail.google.com/` is deliberately **not** requested. It adds permanent delete and
IMAP, makes the consent screen far more alarming, and widens the security assessment for no
feature this app offers.

## What the user sees

1. Presses "Connect Google account" in Lumen.
2. Their system browser opens on Google's consent screen. While the app is unverified there
   is a "Google hasn't verified this app" warning to click through, and only listed test
   users get that far.
3. They approve. The browser is redirected to `http://127.0.0.1:<random port>`, which Lumen
   is listening on, and shows a small "you can close this tab" page.
4. Lumen exchanges the code for tokens. The refresh token goes into the OS keychain. The
   user never types a password into Lumen and Lumen never sees one.

## Going beyond 100 users

Gmail scopes are **restricted**. Publishing to the world needs OAuth verification plus a CASA
Tier 2 security assessment: verified domain, homepage, privacy policy, a demo video of the
whole flow, and an annual paid audit. Until then Testing mode is the right place to be.
