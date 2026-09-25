# AI product cards & WhatsApp orders

When a customer asks the AI assistant for a recommendation ("do you have
party dresses for a 4-year-old?"), it can answer with **native WhatsApp
product cards** from your Meta Commerce catalog. The customer opens a
card, picks a size, adds it to the WhatsApp cart and sends the order
from the chat. The order lands in the inbox and on your `message.received`
webhook, so your store can turn it into a checkout.

```
store products ──feed──▶ Meta catalog ──sync──▶ catalog_products (CRM)
                                                      │
customer asks ──▶ AI picks in-stock products ─────────┘
              ◀── product card / product list (WhatsApp)
customer sends cart ──▶ `order` message ──▶ inbox + message.received webhook ──▶ store checkout
```

## One-time setup

1. **Create the catalog.** In Meta Commerce Manager, create a catalog and
   add your products — easiest is a *scheduled data feed* pointing at a
   CSV your store publishes. Give every size/colour its own row (`id`)
   and the same `item_group_id` so the assistant can offer all sizes of a
   product together.
2. **Connect it to WhatsApp.** In WhatsApp Manager → your number →
   Catalog, choose the catalog and turn on the cart.
3. **Give your token access.** The system user whose access token is
   saved in Settings → WhatsApp needs the `catalog_management` permission
   and must be assigned to the catalog (Business settings → Data sources
   → Catalogs → Assign people).
4. **Link it here.** Settings → WhatsApp → Product Catalog: paste the
   catalog ID (Commerce Manager → catalog settings) and save. Products
   sync straight away; use **Sync now** after big catalog changes.
5. **Keep it fresh.** Schedule `GET /api/commerce/cron` hourly with the
   `x-cron-secret: $AUTOMATION_CRON_SECRET` header.
6. **Turn on the auto-reply bot** (Agents → Setup) if it isn't already,
   and try it in the Playground: product picks show up as cards there too.

## How the assistant chooses products

- Only products whose availability is *in stock*, *available for order*
  or *preorder* are offered.
- Each turn the best ~12 matches for what the customer said recently
  (name first, then colour/size, then description) are listed in the
  prompt. The model may recommend up to 5 of them.
- It can only send ids from that list — anything else is dropped. If
  Meta rejects the card (e.g. the catalog isn't connected to the number
  yet), the customer gets the reply as plain text instead.
- One product with one variant → a single-product card. Anything else →
  a product list with one section per product and its sizes as items
  (Meta caps this at 10 sections / 30 items).

## Orders

A sent cart arrives as a message with `content_type: "order"`. The inbox
shows the lines and total; the AI does not reply to it. The
`message.received` webhook (and the public API's messages) include:

```json
"order": {
  "catalog_id": "1234567890",
  "text": "Gift wrap please",
  "items": [
    { "retailer_id": "dress__4-5Y", "quantity": 2, "item_price": 1290, "currency": "INR", "name": "Party Dress (4-5Y)" }
  ]
}
```

Prices here are what WhatsApp showed the customer — re-price from your
own catalog before charging.
