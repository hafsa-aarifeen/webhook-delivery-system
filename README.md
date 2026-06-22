## Verifying webhook signatures

Every webhook includes an `X-Signature` header:

    X-Signature: sha256=<hex>

The value is an HMAC-SHA256 of the **exact request body**, keyed with the secret
you received when your subscription was created. To confirm a webhook genuinely
came from us and wasn't altered in transit, recompute the signature and compare.

### Node.js (Express) example

```js
const crypto = require("crypto");

const SECRET = process.env.WEBHOOK_SECRET; // shown once at subscription creation

function isValid(rawBody, signatureHeader) {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verify against the RAW body, BEFORE parsing JSON.
app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  if (!isValid(req.body, req.header("X-Signature") || "")) {
    return res.status(401).send("Invalid signature");
  }
  const event = JSON.parse(req.body.toString());
  // ... handle the event ...
  res.sendStatus(200);
});
```

**The most common mistake:** verifying against a *re-serialized* JSON object
instead of the raw bytes. A change in whitespace or key order alters the hash and
breaks verification. Always hash the body exactly as it arrived. A constant-time
compare (`timingSafeEqual`) avoids leaking information through timing.
