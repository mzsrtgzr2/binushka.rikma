# מעקב התנהגות משתמשים באתר

מסמך זה מסביר מה נמדד באתר ואיך רואים את זה ב-Mixpanel, כולל דוח המשפך שמראה **איפה הגולשות נופלות**.

האתר שולח אירועים ל-Mixpanel (פרויקט טוקן ב-`_data/settings.yml`, מפתח `mixpanel-token`). Google Analytics הוסר.

צפיות בעמוד ולחיצות נשלחות אוטומטית (Autocapture). אין `track_pageview` בנוסף, כדי שצפייה בעמוד לא תיספר פעמיים. פעולות החנות (הוספה לסל, קופה, רכישה) נשלחות גם כאירועים מפורשים. Session Replay דלוק על כל הגלישות, ושדות טקסט מוסתרים בהקלטה.

## 1. האירועים שנשלחים

### משפך הרכישה

| # | אירוע | מתי נשלח | פרמטרים מעניינים |
| --- | --- | --- | --- |
| 1 | `view_item_list` | טעינת `/store/` או רשימת הסדנאות | `item_ids`, `item_names`, `item_list_name` |
| 2 | `select_item` | לחיצה על כרטיס מוצר ברשימה | `item_id`, `item_name` |
| 3 | `view_item` | צפייה בעמוד מוצר / סדנה | `item_id`, `item_name`, `price` |
| 4 | `add_to_cart` | הוספה לסל (כולל +1 בעגלה) | `item_id`, `item_name`, `value` |
| 5 | `view_cart` | פתיחת מגירת העגלה | `item_ids`, `value` |
| 6 | `remove_from_cart` | הסרה או הפחתת כמות | `item_id`, `item_name` |
| 7 | `begin_checkout` | טעינת `/checkout/` עם סל מלא | `item_ids`, `value` |
| 8 | `add_shipping_info` | בחירת שיטת משלוח (או שליחת הטופס) | `shipping_tier` |
| 9 | `add_payment_info` | לחיצה על "המשך לתשלום" שעברה ולידציה | `value`, `payment_type` |
| 10 | `purchase` | הגעה ל-`/thanks/` | `transaction_id`, `value`, `shipping` |

הערכים נשלחים ב-₪ (`currency: ILS`) כמספרים, לא כטקסט.

כשיש פריט אחד, השדות שלו שטוחים: `item_id`, `item_name`, `item_category`, `item_variant`, `price`, `quantity`. `item_ids` ו-`item_names` נשלחים תמיד. כשיש כמה פריטים (עגלה, קופה, רכישה) נוספות גם `item_quantities` ו-`item_prices`. אין מערך `items` מקונן — ב-Mixpanel אי אפשר לפרק אובייקטים מקוננים בדוחות.

### אירועי אבחון — למה הגולשת נעצרה

| אירוע | מה הוא מספר | פרמטרים |
| --- | --- | --- |
| `add_to_cart_blocked` | מישהי ניסתה להוסיף לסל ולא הצליחה — **ביקוש אבוד** | `item_name`, `reason`: `out_of_stock` / `stock_limit` / `invalid_amount` / `no_variant_selected` |
| `cart_checkout_click` | לחצו "מעבר לתשלום" במגירת העגלה | `value`, `items_count` |
| `checkout_form_start` | התחילו למלא את טופס התשלום | `items_count` |
| `checkout_error` | הטופס נחסם | `stage`: `arrival` / `validation` / `payment`, `first_invalid_field`, `invalid_fields`, `error_message` |
| `checkout_abandoned` | יצאו מ-`/checkout/` עם סל מלא בלי להגיע לתשלום | `last_field` (השדה האחרון שנגעו בו), `fields_filled`, `value` |
| `store_filter` | סוננה קטגוריה בחנות | `category`, `results` |
| `store_sort` | שונה סדר המיון | `sort_by` |
| `contact_click` | לחיצה על וואטסאפ / מייל / טלפון | `method` |
| `purchase_untracked` | הגיעו ל-`/thanks/` בלי הזמנה שמורה בדפדפן | `reason` |

השדות בעברית (`first_invalid_field: "טלפון"`) כדי שהדוחות יהיו קריאים בלי תרגום.

בניגוד ל-GA4, Mixpanel שומר כל פרמטר מהאירוע הראשון. אין צורך לרשום Custom Dimensions מראש.

## 2. מה לראות ב-Mixpanel

### א. Live View — לוודא שה-deploy עבד

