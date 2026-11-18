# Running your demo Terminal Workspace

This guide is about your **demonstration workspace only** — a simulation
environment, labelled "Demo" wherever it appears on screen. Nothing you do
here touches San Pedro Elite, your real SP-EL-TER terminal, a real customer,
or real money. Treat anything this guide describes as something you can try
freely, because none of it is real.

This guide describes behaviour our own quality-assurance team has watched
work end to end on the live, deployed site, using our own test accounts —
not something you have tried yourself. A small number of display issues on
the Staff screen are still being fixed; those are listed in Section 4, and
we will update this guide and tell you directly once they clear.

---

## 1. Where to sign in

- **Login page:** https://www.bzemarketplace.com/login
- **Your Terminal Workspace:** https://www.bzemarketplace.com/dashboard/terminal

Your demo access is already set up. You hold the Manager role at your demo
company's terminal, and there is nothing left for you to activate — you can
sign in with the email and password you chose when you accepted your
invitation. If you don't remember your password, use "Forgot password" on the
login page and reset it yourself from your own mailbox; nobody else can see
or set a password for you.

---

## 2. The six demonstration shipments

Your demo workspace already has six sample parcels staged in it, each at a
different point in its journey, so you have something to look at and act on
immediately rather than an empty screen:

- **One parcel on its way to you now.** It has not yet arrived at your
  terminal.
- **One parcel currently in your custody at the counter**, waiting to be
  collected by the person it's addressed to.
- **Four parcels already completed** — delivered to their recipients, with
  their full history recorded.

You can see all six, with their current state and full history, from the
**History** tab (Managers only — see Section 3 below). None of this is
delicate: if you act on the in-progress ones, that is exactly what they are
there for. If you'd like the demo reset with fresh parcels at particular
stages so you can try something again, tell us and we will stage them.

---

## 3. The daily job

Your workspace is organized as a row of tabs across the top, each showing
how many items are currently waiting on you. A tab showing no count has
nothing waiting right now — that is the normal, caught-up state, not a sign
anything is broken. New work appears the moment it needs your attention.

**Receiving a parcel.** Open the **Incoming** tab to see what's on its way to
you. Checking a parcel in is two separate steps on purpose: first you confirm
it has physically arrived (your own action, needing nothing from anyone
else); then you record the handoff, which needs a short code the person
delivering it reads aloud to you from their own device. Until that second
step happens, the parcel is "arrived" but not yet in your custody — custody
only changes hands when both people are present and the code is entered.

**Taking and holding custody.** The **On Hand** tab is the honest answer to
"what is physically in my building right now." A parcel stays there until
you hand it onward or someone collects it.

**Releasing to the person collecting it.** When someone arrives to collect a
parcel in person, use the collection action and type in the code they show
you. You are never shown that code yourself in advance — only the recipient
can see it and read it to you — because the point of the code is proving the
right person is standing in front of you. A wrong code is refused and tells
you how many attempts are left before the system locks that parcel's
collection as a precaution; see Section 5 for what happens if that happens.

**Releasing to a courier.** When a parcel is picked up by a courier
continuing its journey, use the release action and enter the code the
courier shows you. Once released, the parcel leaves your custody and the
system keeps tracking its movement from there.

**Tracking a parcel's progress.** Every parcel's current stage, and what is
still expected to happen to it, is visible from its own card wherever it
appears on your screen — you do not need a separate tracking step.

**Reading history.** The **History** tab lists every parcel that has passed
through your terminal, with its outcome. This tab, like the **Staff** tab in
Section 4, is visible to Managers only — an Operator account does not see
either one.

Some movements are deliberately not yours to make. A parcel's long-haul leg
between terminals — the boat or truck trip itself — is handled by BML's own
operations staff or carrier, not by a terminal counter. You will not see a
control for that step; it is hidden rather than shown and then refused.

---

## 4. Inviting and managing your employees

This feature deployed today. Everything described below has been watched
working end to end on the live, deployed site by our own quality-assurance
team — including, for the invitation itself, by a second real test account
standing in for a brand-new employee. As the Manager, a new **Staff** tab on
your workspace is where you manage your own team.

- **Inviting someone.** Enter their email, choose whether they join as a
  Manager or an Operator, and choose which of your locations they get. The
  invitation appears in a waiting list and is still there after you refresh
  the page or sign in fresh later. Leaving out a location is refused before
  anything is even sent; a malformed email address is refused with a
  readable message. After sending, the screen tells you plainly whether the
  invitation email actually went out or was only simulated by this demo
  environment (see Section 5).
- **What actually happens for the person you invite.** We tested this end
  to end: a Manager invited someone who had no account at all. That person
  opened the invitation, chose their own name and password, and signed in
  normally — landing directly in the Terminal Workspace as an Operator, able
  to see and work the location they'd been granted, with real work waiting
  for them. As an Operator, they correctly had no Staff tab and no History
  tab. That is the real, observed shape of taking on a new employee from a
  standing start.
- **Opening an invitation link a second time.** If an invitation link is
  opened again after it has already been used, the person sees a clear
  message telling them to ask you for a new link, or to sign in normally if
  they already have an account. This is the mistake a new employee is most
  likely to make — forwarding or re-clicking an old link — so it's worth
  warning them about it yourself.
