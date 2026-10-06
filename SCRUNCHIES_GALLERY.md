# גלריית סקראנצ'יז (עמוד נסיוני)

עמוד נסיוני ונפרד מהעמוד החי. **לא מקושר מהתפריט, לא באינדקס, לא בסיטמאפ.**
כל עוד זה בפיתוח — הכל נשאר ב-branch `feat/scrunchies-gallery`. אין לשנות master עד אישור מפורש.

## כתובת
`/scrunchies-gallery/`

## גודלים ומחירים (קבוע)
| גודל | מזהה | מחיר |
| --- | --- | --- |
| רגילה | `regular` | ₪30 |
| גדולה | `large` | ₪45 |
| Fancy | `fancy` | ₪85 |

מקור: `_data/scrunchie-sizes.yml`. כשמעלים גומיה חדשה, בינה אומרת את הגודל — ומכאן המחיר.

## איך מוסיפים סקראנצ'י חדש
1. שומרים את התמונה תחת `images/scrunchies/gallery/<slug>.jpg`.
2. יוצרים `_store/<slug>.md` עם:
   - `title`, `subtitle`
   - `image` (+ `gallery` לעוד תמונות)
   - `price` ו-`cart_price` לפי הגודל מהטבלה למעלה
   - `category: scrunchies-gallery` (או `scrunchie_gallery: true`)
   - `hide: true`, `noindex: true`, `sitemap: false`
   - אופציונלי לסינון: `scrunchie_type`, `scrunchie_color`, `fabric_country`
3. `node scripts/build-catalog.js`.
4. commit + push ל-branch.

## הערה על ה-admin
בטופס המוצר יש קטגוריה `סקראנצ׳ים (גלריה)` — מוצר שסומן בה יופיע בגלריה ולא ברשת החנות הרגילה.
