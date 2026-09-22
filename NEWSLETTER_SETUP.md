# Newsletter

The newsletter is self-hosted. Issues are files in this repository, the
subscriber list lives in Vercel Blob, and mail goes out through the studio's own
Gmail account. There is no newsletter provider and no monthly bill.

## Why there is no provider

The obvious choice was beehiiv, and it was built that way first. It cannot work:
creating and sending a post over the API is restricted to beehiiv's Enterprise
plan, and every plan below it — including Scale — answers
`SEND_API_NOT_ENTERPRISE_PLAN`. A backoffice with a send button could never have
driven it, so the whole pipeline is ours instead.

## How it fits together

| Part | Where it lives | Notes |
| --- | --- | --- |
| Issue content | `_newsletter/<slug>.md` | A Jekyll collection, committed by the backoffice |
| Archive and teaser | Rendered by Liquid at build time | No API call, no cache to invalidate |
| Subscriber list | Vercel Blob | Never in this repository — it is public |
| Delivery | Gmail SMTP | One message per recipient |
| Unsubscribe | Signed token in every mail | One click, no typing |

Writing an issue commits a file, which triggers a Vercel build, which publishes
the issue page and updates the archive and the home page teaser. Sending reads
the list and mails everyone, then commits the result back onto the issue.

## One-time setup

### 1. Subscriber storage

In the Vercel dashboard open **Storage → Create → Blob**, and connect the store
to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` to the environment itself.
Hobby includes 1 GB and 2,000 writes a month, which is far more than a mailing
list of this size consumes.

### 2. Signing secret

```bash
openssl rand -hex 32
```

Save it as `NEWSLETTER_SECRET`. It signs the unsubscribe link in every issue, so
rotating it breaks the unsubscribe link in mail that has already been delivered.
Treat it as permanent.

### 3. Gmail

Google stopped accepting account passwords for SMTP, so this needs an app
password:

1. Turn on 2-Step Verification at [myaccount.google.com/security](https://myaccount.google.com/security).
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and create one.
3. Set `GMAIL_USER` to the address and `GMAIL_APP_PASSWORD` to the 16-character
   value, with no spaces.

Gmail rewrites the `From:` header to `GMAIL_USER` regardless of what we ask for,
so the newsletter always appears to come from that mailbox.

### 4. Site URL

Set `SITE_URL` to `https://rikma.binushka.com`. Without it, a send triggered from
a preview deployment would put preview links inside real mail.

## Sending limits

Personal Gmail accepts 500 recipients per rolling 24 hours, Workspace 2,000.
`NEWSLETTER_DAILY_CAP` defaults to 400 to stay clear of that line. A send that
hits the cap, or that runs past the function time limit, stops and reports how
many are left; pressing send again continues from there.

This is the part that does not scale. Somewhere above a few hundred subscribers
Gmail stops being the right sender and the delivery module has to point at a
real mail service. Nothing else in the pipeline has to change: `lib/newsletter/mailer.mjs`
is the only file that knows how mail leaves the building.

## Writing and sending an issue

Go to `/admin/newsletter/` and log in with `ADMIN_PASSWORD`. The backoffice is
one place with tabs — `/admin/store/` and `/admin/newsletter/` — sharing a
password and a session, so logging into either covers both.

