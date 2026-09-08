# Deployment

Production is GitHub Pages at `rikma.binushka.com`. The DNS `rikma` CNAME stays on
`<user>.github.io.`. A `CNAME` file in the repo root is what GitHub Pages uses to bind that
hostname; do not delete it.

Vercel still builds the same repo onto a `*.vercel.app` URL. That is a secondary host only — it
is not the custom domain. `vercel.json` is the Vercel build config and is excluded from the
Jekyll output.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| GitHub Pages source | `master` / root | repo Settings → Pages |
| Custom domain | `rikma.binushka.com` | `CNAME` file |
| Vercel framework | Jekyll | `vercel.json` → `framework` |
| Vercel install | `bundle install` | `vercel.json` → `installCommand` |
| Vercel build | `JEKYLL_ENV=production bundle exec jekyll build` | `vercel.json` → `buildCommand` |
| Vercel output | `_site` | `vercel.json` → `outputDirectory` |

`cleanUrls` and `trailingSlash` in `vercel.json` keep the Vercel URL shapes matching GitHub
Pages (`/terms/`, `/store/`, `/thanks/`).

A serverless function placed in `/api` (see `GROW_PAYMENTS_SETUP.md`) is served by Vercel
alongside the Jekyll output, but `trailingSlash: true` applies to it too, so
`/api/create-payment-link` answers with a 308 to `/api/create-payment-link/`. Call it with the
trailing slash, or add a rewrite in `vercel.json` to exempt `/api`.

## Local development

```bash
bundle install
bundle exec jekyll serve   # http://localhost:4000
```

Or with Docker: `docker compose up` (serves on http://localhost:4001).

## If the custom domain 404s

DNS is already on GitHub (`rikma` → `<user>.github.io.`). A 404 usually means Pages lost the
custom domain, which happens if the `CNAME` file is missing.

1. Confirm `CNAME` exists at the repo root and contains `rikma.binushka.com`.
2. GitHub → repo **Settings → Pages** → Source: Deploy from a branch → `master` / `/` (root).
3. Custom domain field: `rikma.binushka.com`. Wait for the certificate to go from "DNS Check"
   to "Certificate issued".
4. If the domain was added to a Vercel project, remove it there first so GitHub can re-claim it.

```bash
dig rikma.binushka.com CNAME +short      # expect <user>.github.io.
curl -sSI https://rikma.binushka.com | grep -i server   # expect: GitHub.com
```
