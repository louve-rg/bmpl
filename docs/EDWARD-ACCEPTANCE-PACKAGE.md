# Edward acceptance package — 2026-10-14

Twelve items. For each: **where to look**, and **what we're asking you to
confirm.** Nothing below has your sign-off yet — that's the point of this
document. Full engineering evidence (commits, tests, deploy state) is in
[`docs/EDWARD-REQUIREMENTS.md`](./EDWARD-REQUIREMENTS.md) if you want it;
this page is deliberately shorter.

Current site: **https://www.bzemarketplace.com** (customer/vendor/driver),
admin at **https://bmpl-admin.vercel.app**.

| # | Where to look | What to confirm |
| - | --- | --- |
| 1 | Admin → an order's detail view | Each item's fulfilment origin (which vendor location) is shown correctly. *Not yet on the customer's or vendor's own order view — admin only today.* |
| 2 | A shipment's handoff/pickup screen, as sender, staff, courier, and a linked recipient | Each of those four can view the handoff photo; the courier can upload one. |
| 3 | Claim a shipment as recipient; check "My shipments → Incoming" | Linking works, and the incoming shipment shows up and tracks correctly. |
| 4 | Driver service-area settings | A city within a configured lane (not just whole districts) can be selected — e.g. a town like Ladyville on its own. |
| 5 | A vendor storefront near/at closing time | "Closing soon" and "closed now" states show correctly; a one-off closure date is respected. |
| 6 | Walk a shipment through a full handoff chain | Each handoff step requires its PIN and the chain holds end to end. |
| 7 | As the **booking customer**, open a shipment's tracking/messaging | You can see courier/vehicle info and message them once assigned. *By our own ruling, a linked recipient does not get courier identity — only messaging. Flag if that's not what you intended.* |
| 8 | Expand a job's map, both shipping and marketplace delivery | The map goes full-screen and shows every real stop. *Open question we haven't settled: does a 2-stop marketplace delivery need to satisfy the A–B–C–D wording at all, or is that shipping-only? We need your call here, not a demo.* |
| 9 | Saved addresses (customer account) | Add/edit/delete a saved address, set a default, and confirm you can't delete the current default without clearing it first. |
| 10 | As a courier holding a parcel, open the shipping job screen | A "Report an issue" button is there, posts a reason, and shows a confirmation. **Two things to know before you test:** the confirmation does not survive a page reload (known limitation, not yet fixed), and there is still no screen for the *other* trigger (an auto-flag after 5 wrong handoff PIN attempts) — that one is API-only. The broader decision on what should happen after a failed delivery is still open — don't read this screen as that decision being made. |
| 11 | Set an availability window as sender and as a linked recipient | Each can set their own window without erasing the other's; a shipment's ETA updates if a window change actually moves it. |
| 12 | As admin, flag an exception, hold, or reroute a shipment leg | Staff, the sender, and the recipient are all notified; a reroute/return charges only after your own confirmation, never from the staff action alone. |

**One standing fact, not a request:** none of the above has been recorded as
accepted by you yet, in any document in this project — that's deliberate,
not an oversight; this package exists to start closing that gap, one row at
a time, in your own words.
