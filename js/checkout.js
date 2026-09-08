/**
 * Checkout page ("/checkout/") form handling.
 *
 * This currently validates and collects the customer's personal details
 * required by our payment processor (Grow) before purchase, as required by
 * their site-approval checklist: first name, last name, phone (no country
 * prefix), address, and email.
 *
 * TODO (future work, once the shopping cart is built):
 * 1. Replace the placeholder `handleCheckoutSubmit` behavior below with a
 *    call to our own serverless endpoint, e.g. a Vercel function such as
 *    `/api/create-payment-link`.
 * 2. That serverless function (NOT this client-side code) should hold the
 *    Grow `x-api-key` / `userId` / `pageCode` credentials and call Grow's
 *    `createPaymentLink` API server-to-server, sending it the cart total,
 *    products, and this customer's details.
 * 3. Grow requests must never be sent directly from the browser - they are
 *    blocked server-side by Grow and would also leak API credentials.
 * 4. On success, redirect the browser to the `paymentLinkUrl` returned by
 *    Grow (their hosted, PCI-compliant payment page).
 * 5. After the customer pays, Grow calls our webhook/server-update URL;
 *    our server must respond 200 and then call Grow's `approveTransaction`
 *    endpoint to finalize the charge before showing a "thank you" page.
 *
 * See GROW_PAYMENTS_SETUP.md at the repo root for the full integration plan.
 */
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('checkout-form');
  if (!form) {
    return;
  }

  var messageEl = document.getElementById('checkout-form-message');

  function showMessage(text, type) {
    if (!messageEl) {
      return;
    }
    messageEl.textContent = text;
    messageEl.className = 'checkout-form__message checkout-form__message--' + type;
    messageEl.style.display = 'block';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    var data = Object.fromEntries(new FormData(form).entries());

    // Placeholder until the shopping cart + Vercel/Grow integration exists.
    // See TODO block above for the intended production flow.
    console.log('Checkout details captured (payment integration pending):', data);
    showMessage(
      'תודה! עגלת הקניות והתשלום המקוון נמצאים בהשלמה, ניצור איתך קשר להשלמת ההזמנה בהקדם.',
      'info'
    );
    form.reset();
  });
});
