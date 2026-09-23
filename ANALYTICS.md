# מעקב התנהגות משתמשים באתר

מסמך זה מסביר מה נמדד באתר, איך רואים את זה ב-Google Analytics, ואיך בונים את דוח המשפך (funnel) שמראה **איפה הגולשות נופלות**.

## 1. מה היה חסר

ב-GA4 היה מותקן רק הסניפט הבסיסי (`G-G3QBFMD0FQ`) — כלומר נמדדו **צפיות בעמודים בלבד**.
GA4 לא יודע מעצמו מהו "מוצר", מהי "עגלה" ומהו "checkout" — צריך לשלוח לו אירועי מסחר מפורשים.
בלי זה אפשר לראות "50 אנשים ביקרו ב-/checkout/" אבל לא מה היה בסל שלהם ולמה הם לא סיימו.

עכשיו האתר שולח את **אירועי המסחר הסטנדרטיים של GA4** בתוספת אירועי אבחון לנקודות הנשירה.

## 2. האירועים שנשלחים

### משפך הרכישה (אירועי GA4 סטנדרטיים)

| # | אירוע | מתי נשלח | פרמטרים מעניינים |
| --- | --- | --- | --- |
| 1 | `view_item_list` | טעינת `/store/` או רשימת הסדנאות | `items`, `item_list_name` |
| 2 | `select_item` | לחיצה על כרטיס מוצר ברשימה | `items` |
| 3 | `view_item` | צפייה בעמוד מוצר / סדנה | `items` |
| 4 | `add_to_cart` | הוספה לסל (כולל +1 בעגלה) | `items`, `value` |
| 5 | `view_cart` | פתיחת מגירת העגלה | `items`, `value` |
| 6 | `remove_from_cart` | הסרה או הפחתת כמות | `items` |
| 7 | `begin_checkout` | טעינת `/checkout/` עם סל מלא | `items`, `value` |
| 8 | `add_shipping_info` | בחירת שיטת משלוח (או שליחת הטופס) | `shipping_tier` |
| 9 | `add_payment_info` | לחיצה על "המשך לתשלום" שעברה ולידציה | `value` |
| 10 | `purchase` | הגעה ל-`/thanks/` | `transaction_id`, `value`, `shipping` |

הערכים נשלחים ב-₪ (`currency: ILS`), ולכן GA4 יציג הכנסות אמיתיות.

### אירועי אבחון — למה הגולשת נעצרה

אלה לא אירועים סטנדרטיים של GA4, והם החלק שעונה על "איפה ה-flow נתקע":

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

השדות בעברית (`first_invalid_field: "טלפון"`) כדי שהדוחות יהיו קריאים בלי תרגום.

## 3. מה לעשות ב-Google Analytics (פעם אחת)

### א. לסמן `purchase` כהמרה

`ניהול (Admin)` ← `אירועים (Events)` ← למצוא את `purchase` ← להדליק **"סמן כאירוע מפתח / Mark as key event"**.
כדאי לסמן גם `begin_checkout` ו-`add_to_cart` כדי לראות אותם בדוחות הראשיים.

> האירועים מופיעים ברשימה רק אחרי שהם נשלחו לפחות פעם אחת. עד אז אפשר להוסיף אותם ידנית דרך `אירוע חדש`.

### ב. לרשום את הפרמטרים המותאמים

GA4 **לא שומר** פרמטרים מותאמים עד שמגדירים אותם כ-Custom Dimension. זה השלב הכי חשוב — בלעדיו `reason` ו-`last_field` פשוט לא יופיעו בדוחות.

`ניהול` ← `הגדרות מותאמות אישית (Custom definitions)` ← `צור מימד מותאם` ← היקף (Scope) = **Event**:

| שם המימד | Event parameter |
| --- | --- |
| סיבת חסימה | `reason` |
| שלב בקופה | `stage` |
| שדה חוסם | `first_invalid_field` |
| שדה אחרון | `last_field` |
| שדות שמולאו | `fields_filled` |
| הודעת שגיאה | `error_message` |
| קטגוריה בחנות | `category` |
| שיטת יצירת קשר | `method` |

(מגבלת GA4 היא 50 מימדים, אז יש מקום בשפע.)

### ג. לבנות את דוח המשפך

`חקירה (Explore)` ← `חקירת משפך (Funnel exploration)`, ולהגדיר שלבים לפי האירועים:

1. `view_item`
2. `add_to_cart`
3. `begin_checkout`
4. `add_payment_info`
5. `purchase`

להדליק **"הצג משפך פתוח (Open funnel)"** ולהוסיף `פירוט (Breakdown)` לפי מכשיר — כמעט תמיד מתגלה שהנשירה בנייד גדולה בהרבה.

המשפך יראה אחוז נשירה בין כל שני שלבים. השלב עם האחוז הגרוע ביותר הוא מה שכדאי לתקן.

