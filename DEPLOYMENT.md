# Deployment: Vercel

Production is Vercel. GitHub Pages is no longer the host. `vercel.json` holds the build
settings; there is nothing to type in the Vercel dashboard.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| Framework preset | Jekyll | `vercel.json` → `framework` |
| Install command | `bundle install` | `vercel.json` → `installCommand` |
| Build command | `node scripts/build-catalog.js && JEKYLL_ENV=production bundle exec jekyll build` | `vercel.json` → `buildCommand` |
| Output directory | `_site` | `vercel.json` → `outputDirectory` |
| Production branch | `master` | Vercel project settings |

`cleanUrls` and `trailingSlash` keep URL shapes matching what GitHub Pages used (`/terms/`,
`/store/`, `/thanks/`).

A serverless function at `/api/checkout` creates the Green Invoice / Morning payment form.
`vercel.json` rewrites `/api/:path*/` to `/api/:path*` so `trailingSlash` does not 308 the
function. The browser posts to `/api/checkout/`.

## Store cart

Grow approved the site for clearing and pointed us at the Green Invoice payment-form API
(not WooCommerce / Wix / Shopify). The cart collects Grow-required customer details on
`/checkout/`, then the server builds the payment form.

Set these in Vercel → Project → Settings → Environment Variables. For the
preview/sandbox cart, set **Preview** (and leave Production for later):

| Variable | What it is |
| --- | --- |
| `MORNING_ENV` | `sandbox` while testing. `production` only when charging real cards |
| `MORNING_API_KEY_ID` | Morning sandbox keys while `MORNING_ENV=sandbox` |
| `MORNING_API_KEY_SECRET` | same. Paste the raw secret — no wrapping quotes in the Vercel UI |
| `MORNING_PLUGIN_ID` | Grow production plugin. **Not sent in sandbox** — it 404s there |
| `MORNING_SANDBOX_PLUGIN_ID` | sandbox Grow plugin `facd67fd-5082-496c-917f-830f0d7449e3` (already the checkout default) |

Changing env vars does not update an already-built Preview. Redeploy the
git branch (or use Vercel → Deployments → Redeploy) after saving them.

`GET /api/checkout/` returns `{ env, hasKeyId, hasSecret, keyIdPrefix }` so
you can confirm Preview picked up the sandbox pair without printing secrets.

Gift cards: the customer picks an amount (₪50–₪2,000) and it goes through the
same Morning cart as other products. Checkout sends that custom sum as an
income line (no Morning catalog UUID).

Scrunchies: three fixed variants (regular ₪30, large ₪45, fancy ₪85). Checkout
sends a server-validated variant id, never a client price. An optional fabric
note from the checkout form is appended to the Morning income description.

## Store catalog

`_store/<slug>.md` is the only catalog you edit. Front matter is the product:
title, photos, stock, and the price charged at checkout.

- A normal product with `price: ₪240` is in the cart on the next deploy. No
  JSON edit.
- Gift cards use `variable: true` plus `min_price` / `max_price` / `presets`.
- Scrunchies (or any multi-type product) use a `variants:` block.
- A page that should not be buyable, even if it shows a ₪ price, sets
  `in_cart: false`.

`_data/catalog.json` and `api/catalog-data.json` are generated from those
pages (`scripts/build-catalog.js`) during the Vercel build and again whenever
`/admin/` saves. Do not hand-edit them.

## Store admin (`/admin/`)

A password-protected Hebrew backoffice for **every** store product: create,
update, delete, prices charged at checkout, gift-card amounts, scrunchie
variants, page text, and stock/visibility. It is not linked from the public
menu. After save it commits `_store/<slug>.md` and regenerates the catalog
JSON snapshots so Vercel rebuilds.

Set these on **Production** (and Preview if you want to try it there):

| Variable | What it is |
| --- | --- |
| `ADMIN_PASSWORD` | Shared password for `/admin/` |
| `GITHUB_TOKEN` | Fine-grained PAT with **Contents: Read and write** on this repo |
| `GITHUB_BRANCH` | Usually `master`. Admin always writes this branch |
| `GITHUB_REPO` | Optional `owner/repo`. Vercel already sets the git owner/slug |

For local `vercel dev`, set `ADMIN_LOCAL_ROOT` to the repo root so saves write
the markdown (and regenerated catalog JSON) on disk instead of GitHub.

The number saved in the admin is the number charged at checkout. Morning is
payments and invoices only. It is not the store catalog.

## Who edits products

**GitHub:** add or edit `_store/<slug>.md`. Copy an existing product page,
change the title / `price: ₪…` / photos. That is enough for the store grid
and checkout. Do not edit `catalog.json`.

**Admin (`/admin/`, password):** the same data, with a form. Use it for
photos, stock, hide, gift-card amounts, and scrunchie variants.

**Photos:** `/admin/` → תמונות. Upload from the computer, reorder, first photo is
the main store image. Extra photos are `gallery` on the product page. Files are
committed under `images/store/<slug>/`.

**Stock / hide:** same `/admin/` screen. Morning’s item API has no inventory
field. Grow is payments only — it is not a catalog.

To add a new cart product: either `/admin/` → מוצר חדש, or a new markdown
file in `_store/`. Morning does not need a matching item to charge.

## Newsletter

Signups go to beehiiv through `/api/newsletter/subscribe`, `/api/newsletter/unsubscribe`
and `/api/newsletter/latest`. `NEWSLETTER_SETUP.md` covers creating the publication;
these are the deployment-side details.

Set these per environment. Preview needs its own copy — Vercel does not share
environment variables between Preview and Production:

| Variable | What it is |
| --- | --- |
| `BEEHIIV_API_KEY` | beehiiv → Settings → Integrations → API |
| `BEEHIIV_PUBLICATION_ID` | the `pub_...` id on the same page |
| `BEEHIIV_DOUBLE_OPT_IN` | optional `on` / `off` / `not_set` override of the publication setting |

Until both required variables are set, the forms answer "ההרשמה לניוזלטר לא זמינה
כרגע" and the home page teaser stays hidden. The page still builds and renders, so
a preview without the variables shows the layout but cannot collect an address.

As with the cart, changing env vars does not update an already-built Preview —
redeploy the branch afterwards.

`GET /api/newsletter/subscribe/` returns `{ configured, hasApiKey, hasPublicationId,
doubleOptIn }` so you can confirm an environment picked up the pair without printing
the key.

Pointing Preview at the same publication as Production puts test signups on the real
list. Either use a throwaway address and remove it afterwards, or create a second
beehiiv publication for Preview.

`/api/newsletter/latest` is cached at the edge for 30 minutes, so a freshly published
issue does not appear in the teaser immediately.

## Local development

```bash
bundle install
node scripts/build-catalog.js   # refresh catalog JSON from _store/*.md
bundle exec jekyll serve        # http://localhost:4000
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
