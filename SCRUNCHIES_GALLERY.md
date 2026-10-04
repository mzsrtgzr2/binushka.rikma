# גלריית סקראנצ'יז (עמוד נסיוני)

עמוד נסיוני ונפרד מהעמוד החי. **לא מקושר מהתפריט, לא באינדקס, לא בסיטמאפ.**
כל עוד זה בפיתוח — הכל נשאר ב-branch `feat/scrunchies-gallery`. אין לשנות master עד אישור מפורש.

## כתובת
`/scrunchies-gallery/`

## הקונספט
במקום חלוקה לפי סוג (רגיל / לארג' / Fancy), כל סקראנצ'י הוא פריט בפני עצמו:
תמונה + שם + מחיר + כפתור "הוסיפי לסל".

## איך מוסיפים סקראנצ'י חדש
1. שומרים את התמונה תחת `images/scrunchies/gallery/<slug>.jpeg` (אפשר אחר כך, בינתיים אפשר להפנות לקובץ קיים).
2. יוצרים קובץ `_store/<slug>.md`:
   ```yaml
   ---
   title: "סקראנצ'י — <שם הבד>"
   subtitle: <תיאור קצר>
   image: /images/scrunchies/gallery/<slug>.jpeg
   price: ₪<מחיר>
   cart_price: <מחיר>
   hide: true          # לא מופיע בחנות הרגילה
   noindex: true
   sitemap: false
   scrunchie_gallery: true   # מסמן שזה שייך לגלריה
   order: <מספר סדר>
   category: scrunchies-gallery
   ---
   ```
3. מריצים `node scripts/build-catalog.js`.
4. commit + push ל-branch.

העמוד מציג אוטומטית כל פריט עם `scrunchie_gallery: true`.

## פריטים לדוגמה כרגע
- `scrunchie-demo-linen` — ₪35
- `scrunchie-demo-floral` — ₪40
- `scrunchie-demo-lace` — ₪55

(התמונות כרגע הן תמונות קיימות מהסקראנצ'ים — להחליף בתמונות אמיתיות בהמשך.)