### ד. לפרש את הנשירה

| איפה נופלים | מה זה אומר | איפה לחפש פרטים |
| --- | --- | --- |
| `view_item` ← `add_to_cart` | המחיר, התמונות או תיאור המוצר לא משכנעים | לבדוק `add_to_cart_blocked` — אולי פשוט אזל המלאי |
| `add_to_cart` ← `begin_checkout` | לא מבינים איך להגיע לקופה, או נבהלים מדמי המשלוח | להשוות `cart_checkout_click` מול `begin_checkout` |
| `begin_checkout` ← `add_payment_info` | **הטופס עצמו הוא הבעיה** | `checkout_error` עם `stage=validation` — הפרמטר `first_invalid_field` אומר בדיוק איזה שדה חוסם |
| `add_payment_info` ← `purchase` | תקלת סליקה או נטישה בדף של Grow | `checkout_error` עם `stage=payment` והפרמטר `error_message` |

הדוח הכי שימושי לתחילת עבודה: `חקירה` ← `טבלה חופשית`, שורות = `first_invalid_field`, מדד = מספר אירועים, מסונן ל-`checkout_error`. זה נותן רשימה ממוינת של השדות שהכי מעכבים את הגולשות.

## 4. Microsoft Clarity (מומלץ — משלים את GA4)

GA4 אומר **כמה** ו**איפה**. הוא לא אומר **למה**.
[Clarity](https://clarity.microsoft.com) הוא חינמי ובלי מגבלת תנועה, ונותן הקלטות מסך של גלישות אמיתיות ומפות חום — כולל דוח "rage clicks" (לחיצות עצבניות על משהו שלא עובד) ו-"dead clicks".

ההקלטה של גולשת שמגיעה ל-`/checkout/`, מנסה למלא טלפון, נכשלת ועוזבת — שווה יותר מכל דוח.

הקוד כבר מוכן באתר. כדי להפעיל:

1. להיכנס ל-[clarity.microsoft.com](https://clarity.microsoft.com) ולהתחבר.
2. ליצור פרויקט חדש עם כתובת האתר `https://rikma.binushka.com`.
3. להעתיק את ה-Project ID (מחרוזת קצרה כמו `abc123xyz`).
4. להדביק אותו ב-`_data/settings.yml`:

```yaml
clarity: abc123xyz
```

5. לעשות deploy. זהו.

כל עוד השדה ריק — הסקריפט לא נטען כלל ואין שום השפעה על האתר.
ב-Clarity כדאי גם לחבר את GA4 (`Settings` ← `Google Analytics integration`), ואז אפשר לקפוץ מדוח ב-GA4 ישירות להקלטות הרלוונטיות.

## 5. איך בודקים שזה עובד

### בזמן פיתוח

להוסיף `?analytics_debug=1` לכל כתובת באתר. מאותו רגע כל אירוע נרשם ב-Console של הדפדפן:

```
[analytics] add_to_cart {currency: "ILS", items: [{item_id: "kit", ...}], value: 210}
```

המצב נשמר ב-`localStorage`, כך שהוא ממשיך לעבוד גם במעבר בין עמודים. לכיבוי: `?analytics_debug=0`.

### בייצור

ב-GA4: `ניהול` ← `DebugView`, או `דוחות` ← `בזמן אמת`. לפתוח את האתר, להוסיף מוצר לסל, ולראות את האירועים נכנסים תוך שניות.

## 6. הערות טכניות

- **מבנה הקוד**: `js/analytics.js` מגדיר את `window.Analytics` ואת סכמת האירועים. `store-cart.js`, `checkout.js`, `thanks.js` ו-`store-sort.js` קוראים לו. כל קריאה היא no-op כשאין `gtag` (חוסם פרסומות, או GA כבוי) — האתר והעגלה ממשיכים לעבוד רגיל.
- **`transaction_id`**: נוצר בצד הלקוח בזמן המעבר לתשלום (`BNK-...`) ונשמר יחד עם ההזמנה. GA4 מסנן כפילויות לפי המזהה הזה, ו-`localStorage` מונע ספירה כפולה אם רועננו את `/thanks/`.
- **דיוק של `purchase`**: האירוע נשלח כשהגולשת חוזרת ל-`/thanks/` אחרי התשלום. אם היא סוגרת את הדפדפן בדף של Grow מיד אחרי חיוב מוצלח, הרכישה לא תיספר. לספירה מדויקת ב-100% צריך לשלוח את האירוע מהשרת (Measurement Protocol) מתוך webhook של Grow — שדרוג אפשרי בהמשך.
- **עמוד הניהול** (`/admin/`) לא טוען את GA כלל, כך שהעבודה השוטפת לא מזהמת את הנתונים.
- **פרטיות**: לא נשלחים שמות, טלפונים, כתובות או מיילים — רק שמות השדות שנכשלו. Clarity ממסך שדות טקסט כברירת מחדל.
