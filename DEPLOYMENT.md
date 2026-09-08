# Deployment: Vercel

The site is a plain Jekyll build. Vercel installs the gems, runs `jekyll build`, and serves
`_site` from its CDN. `vercel.json` holds every build setting, so there is nothing to configure
by hand in the Vercel dashboard.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| Framework preset | Jekyll | `vercel.json` → `framework` |
| Install command | `bundle install` | `vercel.json` → `installCommand` |
| Build command | `JEKYLL_ENV=production bundle exec jekyll build` | `vercel.json` → `buildCommand` |
| Output directory | `_site` | `vercel.json` → `outputDirectory` |
| Production branch | `master` | Vercel project settings |

`cleanUrls` and `trailingSlash` are both on so that Vercel serves the same URLs GitHub Pages
served (`/terms/`, `/store/`, `/thanks/`). Existing links and search-engine results keep working.

Vercel's build image ships Ruby 3.3.x. The `Gemfile` pins Jekyll to `~> 4.4`, which runs on that
Ruby. `Gemfile.lock` is intentionally not committed: Vercel's bundler resolves the pinned ranges
at build time, which avoids lockfile/bundler version mismatches between local machines and the
build image.

Note for the planned Grow payments endpoint (see `GROW_PAYMENTS_SETUP.md`): a serverless function
placed in `/api` is served alongside the Jekyll output, but `trailingSlash: true` applies to it
too, so `/api/create-payment-link` answers with a 308 to `/api/create-payment-link/`. Call it with
the trailing slash, or add a rewrite in `vercel.json` to exempt `/api`.

## Local development

```bash
bundle install
bundle exec jekyll serve   # http://localhost:4000
```

Or with Docker: `docker compose up` (serves on http://localhost:4001).

## One-time migration from GitHub Pages

The site used to be served by GitHub Pages at `rikma.binushka.com`. These are the steps to move
serving to Vercel. Do them in this order — the domain keeps working the whole way through, and
the only user-visible moment is the DNS switch in step 4, which is a few seconds of cutover.

### 1. Check the Vercel project

A Vercel project for this site already exists and is connected to this repository: pushes build,
and pull requests get preview deployments.

1. Open the project in the Vercel dashboard → **Settings → Git** and confirm the production
   branch is `master`.
2. Confirm **Settings → Build & Deployment** shows Jekyll and `_site` (both come from
   `vercel.json`, so there is nothing to type in).

### 2. Verify the preview build

Open the preview deployment Vercel creates for this branch. Preview deployments sit behind Vercel
Authentication, so open them while signed in to Vercel. Check before touching DNS:

- `/` renders with styling and images
- `/store/`, `/terms/`, `/thanks/`, `/about/`, `/blog/` all return 200
- `/sitemap.xml` and `/robots.txt` list `https://rikma.binushka.com/...`
- A URL that does not exist renders the custom 404 page

### 3. Add the domain in Vercel

In the Vercel project → **Settings → Domains** → add `rikma.binushka.com`.

Vercel then shows the exact DNS record it expects. For a subdomain it is a `CNAME` whose value is
project-specific and looks like `d1d4fc829fe7bc7c.vercel-dns-017.com` (the older generic
`cname.vercel-dns.com` still works, but prefer the value Vercel shows you). Copy it exactly,
including the trailing dot if one is shown.

Vercel will report the domain as "Invalid Configuration" until step 4 is done. That is expected.

### 4. Point DNS at Vercel

`binushka.com` uses WordPress.com nameservers (`ns1/ns2/ns3.wordpress.com`), so DNS records are
edited in the WordPress.com dashboard, not at GitHub or Vercel.

WordPress.com → **Upgrades → Domains → binushka.com → DNS records**. The current record is:

```
rikma   CNAME   <user>.github.io.   (TTL 3600)
```

Edit that record and replace the value with the CNAME target from step 3:

```
rikma   CNAME   <value-from-vercel>.   (TTL 3600)
```

Do not keep both records — a hostname can only have one CNAME. If you want a faster cutover,
lower the TTL to 300 an hour before making the change, then raise it again afterwards.

Within a few minutes Vercel's domain page flips to "Valid Configuration" and it issues a Let's
Encrypt certificate automatically. Because the old TTL is 3600, some resolvers may keep sending
visitors to GitHub Pages for up to an hour; both hosts serve the same content during that window,
so nothing breaks.

### 5. Turn GitHub Pages off

Only after Vercel is serving the domain:

1. GitHub → repo **Settings → Pages** → clear the custom domain field
   (`rikma.binushka.com`), then set **Source** to **None**.
2. The `CNAME` file that GitHub Pages used has already been deleted from this repo, so the custom
   domain will not be re-applied by a later build.

Leaving the custom domain configured on a disabled Pages site is worth avoiding: it keeps the
hostname claimed on GitHub's side and complicates re-verification later.

### 6. Verify the cutover

```bash
dig rikma.binushka.com CNAME +short      # expect the vercel-dns value
curl -sSI https://rikma.binushka.com | grep -i server   # expect: server: Vercel
curl -sS -o /dev/null -w '%{http_code}\n' https://rikma.binushka.com/thanks/
```

Also load the site in a browser and confirm the padlock (certificate issued for
`rikma.binushka.com`, not the `*.vercel.app` name).

### Rollback

Set the `rikma` CNAME back to the `<user>.github.io.` target and re-enable GitHub Pages
(**Settings → Pages → Source: Deploy from a branch → `master` / root**), restoring a `CNAME` file
containing `rikma.binushka.com`. Rollback takes effect within the DNS TTL.

## Day-to-day after the migration

Pushing to `master` triggers a production deploy. Pull requests get their own preview URL. Build
logs, instant rollback to a previous deployment, and deploy history all live in the Vercel
dashboard.
