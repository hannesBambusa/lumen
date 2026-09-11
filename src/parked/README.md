# Parked

Not built by the app. Nothing here is imported, and `.parked` keeps TypeScript out of it.

**`NowView.tsx.parked`** — the obligation-centric home screen from the Focus mode
experiment. Removed from the UI on request, kept because the idea may come back and there
is no git history to recover it from. Its data still exists as `obligations` in
`src/fixtures.ts` and the `Obligation` type in `src/types.ts`, both unused.

To bring it back: move it to `src/views/`, restore the mode switch entry in `App.tsx`, and
re-add the `.card-head` / `.age-pill` / `.quiet-*` rules, which are still in `styles.css`.

**`PersonView.tsx.parked`** — the merged-conversation take on a person: every message with
them as chat bubbles, subject lines demoted to a note. Replaced by `PersonMailList` +
`MessageView`, which keep messages as discrete mail rather than a chat log.