1. **גיליון חדש** opens the editor. The body is Markdown; the panel beside it
   previews the result as it is typed.

   Images can be uploaded from either **העלאת תמונה** (the issue's main image)
   or **הוספת תמונה לטקסט** (inserted as `![](...)` wherever the caret is). The
   browser resizes anything over 1600px and re-encodes it as JPEG first, then
   the file is committed to `images/newsletter/<year-month>/` with a unique
   name, so uploading the same filename twice never replaces an image an
   already-sent issue still points at.

   A freshly uploaded image is only served from `/images/...` after the next
   site build, so until then the preview shows the copy the browser already
   has rather than a broken image.

   **הוספת קישור** opens a small panel that searches the site — store items,
   posts, projects, pages and issues that have already gone out — and inserts
   the choice as a Markdown link. Type to filter, move with the arrow keys,
   Enter picks the highlighted row. Selecting words in the body before opening
   the panel uses them as the link text and wraps them in place instead of
   repeating them. Anything not on the site can be pasted into the address
   field directly.

   The suggestions come from a JSON block that `_includes/admin-link-index.html`
   writes into the page at build time, so the list reflects the last deploy: a
   store item added minutes ago appears once its build has run. Only published
   things are listed — draft issues are left out, and so are the admin screens,
   which is what their `noindex` is taken to mean.
2. **שמירה** commits `_newsletter/<slug>.md` as a draft. Drafts get a page so
   they can be previewed and linked, but they are `noindex`, kept out of the
   sitemap, and left out of the archive and the teaser.
3. **שליחת בדיקה** sends the issue to one address and changes nothing else. Worth
   doing every time: it is the only way to see the mail as a reader will.
4. **שליחה לכל הרשימה** mails everyone, flips the issue to `sent`, and records
   the recipient count. The issue then appears in the archive and as the teaser
   on the home page.

### Editing and deleting

Any issue in the list opens in the editor, and saving writes over the same
file. Renaming the title of an issue that already exists keeps the slug it was
first saved under, so the URL does not move and no second file appears
alongside the first.

A draft can be deleted from inside the editor. Images uploaded into it stay
where they are: another issue may point at the same file, and an orphaned
image costs nothing.

A sent issue can still be edited, because the archive is a page on the site and
a typo there is worth fixing after the mail has gone. What it cannot do is go
out again or be deleted — sending is refused with `already_sent`, the delete
button is hidden, and a save keeps the sent status along with when it went and
how many received it. So a correction improves the page without ever turning
into a second send, and the record of what actually happened survives it.

### The file format

```markdown
---
title: 'סדנת רקמה לאביב'
subtitle: 'מה חדש בסטודיו החודש'
date: 2026-09-18T07:00:00.000Z
thumbnail: '/images/gallery/fox.png'
status: sent
sent_at: 2026-09-18T07:04:00.000Z
recipients: 42
---

Markdown body.
```

`promotional: false` drops the `פרסומת:` prefix from the subject. Leave it off
for anything that advertises, which is nearly everything.

Paths in the body are written site-relative, the way they are everywhere else
in this repository. They are rewritten to absolute URLs when an issue is sent:
an inbox has no page to resolve `/images/...` against, so a relative path there
would simply never load.

## Unsubscribing

Every issue carries a link built from an HMAC of the recipient's address, so a
reader is removed in one click without typing anything and nobody can
unsubscribe anyone else by editing the URL. The same link goes into the
`List-Unsubscribe` and `List-Unsubscribe-Post` headers, which is what makes
Gmail show its own unsubscribe button — worth having, because a reader who uses
it is not reporting the mail as spam instead.

`/newsletter/` also has a form for typing an address, and it answers the same
way whether or not the address was on the list, so it cannot be used to find out
who subscribed.

Someone who signs up is mailed a confirmation immediately, and that mail carries
the same removal link. That is the protection against being signed up by someone
else: no double opt-in step, but a way out that arrives within seconds.

## Legal notes

Israeli spam law (סעיף 30א לחוק התקשורת) governs this, and three of its
requirements are handled in code rather than by a provider:

- **Marking.** Commercial issues get `פרסומת:` in the subject. This is the
  default; opt out per issue only when the content genuinely is not advertising.
- **Identification.** Every mail carries the sender line from
  `lib/newsletter/email-copy.mjs`.
- **Removal.** The one-click link above, processed immediately rather than
  within the two business days the law allows.

Consent comes from the signup form, which states what the reader is agreeing to.
Do not import addresses collected anywhere else into the list.

## Checking a deployment

`GET /api/newsletter/subscribe` reports which pieces are configured without
printing any of them:

```json
{ "configured": true, "hasSubscriberStore": true, "hasSigningSecret": true, "hasMailer": true }
```

The backoffice shows the same thing as a line above the issue list, along with
the subscriber count and the sending address.

## Trying it on a preview deployment

A preview is a full copy of the API, so everything except the final send can be
exercised there. Two things make that safe.

A preview commits to the branch it was deployed from, ignoring `GITHUB_BRANCH`
even when that variable names the production branch for every environment at
once. Saving an issue on a preview therefore rebuilds that same preview, and
cannot touch what the public site is built from.

A full send from a preview is refused with `preview_send_blocked`. The blob
store is normally shared with production, which means the subscriber list on a
preview is the real one, and mail cannot be recalled. Test sends to a single
address always work, and that is what the layout should be checked with.

For the preview's API to work at all, the newsletter variables have to be
enabled for the Preview environment in Vercel, not only for Production:
`BLOB_READ_WRITE_TOKEN`, `NEWSLETTER_SECRET`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, `ADMIN_PASSWORD` and `GITHUB_TOKEN`.

Leave `SITE_URL` unset for Preview. Links inside a mail then point at the
preview's own host, so an unsubscribe link from a test send exercises the
preview rather than production. With `SITE_URL` set to the live domain, a test
send's links lead to the live site instead — correct for production, confusing
while testing.

Two caveats worth expecting. A preview subscribing through the signup form
writes to the shared blob store, so it adds a real subscriber; unsubscribe
afterwards, or connect a separate store to Preview. And an image uploaded on a
preview is committed to the branch, so it only appears at `/images/...` once
that push has redeployed — the editor's preview shows it immediately either way.

## Running it locally

```bash
npm install
bundle install
bundle exec jekyll build
node --test
```

Setting `ADMIN_LOCAL_ROOT` to the repository root makes the backoffice write
issue files straight to disk instead of committing them, which is how the tests
exercise the save, edit and delete paths.
