# Marketplace Demo Checklist

A practical, click-through script for demoing the marketplace to a client, plus the
26-point production verification that proves the backend enforces the hard rule.

See [MARKETPLACE-DEMO-READINESS.md](./MARKETPLACE-DEMO-READINESS.md) for the full
context.

---

## A. Live demo walk-through (click-through)

### 1. Guest browsing (no account)
- [ ] Open the site — the landing page loads; the **Marketplace** card shows **Live**.
- [ ] Header **Shop** → `/products` lists real products from real vendors.
- [ ] Open a product → detail page loads (price, images, vendor, stock).
- [ ] Header nav anchors (Services, For Providers, Wallet, Mobile App) work from
      any page (they point at `/#…`).
- [ ] Click **Add to cart** / **Buy** → redirected to **login** (guest cannot buy).

### 2. Become a customer
- [ ] **Create account** → auto-logged-in, land on dashboard.
- [ ] Reload the page → still logged in (session persists).
- [ ] After logging in from an add-to-cart bounce, you return to the product you
      were viewing (via `?next=`), not a generic page.

### 3. Shop as a customer
- [ ] Add a product to the cart → cart updates.
- [ ] Checkout → order is created; authorize payment (escrow) if the wallet is
      funded, otherwise a clear "insufficient balance" message.

### 4. Request the Vendor role (real documents)
- [ ] Dashboard → **My Roles** → **Vendor** shows the required documents.
- [ ] Click **Apply**, upload the **government-issued ID** and **business
      registration / trade licence**, add an optional note, **Submit**.
- [ ] The application appears under **My applications** as **PENDING**.
- [ ] (Try submitting with no document — it is refused. The upload is required.)

### 5. Admin review (admin app)
- [ ] Admin → **Applications** → open the pending Vendor application.
- [ ] View the uploaded documents.
- [ ] **Request more info** → applicant's application flips to **MORE_INFO_REQUIRED**.
- [ ] Applicant (customer app) sees the reviewer's note, responds with a message and
      a fresh document, **resubmits** → back to **PENDING**.
- [ ] Admin **Approves** the role application.

### 6. Build the storefront
- [ ] Customer app → role switcher → **switch to Vendor** (now selectable).
- [ ] Dashboard → **Store** → create the storefront (business name, contact,
      location, logo/banner) → **Submit**.
- [ ] Admin approves the **VendorProfile** (separate from the role approval).

### 7. List products
- [ ] Dashboard → **Products** → add a product: title, description, category,
      images, price, inventory, variants → **Publish**.
- [ ] The products table scrolls cleanly on a narrow window.

### 8. Products appear publicly
- [ ] Public `/products` shows the new product.
- [ ] Storefront `/store/<slug>` → **View all** → `/products?vendorSlug=<slug>`
      shows only that vendor's products, with the store name and a "Show all
      stores" link.
- [ ] A second shopper (or guest) can find and open the product.

### 9. Admin housekeeping (optional)
- [ ] Admin dashboard → **Suspended accounts** card → Users page opens
      pre-filtered to suspended accounts, with a clearable filter chip.

---

## B. Production verification (26 automated checks)

Run against the deployed API with a dedicated verification account. The run is
**self-cleaning** (it creates no persistent records — every write it attempts is one
the API *rejects*) and **never prints credentials**.

Script: `scripts/m12_1-verify.mjs` (scratchpad copy used for the run).

### Health & public catalog (guests welcome)
1. `GET /api/health` → 200, reports a commit SHA.
2. `GET /api/health/ready` → 200, database + redis + storage healthy.
3. `GET /api/marketplace/products` → 200, returns an items array.
4. `GET /api/marketplace/categories` → 200, returns an array.
5. `GET /api/marketplace/products/hair-food` → 200 (guest can view product detail).
6. `GET /api/marketplace/products?vendorSlug=<slug>` → 200, all items belong to that
   vendor (vendorSlug honored).

### The hard rule — guests cannot buy (401)
7. `GET /api/cart` → 401.
8. `POST /api/cart/items` → 401.
9. `DELETE /api/cart` → 401.
10. `POST /api/checkout` → 401.
11. `GET /api/orders` → 401.
12. `GET /api/payments` → 401.
13. `GET /api/wallet/transactions/:id` → 401.
14. `GET /api/me` → 401.

### Authenticated customer (self-scoped access)
15. `POST /api/auth/login` → 201, sets session cookies.
16. `GET /api/me` → 200, correct email, holds an APPROVED `CUSTOMER` role.
17. `GET /api/cart` → 200 (a customer may reach the cart).
18. `GET /api/roles/applicable` → 200, `VENDOR` present with required documents.
19. `GET /api/roles/applications` → 200, returns an array.

### Wrong role — customer refused vendor endpoints (403)
20. `GET /api/vendor/profile` → 403.
21. `GET /api/vendor/products` → 403.
22. `POST /api/vendor/products` → 403.

### Vendor application enforcement
23. `POST /api/roles/applications` with `documentKeys: []` → 400 (documents required).
24. `POST /api/roles/applications/VENDOR/documents/presign` → 201, returns an
    upload URL + storage key (presign only — no object uploaded, nothing to clean).

### Idempotency & no side effects
25. Guest `POST /api/checkout` re-run → still 401 (no state changed by the run).
26. `GET /api/me` again → the verification account is still **customer-only** (no
    `VENDOR` role was created), and its cart is unchanged — the run left production
    exactly as it found it.
