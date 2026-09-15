# Newsletter Setup (beehiiv)

The site collects newsletter signups through [beehiiv](https://www.beehiiv.com). Visitors
subscribe from the footer, the home page, and `/newsletter/`, and the home page shows the
most recent issue as a teaser.

Nothing here works until the two environment variables in
[Configure Vercel](#3-configure-vercel) are set. Until then the forms answer with a friendly
"not available right now" message and the teaser stays hidden — the site never shows a broken
signup box.

## Why beehiiv

The previous setup used Formspree, which is a form-to-inbox service: it collected addresses but
had no notion of a mailing list, so there was no way for a reader to remove themselves, and no
archive to show on the site. Those two requirements drove the choice.

| | Free tier | Self-serve unsubscribe | Public archive to link/tease |
| --- | --- | --- | --- |
| **beehiiv Launch** | 2,500 subscribers, unlimited sends, API access | One-click link in every email + hosted preference page | Yes — hosted post pages and an API to read them |
| Kit (ConvertKit) | 10,000 subscribers, 1 automation, Kit branding | Yes | Creator profile only |
| EmailOctopus | 2,500 subscribers, 10,000 emails/month | Yes | No |
| MailerLite | 250 subscribers, 2,500 emails/month | Yes | No |
| Buttondown | 100 subscribers | Yes | Yes |
| Formspree (previous) | 50 submissions/month | **No** | **No** |

beehiiv wins on the combination that matters here: a free tier the business will not outgrow
soon, compliant unsubscribe handling we do not have to build, and published issues we can pull
into the site. Kit's subscriber allowance is larger, but it has no per-issue archive to tease
from, and the free plan stamps Kit branding on every email.

Everything provider-specific lives in `lib/newsletter/beehiiv.mjs`, so swapping providers later
means rewriting that one file.

## 1. Create the publication

1. Sign up at [beehiiv.com](https://www.beehiiv.com) and choose the free **Launch** plan.
2. Create a publication named for the business (for example `בינושקה אומנות הרקמה`).
3. Under **Settings → Publication**, set the language/locale to Hebrew so the hosted pages and
   the footer of each email read right-to-left.
4. Under **Settings → Subscribe flow**, turn **double opt-in** on. It keeps bots and typos off
   the list, and the site already tells the reader to go confirm in their inbox.

## 2. Get the credentials

- **API key** — Settings → Integrations → API. Create a key and copy it.
- **Publication ID** — same page, the `pub_...` value.

Treat the API key like a password. It is never committed; it only lives in Vercel.

## 3. Configure Vercel

In the Vercel project, under **Settings → Environment Variables**, add the following for
Production, Preview, and Development:

| Variable | Required | Value |
| --- | --- | --- |
| `BEEHIIV_API_KEY` | yes | The API key from step 2 |
| `BEEHIIV_PUBLICATION_ID` | yes | The `pub_...` id |
| `BEEHIIV_DOUBLE_OPT_IN` | no | `on`, `off`, or `not_set` (default) to override the publication's own setting per request |

Redeploy after adding them — environment variables are read at request time, but a deploy is
the simplest way to pick them up everywhere.

## 4. Verify

After the deploy:

1. Open the site, scroll to the footer, and subscribe with your own address.
2. You should see "כמעט! שלחתי לך מייל לאישור ההרשמה" (with double opt-in on), and the address
   appears in beehiiv as `pending` until you click the confirmation link.
3. Publish a post in beehiiv. Within half an hour (see caching below) the home page shows it as
   a teaser card linking to the hosted issue.
4. Go to `/newsletter/`, enter the same address in the ביטול הרשמה form, and confirm the
   subscription flips to `inactive` in beehiiv.

## How a reader unsubscribes

Three ways, all self-serve:

- The one-click unsubscribe link beehiiv puts in the footer of every email.
- The `List-Unsubscribe` header beehiiv sends, which Gmail and Apple Mail surface as an
  "Unsubscribe" button next to the sender name.
- The form at `/newsletter/`, which calls our own endpoint.

## How it fits together

```
_includes/newsletter-signup.html   signup form (footer, home page, /newsletter/)
_includes/section-newsletter.html  home page section: latest issue + signup
_includes/newsletter-config.html   copy + endpoint URLs handed to the browser as JSON
_pages/newsletter.html             /newsletter/ - signup, recent issues, unsubscribe
js/newsletter.js                   form submission and teaser rendering
api/newsletter/subscribe.mjs       POST {email} -> beehiiv create subscription
api/newsletter/unsubscribe.mjs     POST {email} -> beehiiv unsubscribe
api/newsletter/latest.mjs          GET  ?limit=N -> trimmed list of published issues
lib/newsletter/beehiiv.mjs         the only file that knows about beehiiv
lib/newsletter/http.mjs            body parsing, JSON responses, rate limiting
```

The API key never reaches the browser: the page calls our own `/api/newsletter/*` endpoints, and
only the serverless function talks to beehiiv.

`api/` and `lib/` are listed in `_config.yml`'s `exclude` so Jekyll does not copy the sources
into `_site` and serve them as downloads.

### Caching and rate limits

`/api/newsletter/latest` responds with `s-maxage=1800, stale-while-revalidate=86400`, so Vercel's
edge serves the teaser from cache and beehiiv sees roughly one request per half hour no matter
how much traffic the home page gets. A newly published issue therefore takes up to 30 minutes to
appear; lower `s-maxage` in `api/newsletter/latest.mjs` if that is too slow.

Subscribe and unsubscribe are limited to 5 requests per minute per IP. That limit is per
serverless instance and is only a speed bump — beehiiv's double opt-in is the real defence
against list stuffing.

## Editing the wording

All visitor-facing newsletter copy lives under `newsletter:` in `_data/settings.yml` — titles,
placeholder, button label, and every success/error message. Set `newsletter.enabled` to `false`
to remove the forms and the home page section entirely.

## When you outgrow the free plan

The Launch plan stops at 2,500 active subscribers. beehiiv's paid tiers start at $49/month; at
that point it is worth re-checking the table above, since only `lib/newsletter/beehiiv.mjs` is
provider-specific.
