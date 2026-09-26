# Mixpanel analytics

Mixpanel is the analytics tool for this site. Google Analytics is not used.

## Setup

- Platform: Jekyll, browser JavaScript. There is no frontend bundler, so the SDK is the official snippet in `_includes/mixpanel.html` (library from `https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js`).
- Token: `_data/settings.yml` key `mixpanel-token`. The snippet is included from `_layouts/default.html` and `_layouts/retreat.html` only when that key is set.
- `_layouts/admin.html` does not load Mixpanel. Keep it that way so admin work stays out of the project.
- Init options: `track_pageview: true`, `autocapture: false`, `persistence: "localStorage"`. A super property `platform: "web"` is registered immediately after init.
- Do not set `autocapture: true` together with `track_pageview: true`. Autocapture already records page views, and the combination duplicates them. Do not add manual `page_view` events either.
- Session replay is off. Microsoft Clarity remains the optional recording tool (`clarity` in `_data/settings.yml`).

## Events

`js/analytics.js` owns the schema and exposes `window.Analytics`. `store-cart.js`, `checkout.js`, `thanks.js`, and `store-sort.js` call it. Calls are a no-op when `window.mixpanel` is missing.

| Event | Trigger |
| --- | --- |
| `view_item_list` | Store or workshop list rendered |
| `select_item` | Click a product card in a list |
| `view_item` | Product or workshop page |
| `add_to_cart` | Add a unit to the cart |
| `view_cart` | Cart drawer opens |
| `remove_from_cart` | Remove or decrement a line |
| `begin_checkout` | `/checkout/` loads with items |
| `add_shipping_info` | Shipping method chosen |
| `add_payment_info` | Checkout form passes validation |
| `purchase` | `/thanks/` after payment |
| `add_to_cart_blocked` | Add failed (`reason`: `out_of_stock`, `stock_limit`, `invalid_amount`, `no_variant_selected`) |
| `cart_checkout_click` | Checkout link in the cart drawer |
| `checkout_form_start` | First focus in the checkout form |
| `checkout_error` | Checkout blocked (`stage`: `arrival`, `validation`, `payment`) |
| `checkout_abandoned` | Leave `/checkout/` with items, before payment |
| `store_filter` | Store category filter |
| `store_sort` | Store sort |
| `contact_click` | WhatsApp, email, or phone link |
| `purchase_untracked` | `/thanks/` with no order in the session |

`purchase` is the value moment: a completed shop order.

There is no customer account, so there is no `sign_up_completed` event. Newsletter signup is an email list, not an account. Do not call `mixpanel.identify()` with an email address, and do not call `mixpanel.people.set()` for anonymous shoppers. If accounts are added later: create the user first, then `identify(database id)`, then `people.set()`, then `track('sign_up_completed')`, and call `reset()` on logout.

## Property rules

- `snake_case` event and property names. Do not build names dynamically.
- Numbers are numbers (`price`, `value`, `quantity`, `shipping`, `items_count`).
- Omit empty strings and nulls. Do not send a property that does not apply.
- Do not send a nested `items` array. One line is flattened to `item_id`, `item_name`, `item_category`, `item_variant`, `price`, `quantity`. Several lines become `item_ids`, `item_names`, `item_quantities`, and `item_prices`.
- `purchase` sets `$insert_id` from `transaction_id` (`BNK-...`). `/thanks/` also skips a repeat with the same ref in `localStorage`.
- Do not send names, phones, emails, or addresses.

## Check

Add `?analytics_debug=1` and confirm `[analytics]` lines in the console. In Mixpanel, open Live View and trigger `add_to_cart`. The same flag is stored in `localStorage` until `?analytics_debug=0`.
