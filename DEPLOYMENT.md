# Deployment: Vercel

Production is Vercel. GitHub Pages is no longer the host. `vercel.json` holds the build
settings; there is nothing to type in the Vercel dashboard.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| Framework preset | Jekyll | `vercel.json` → `framework` |
| Install command | `bundle install` | `vercel.json` → `installCommand` |
| Build command | `JEKYLL_ENV=production bundle exec jekyll build` | `vercel.json` → `buildCommand` |
| Output directory | `_site` | `vercel.json` → `outputDirectory` |
| Production branch | `master` | Vercel project settings |

`cleanUrls` and `trailingSlash` keep URL shapes matching what GitHub Pages used (`/terms/`,
`/store/`, `/thanks/`).

A serverless function in `/api` (see `GROW_PAYMENTS_SETUP.md`) is served alongside the Jekyll
output, but `trailingSlash: true` applies to it too, so `/api/create-payment-link` answers with
a 308 to `/api/create-payment-link/`. Call it with the trailing slash, or add a rewrite in
`vercel.json` to exempt `/api`.

## Local development

```bash
bundle install
bundle exec jekyll serve   # http://localhost:4000
```

Or with Docker: `docker compose up` (serves on http://localhost:4001).

## Point the custom domain at Vercel

Do these in order. Changing DNS **before** merging this branch (which deletes the Pages `CNAME`
file) keeps the site up: Vercel serves as soon as DNS flips, and Pages is cleaned up afterwards.
Merging first while DNS still points at GitHub is what caused the 404 last time.

### 1. Add the domain in Vercel

Open the **project** (not the team) → **Settings** → **Domains** in the left sidebar.
A reload may be needed if that page 404s. Direct path: `/<team>/<project>/settings/domains`.

**Add** `rikma.binushka.com`. Copy the CNAME target Vercel shows. If you would rather not copy
the long project-specific host, `cname.vercel-dns.com` is the generic value and still works.

Vercel will say "Invalid Configuration" until step 2. That is expected.

### 2. Change the WordPress.com DNS record

`binushka.com` uses WordPress.com nameservers, so the record is edited there, not at GitHub or
Vercel.

WordPress.com → **Upgrades → Domains → binushka.com → DNS records**.

Edit the existing `rikma` CNAME. Do not add a second one.

| Field | Set to |
| --- | --- |
| Type | CNAME |
| Name / host | `rikma` (not the full hostname) |
| Points to | the value from step 1, for example `cname.vercel-dns.com` |
| TTL | leave as-is (3600 is fine) |

WordPress.com sometimes treats a target without a trailing dot as relative. If the saved record
shows something like `cname.vercel-dns.com.binushka.com`, edit it again and add a trailing dot:
`cname.vercel-dns.com.`

### 3. Confirm Vercel is answering

Wait until the Vercel domain page says "Valid Configuration" (often a few minutes; up to an hour
because the old TTL is 3600).

```bash
dig rikma.binushka.com CNAME +short      # expect a vercel-dns host, not github.io
curl -sSI https://rikma.binushka.com | grep -i server   # expect: server: Vercel
```

Also load https://rikma.binushka.com in a browser and check the padlock.

### 4. Merge this change, then turn Pages off

This branch deletes the repo `CNAME` file so GitHub Pages stops claiming the hostname. Merge it
**after** step 3.

Then GitHub → repo **Settings → Pages** → clear the custom domain field → set **Source** to
**None**.

### Rollback

Point the `rikma` CNAME back at `<user>.github.io.`, restore a repo file named `CNAME` containing
`rikma.binushka.com`, and set Pages Source to `master` / root.