[Live View](https://docs.mixpanel.com/docs/tracking-methods/live-view) מראה אירועים תוך שניות. אחרי deploy: לפתוח את האתר, להוסיף מוצר לסל, ולוודא ש-`add_to_cart` מופיע עם `item_name`, `price` ו-`currency`.

### ב. משפך

ב-Mixpanel: **Funnels**, חמישה שלבים:

1. `view_item`
2. `add_to_cart`
3. `begin_checkout`
4. `add_payment_info`
5. `purchase`

כדאי משפך פתוח (כל שלב יכול להיות הכניסה), ופירוט לפי סוג מכשיר. המשפך סופר משתמשים, לא אירועים.

### ג. איפה נופלים

| איפה נופלים | מה זה אומר | איפה לחפש פרטים |
| --- | --- | --- |
| `view_item` ← `add_to_cart` | המחיר, התמונות או תיאור המוצר לא משכנעים | `add_to_cart_blocked` — אולי פשוט אזל המלאי |
| `add_to_cart` ← `begin_checkout` | לא מבינים איך להגיע לקופה, או נבהלים מדמי המשלוח | להשוות `cart_checkout_click` מול `begin_checkout` |
| `begin_checkout` ← `add_payment_info` | **הטופס עצמו הוא הבעיה** | `checkout_error` עם `stage=validation` — `first_invalid_field` אומר איזה שדה חוסם |
| `add_payment_info` ← `purchase` | תקלת סליקה או נטישה בדף של Grow | `checkout_error` עם `stage=payment` ו-`error_message` |

Insights ← טבלה: Breakdown לפי `first_invalid_field`, פילטר `checkout_error`. אותה טבלה עם `reason` ופילטר `add_to_cart_blocked` מראה ביקוש שנחסם בגלל מלאי.

אפשר לסמן את `purchase`, `begin_checkout` ו-`add_to_cart` ב-Lexicon כדי שיהיו קלים למציאה. תיאורי Lexicon: [Lexicon](https://docs.mixpanel.com/docs/data-governance/lexicon).

## 3. Microsoft Clarity (משלים את Mixpanel)

Mixpanel אומר **כמה** ו**איפה**. הוא לא אומר **למה**.
[Clarity](https://clarity.microsoft.com) נותן הקלטות מסך ומפות חום.

הקוד כבר מוכן באתר. כדי להפעיל:

1. להיכנס ל-[clarity.microsoft.com](https://clarity.microsoft.com) ולהתחבר.
2. ליצור פרויקט חדש עם כתובת האתר `https://rikma.binushka.com`.
3. להעתיק את ה-Project ID.
4. להדביק אותו ב-`_data/settings.yml`:

```yaml
clarity: abc123xyz
```

5. לעשות deploy.

כל עוד השדה ריק — הסקריפט לא נטען כלל.

## 4. איך בודקים שזה עובד

### בזמן פיתוח

להוסיף `?analytics_debug=1` לכל כתובת באתר. מאותו רגע כל אירוע נרשם ב-Console:

```
[analytics] add_to_cart {currency: "ILS", item_id: "kit", item_name: "Kit", price: 210, value: 210}
```

המצב נשמר ב-`localStorage`. לכיבוי: `?analytics_debug=0`.

### בייצור

Live View, כמו בסעיף 2א. אירועים בדוחות הרגילים מופיעים תוך דקות, ולפעמים לוקח להם עד שעה להתייצב ב-Insights.

## 5. הערות טכניות

- **מבנה הקוד**: `js/analytics.js` מגדיר את `window.Analytics`. `store-cart.js`, `checkout.js`, `thanks.js` ו-`store-sort.js` קוראים לו. כל קריאה היא no-op כשאין `mixpanel` (חוסם פרסומות, או שהטוקן ריק) — האתר והעגלה ממשיכים לעבוד.
- **זהות**: אין חשבון משתמשת בחנות. Mixpanel מזהה דפדפן אנונימי (`distinct_id` ב-`localStorage`). לא נשלחים מייל, טלפון, שם או כתובת, ואין `identify`. עמוד הניהול (`/admin/`) לא טוען את Mixpanel.
- **`transaction_id`**: נוצר בצד הלקוח בזמן המעבר לתשלום (`BNK-...`). Mixpanel מסנן כפילות של `purchase` לפי `$insert_id` שזהה למזהה הזה, ו-`localStorage` מונע ספירה כפולה אם רועננו את `/thanks/`.
- **דיוק של `purchase`**: האירוע נשלח כשהגולשת חוזרת ל-`/thanks/` אחרי התשלום. אם היא סוגרת את הדפדפן בדף של Grow מיד אחרי חיוב מוצלח, הרכישה לא תיספר. ספירה מהשרת (webhook של Grow) דורשת את אותו `distinct_id` של הדפדפן, אחרת Mixpanel יפתח משתמשת נפרדת.
- **פרטיות**: המשלוחים הם בישראל, ואין באנר הסכמה. אם יהיו גולשות מאירופה או מקליפורניה, צריך שער הסכמה (`opt_out_tracking_by_default`) לפני `mixpanel.init`. Session Replay מקליט את הגלישה; שדות טקסט מוסתרים כברירת מחדל. Clarity נשאר אופציונלי.
- **פרויקט אחד**: הטוקן הזה הוא הפרויקט היחיד, כולל תנועה מקומית אם מריצים את האתר מולו. לפני שמערבבים פיתוח עם ייצור לאורך זמן, כדאי פרויקט dev נפרד. אזור הזמן של הפרויקט צריך להיות `Asia/Jerusalem`, ואי אפשר לשנות אותו רטרואקטיבית בלי להזיז נתונים היסטוריים.
