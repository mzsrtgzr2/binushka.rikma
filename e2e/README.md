# e2e (real browser)

```
npm run test:e2e
```

Two tests:

1. **checkout posts the cart and follows the payment url** — runs locally. The
   page is served from `_site` by `scripts/e2e-server.mjs`; the `POST /api/checkout/`
   response is mocked, so no payment form is created anywhere. Proves the cart,
   the form, the payload and the redirect work in a real Chromium.
2. **a real sandbox payment form opens** — opt-in. Needs `E2E_SANDBOX=1` and a
   deployment where `MORNING_ENV=sandbox` and the sandbox Morning keys are set.
   It fills the checkout, submits for real and asserts the browser lands on a
   `https://sandbox.*` payment page with an amount.

```
E2E_BASE_URL=https://<preview>.vercel.app E2E_SANDBOX=1 npm run test:e2e
```

The target must be sandbox: never point `E2E_SANDBOX=1` at production, because
the test would create a real payment form. Nothing here pays a card, so stock is
never touched — payment notify is only reached by an actual payment.

Local run needs `_site` built (`bundle exec jekyll build`) and Chromium at
`/usr/bin/chromium` (override with `CHROMIUM_PATH`).

## payment callback (no card, no captcha, no mailbox)

```
npm run test:e2e:notify
```

Runs the real `/api/payment-notify` handler over HTTP with `E2E_NOTIFY_STUB=1`:
a throwaway copy of `_store`, a signed order token made the same way checkout
makes it, a fake Morning document lookup, and a fake SMTP transport that keeps
the message in memory. It asserts stock drops exactly once, Morning's retry is
a no-op, a document for another amount and a tampered token change nothing, and
the owner summary is composed and sent exactly once (recipient, sender, subject,
customer details and total). No card, no captcha, no human and no real email.
