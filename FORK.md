# Fork changes

`main` is a clean copy of upstream.

Changes so far:

- `lib/templates.ts`: use `ChrisO72/astro-template` as the only starter
  template for the workshop.
- `next.config.mjs`: allow the `127.0.0.1` development origin because GitHub
  accepts it as a callback instead of `localhost`, making GitHub signup work
  during local development.
- `scripts/setup-github-app.mjs`: update for the current
  [GitHub App manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
  after GitHub rejected `email_addresses` and `hook_attributes.secret` as
  unrecognized; GitHub now generates and returns the webhook secret.
