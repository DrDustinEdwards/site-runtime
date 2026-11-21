# CLAUDE.md - site-runtime

The portfolio's shared runtime (`@dustinedwards/site-runtime`); `README.md` is the reference. `.changeset/README.md` is the release procedure.

## Rules every repo shares

- **Tests.** Keep the minimal set (a few browser tests for flows that must never break, one integration test per real behavior, unit tests only for tricky logic, shared code tested once where it lives), and remove any test that pins design, repeats coverage or has never caught a real mistake, unless it guards a harm that cannot be undone.
- **UI copy.** Let the layout explain. No eyebrows, restating subtitles, "this page lets you" intros, descriptions under obvious buttons, hints a label already gives, repeated captions or empty-state essays; labels, accessible names, errors, one-way warnings and legal text stay (Dustin, 2026-11-18; Capsid capsid/conventions.md).
- **Shared code.** Before writing anything another site might have, read https://github.com/DrDustinEdwards/devkit/blob/shared-list/SHARED.md (CI's shared-code check fails on a copy). Change shared code in place and delete what a change replaces in the same PR.
- **Browser support.** devkit's docs/browser-support.md (Baseline Widely available freely; Newly available with a small fallback; Limited only feature-detected; no polyfills).
- **Secrets.** Never commit or print a key, token, `.dev.vars` or `.env`.
- **Reproduce first.** A report that something is broken names a cause; reproduce the failure before fixing it, and report red before and green after.
- **Releases.** A pull request adds a changeset (`npx changeset`; `--empty` when there is nothing to release) and never sets the version or writes CHANGELOG.md. A release is its own pull request, `npx changeset version` on main, made when a consumer needs what has merged; merging it is the release (release.yml tags and publishes it; nobody tags by hand). Consumers pin a tag (Dustin, 2026-11-13).
