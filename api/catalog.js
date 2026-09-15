/**
 * Server-side price list. Checkout never trusts prices from the browser.
 * Keep in sync with _data/store-cart.yml
 */

const PRODUCTS = {
  kit: { name: 'ערכת רקמה מפנקת', price: 210, itemId: 'f31375b6-7010-42c6-8bfc-1ffd975714c3' },
  'birth-hoop': { name: 'תעודת לידה רקומה', price: 450, itemId: '2b14c50e-1203-4d11-93b0-6fa2d8ef3ddf' },
  portrait: { name: 'מסגרת רקומה', price: 250, itemId: '1a72e7ca-60a7-4fc0-a7ad-a8f56df6a708' },
  fox: { name: 'רקמת שועל משמח', price: 220, itemId: 'cda558d8-708e-459f-96b4-7602c3ae498a' },
  'embroidery-case': { name: 'קלמר פשתן עם רקמת כותנה', price: 160, itemId: '512a2644-f209-4e11-83e0-421042496c90' },
  'embroidery-flowers': { name: 'זר פרחים רקום', price: 300, itemId: '8662e013-cffb-4960-956b-539f529f4f06' },
  'embroidery-tshirt': { name: 'רקמה בהזמנה אישית', price: 100, itemId: 'b502c656-11a8-4c20-9ad4-e3d23cdd2ec8' },
  'flowers-yumiko-1': { name: 'פרחים בהשראת הטבע ויומיקו', price: 300, itemId: 'cfd588dc-506a-4f75-a024-aba5f893c9fc' },
  yam: { name: 'רקמת בטטה מושרשת', price: 300, itemId: 'b1f904cb-c304-487b-b323-4ea4e3510e29' },
  'voucher-gift': { name: 'שובר מתנה - בוקר פינוק לאמהות', price: 330, itemId: 'bf19a018-ef43-42bf-8182-9ca96d43aee1' },
};

const SHIPPING = {
  pickup: { name: 'משלוח - איסוף עצמי מרחובות', price: 0 },
  registered: { name: 'משלוח - דואר רשום', price: 25 },
  courier: { name: 'משלוח - שליח עד הבית', price: 40 },
};

const FREE_SHIPPING_MIN = 250;
const FREE_COUPON = 'free';
const MAX_QTY = 20;

function shippingPrice(method, subtotal, coupon) {
  const ship = SHIPPING[method];
  if (!ship) return null;
  const code = String(coupon || '').trim().toLowerCase();
  if (method === 'courier' && subtotal >= FREE_SHIPPING_MIN && code === FREE_COUPON) {
    return 0;
  }
  return ship.price;
}

function buildOrder(rawItems, shippingMethod, coupon) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'הסל ריק' };
  }

  const lines = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const id = raw && raw.id;
    const product = PRODUCTS[id];
    if (!product) {
      return { error: 'מוצר לא מוכר בסל' };
    }
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return { error: 'כמות לא תקינה' };
    }
    subtotal += product.price * quantity;
    lines.push({
      description: product.name,
      quantity,
      price: product.price,
      currency: 'ILS',
      itemId: product.itemId,
    });
  }

  const shipCost = shippingPrice(shippingMethod, subtotal, coupon);
  if (shipCost == null) {
    return { error: 'שיטת משלוח לא תקינה' };
  }

  const ship = SHIPPING[shippingMethod];
  const shipLabel =
    shipCost === 0 && shippingMethod === 'courier' ? 'משלוח חינם עד הבית' : ship.name;
  lines.push({
    description: shipLabel,
    quantity: 1,
    price: shipCost,
    currency: 'ILS',
  });

  const total = subtotal + shipCost;
  return { lines, subtotal, shipping: shipCost, total };
}

module.exports = {
  PRODUCTS,
  SHIPPING,
  FREE_SHIPPING_MIN,
  FREE_COUPON,
  shippingPrice,
  buildOrder,
};
