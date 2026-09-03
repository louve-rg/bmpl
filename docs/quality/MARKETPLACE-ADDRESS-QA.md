# Marketplace & Shipping address QA — run on a phone

The one test that settles Edward's report. Everything else about this fix is
proven by 691 integration tests and by the deployed API itself; what nobody has
done is open it on a phone and watch the pin drop.

**Run against production.** `https://www.bzemarketplace.com`

**Widths:** 320, 375, 390, 430, and desktop. On a real phone, 375/390/430 are
covered by the device itself; use Chrome or Safari responsive mode for 320.

A **UAT account already exists** with BZ$250 of test money in it:

```
bml-uat-pinfix-20260903@example.com
UatPinCheck2026x
```

It is a real production account that is **not** flagged as a test user — delete
or flag it when you are done (Admin → Users). Its BZ$250 is correctly marked
test money and cannot reach revenue reporting.

---

## Before you start

You need something deliverable in the cart. Find a store that offers delivery to
your district, add an item, and go to `/checkout`. If nothing is deliverable,
the address block never appears and there is nothing to test — say so, because
that is a business-configuration finding, not a pass.

---

## 1. Drop a pin — the actual complaint

This is the test. If only one thing gets run, run this.

1. At checkout, set at least one store to **Delivery**. The address block
   appears.
2. In **"How would you like to give us the address?"** choose **Drop a pin**.
3. ✅ The **street address fields disappear.** You should see only: full name,
   phone, city/town, district, and the map.
4. Tap **Use my current location** and grant permission.
5. ✅ The map centres on you and a **pin appears**.
6. ✅ You can **drag the pin** and it stays where you put it.
7. Fill in name, phone, town, district. **Leave the street address blank —
   there should not even be a field for it.**
8. Press **Pay … with wallet**.
9. ✅ **The order goes through.** No "Please complete the delivery address", no
   "Address is required".

**This is the exact flow that failed.** If step 9 fails, capture the message
verbatim and stop — that is the bug reopening.

Then open the resulting order and check the delivery address reads sensibly:
with no street line it should say **"Pinned on the map — no street address
given"**, followed by the town and district. A blank line or the word `null` is
a bug.

### If location permission is denied
Tap the map directly to place a pin instead. Everything from step 6 applies.
Denying permission must not make checkout impossible.

---

## 2. Type the address

1. Switch the selector to **Type the address**.
2. ✅ Street address, apartment/landmark, city and district appear.
3. Enter a real street and town.
4. ✅ The map finds it and **drops a pin by itself** — you should not have to
   press anything.
5. ✅ Drag the pin; it stays. The typed text does **not** change.
6. Check out. ✅ Succeeds.
7. Now clear the street line and try again. ✅ Refused, with a message naming
   **both** ways out: *"Tell us where to go: type the street address, or drop a
   pin on the map."*

---

## 3. Saved address

1. Switch to **Use a saved address**.
2. ✅ A picker of your saved addresses appears. (No saved addresses yet? You
   should see a message telling you to type one instead — not an empty box.)
3. Choose one. ✅ The fields fill in **and its stored pin appears on the map**.
4. Drag the pin somewhere else.
5. ✅ A notice appears saying your saved address is unchanged.
6. Check out. ✅ Succeeds.
7. Go to your saved addresses. ✅ **The stored address still has its original
   pin.** Moving it for one order must not have rewritten the address book.

---

## 4. Switching between methods

Go **Type the address → Drop a pin → Use a saved address → Type the address**.

- ✅ No error message survives a switch that no longer applies.
- ✅ No required field you cannot see. If it will not submit, the reason must be
  something visible on screen.
- ✅ Switching to **Drop a pin** clears the typed street — you must not submit a
  street you can no longer see and nobody checked.
- ✅ Your **pin survives** every switch. Re-dropping a pin you already placed is
  pure loss.

---

## 5. Layout, at every width

At **320 / 375 / 390 / 430 / desktop**:

- ✅ **No horizontal scrolling anywhere.** Swipe left/right on the page — it
  should not move.
- ✅ The method dropdown opens fully and is not clipped.
- ✅ The map is not hidden behind the sticky bottom bar or the header.
- ✅ Map controls (zoom, current location) are reachable with a thumb.
- ✅ Buttons are comfortably tappable — roughly a fingertip, not a pinprick.
- ✅ Validation text is readable, not truncated.
- 320 is the cruel one. Check it properly.

---

## 6. Keyboard and screen reader (desktop, quick pass)

- ✅ Tab reaches the method selector and it can be changed with the keyboard
  alone.
- ✅ Every input has a visible label.
- ✅ The selected method is obvious without relying on colour.
- ✅ Map buttons announce what they do.

---

## 7. Shipping — the same three methods

Go to **`/dashboard/shipments/new`**.

1. **Drop a pin** for both ends. ✅ No street field is asked for.
2. Fill in town and district at each end, and a recipient name and phone.
3. ✅ You get a quote once both towns are filled in — not before.
4. ✅ **The booking succeeds.** It must **not** say *"We need the address to
   collect from."* That was a real bug and it is what this release fixed.
5. Repeat with **Type the address** and **Use a saved address**.

> Today production has no terminals, routes or courier lanes configured, so only
> a **same-town** door-to-door shipment can be quoted. A local courier rate is
> also not set, so the quote will say the price is not configured and the pay
> button stays disabled. **That is correct behaviour, not a failure** — it is
> refusing to ship for free. To complete a paid booking end to end, an operator
> must first set the local courier rate.

---

## What to report back

For each numbered section: pass, or the exact wording of what went wrong and the
width it happened at. Screenshots of anything visual.

The single most important line in your report is whether **§1 step 9** passed.