- **Resending or revoking an invitation.** If an invitation went to the
  wrong address, or an invited person never acted on it, you can send it
  again, or cancel it outright — revoking removes it from the waiting list
  for good.
- **Changing someone's role.** You can move an employee between Manager and
  Operator, in either direction, at any time.
- **Ending someone's access.** You can end an employee's access entirely.
  They stay visible on your list with a Restore option, but their access
  genuinely stops working the moment you end it — it is not just hidden from
  the screen. The screen does not yet ask you to confirm before ending
  someone's access, so double-check who you've selected before you click it
  (see below).
- **Restoring someone's access.** You can restore access for someone you
  previously ended, and they can use the workspace again.
- **Granting or revoking access to a specific location.** Each active
  employee can be given access to an additional location, or have access to
  one specific location removed, independent of anything else about their
  account. We watched the effect from the employee's own side, too: after a
  grant, that location and its real work appear in their queue; after a
  revoke, nothing does. Removing one location only ends their access to
  that location — it never ends their membership or changes their role.
- **The one-Manager floor.** Your company must always have at least one
  active Manager. We watched this refuse, in a real browser: a sole Manager
  cannot demote themselves to Operator, cannot end their own access, and
  cannot remove their own last location. Section 5 says more about what
  this means for you specifically.

All of the above held up after a page refresh and after signing out and back
in fresh — it is a real, saved change, not something that looks done and
then reverts.

**Still open on the Staff screen — known, and being fixed; none of these are
a sign that your action failed:**

- A location's name can show as a blank label.
- The button to end someone's access can be cut off on a phone screen.
- A "success" message can linger on screen after you've revoked an
  invitation.
- Ending someone's access has no confirmation step yet, as noted above.

We'll tell you when these are fixed.

---

## 5. What you cannot do alone

These actions need someone else — a customer, a courier, or a BML
administrator — no matter who you are or what role you hold. This is
checked directly against what the system actually allows, not assumed.

- **Adding a new counter location to your company, or closing an existing
  one.** Both need a BML administrator. What you *can* do yourself is decide
  which of your existing locations each of your employees may work at
  (Section 4). Put simply: **which of your locations a person can work at is
  yours to set; adding or closing a location is ours.**
- **Managing anyone outside your own company, or giving anyone platform
  administrator powers.** You cannot see or touch another company's staff,
  and you cannot grant anyone — including yourself — any administrator
  power over BML's platform. This isn't a restriction worth worrying about;
  it's why your staff list is genuinely your own and nobody else's.
- **Removing your own last manager, or your own last location, if you are
  currently the company's only active Manager.** The system will refuse to
  let you end your own access, step down from Manager, or remove your own
  last location while you're the only one holding the role — it exists to
  stop the company being left with nobody in charge. You likely won't hit
  this on purpose, but if you ever do by accident, that refusal is the
  system working correctly, not something broken.
- **Unlocking a parcel after too many wrong codes.** If a collection or
  hand-off code is entered incorrectly enough times, the system locks that
  parcel as a precaution against guessing. Only a BML administrator can clear
  that lock — there is no button on your screen for it. Tell us if this
  happens and we will clear it.
- **Seeing anyone's collection or hand-off code yourself.** The system never
  shows you the correct code in advance, for any parcel, at any stage — only
  the recipient or the courier holding it can see their own code and read it
  to you. This is deliberate and will not change.
- **Completing a collection or hand-off without the other person present.**
  Both the collection step and the courier hand-off step require a code only
  the other person can supply, so neither can be completed by you alone.
- **The long-haul leg between terminals.** The boat or road trip that moves a
  parcel between terminals is operated by BML or its carrier, not triggered
  from your counter.
- **Guaranteeing an invitation email actually arrives.** If the screen tells
  you an invitation was only simulated rather than actually sent, the new
  employee will not receive anything in their inbox. Tell us if that
  happens, rather than trying to work around it — we will get them into
  their account another way. Please don't share a password, an invitation
  link, or a collection code with anyone else, including back to us in
  writing.

---

## 6. Remaining limitations

Described plainly, not softened:

- **A Manager and an Operator see the same day-to-day screen.** Receiving,
  holding custody, releasing to a collecting customer, releasing to a
  courier, and collecting are all available to both roles identically today.
  The only difference a role currently makes is that the **Staff** tab
  (Section 4) and the **History** tab (Section 3) are visible to Managers
  only. If you expected an Operator to be restricted from the day-to-day
  actions themselves, that restriction does not exist yet.
- **No live map or GPS tracking of any vehicle, boat, or courier.** Nothing
  in the system tracks a real-time position.
- **No departure timetable or schedule calendar.** A parcel's movement is
  recorded as it actually happens, not predicted against a published
  schedule.
- **No search across your company's shipments beyond the Lookup tab's
  reference-number search.** There is no lookup by name, phone number, or
  keyword.
- **No photos on this screen.** A parcel's hand-off photo, where one exists
  elsewhere in the product, is not shown here.
- **The system distinguishes your demo data from real data with a plain
  "Demo" label** wherever a demo shipment or company appears on screen — you
  should never have to guess which is which.

---

If anything in your workspace does not match this guide, or looks wrong in
any way, tell us exactly what you clicked and what you saw. Your demo
workspace runs the same code as the real product, so a problem you find here
is a real problem worth us fixing.
