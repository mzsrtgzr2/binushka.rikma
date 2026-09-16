---
layout: default
title: תודה על ההזמנה
description: התשלום התקבל. סיכום ההזמנה מופיע למטה.
permalink: /thanks/
---

<div class="container">
  <div class="page-head">
    <h1 class="page-title">{{ page.title }}</h1>
    <p class="page-description">{{ page.description }}</p>
  </div>
</div>

<div class="thanks-page checkout-page container animate">
  <div class="thanks-content checkout-content">
    <section class="thanks-section checkout-summary">
      <h2>ההזמנה התקבלה</h2>
      <ul class="status-list">
        <li>התשלום בוצע בהצלחה</li>
        <li>קבלה תישלח לאימייל שהזנת בקופה</li>
      </ul>
    </section>

    <section class="thanks-section checkout-summary" id="thanks-order" hidden>
      <h2>מה הזמנת</h2>
      <ul class="checkout-lines" id="thanks-lines"></ul>
      <p class="checkout-subtotal" id="thanks-shipping-row" hidden></p>
      <p class="checkout-grand-total">סה״כ שולם: <strong id="thanks-total">₪0</strong></p>
    </section>

    <section class="thanks-section">
      <h2>מה הלאה?</h2>
      <ul>
        <li>אם בחרת משלוח, נעדכן כשהחבילה יוצאת לדרך.</li>
        <li>אם בחרת איסוף מרחובות, נתאם איתך מועד בואטסאפ או בטלפון.</li>
        <li>שאלות? <a href="{{ '/contact/' | relative_url }}">צרי קשר</a> או 054-4247753</li>
      </ul>
      <p>
        <a class="button button--primary" href="{{ '/store/' | relative_url }}">חזרה לחנות</a>
      </p>
    </section>
  </div>
</div>
