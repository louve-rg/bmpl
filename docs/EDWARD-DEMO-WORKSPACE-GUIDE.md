# Running your demo Terminal Workspace

This guide is about your **demonstration workspace only** — a simulation
environment, labelled "Demo" wherever it appears on screen. Nothing you do
here touches San Pedro Elite, your real SP-EL-TER terminal, a real customer,
or real money. Treat anything this guide describes as something you can try
freely, because none of it is real. Section 9 explains how the two relate.

This guide describes behaviour our own quality-assurance team has watched
work end to end on the live, deployed site, using our own test accounts —
not something you have tried yourself.

---

## 1. Where to sign in

- **Login page:** https://www.bzemarketplace.com/login
- **Your Terminal Workspace:** https://www.bzemarketplace.com/dashboard/terminal

Your demo access is already set up. You hold the Manager role at your demo
company's terminal, and there is nothing left for you to activate. Sign in
at the login page above with your own email address. If you don't have a
password yet, or don't remember it, use "Forgot password" on the login page
and set it yourself from your own mailbox — nobody else can see or set a
password for you.

---

## 2. Navigating your workspace

Once you're signed in, your workspace is organized into **six sections**:
**Overview, Incoming, On Hand, Queue, Lookup,** and **History**. Each is
its own tab across the top of your screen — except **Queue**, which isn't
one tab at all. It shows up as **five separate tabs**, one for each
specific thing you might need to do next: **Depart, Arrive, Hand off,
Release,** and **Collect**. Count every tab across the top and you'll get
more than six — that's six sections, with Queue spread across five of
them. None of that extra counting means anything is wrong; it's just how
one section can need more than one button.

A number on a tab is a live count of what's currently waiting on it — a
tab with no number has nothing waiting right now, which is the normal,
caught-up state, not a sign anything is broken.

Here is each section:

- **Overview** — a summary of what's moving through your terminal right
  now, including the "Collection at the counter" card for anything ready
  to be picked up.
- **Incoming** — parcels on their way to you that haven't arrived yet.
- **On Hand** — parcels physically in your building right now.
- **Queue** — the five tabs where you actually act on a parcel:
  - **Depart** — line-haul legs starting their trip from your terminal,
    waiting for you to confirm they've actually left.
  - **Arrive** — line-haul legs waiting for you to confirm they've
    actually reached your terminal.
  - **Hand off** — parcels waiting for you to take custody from the
    person delivering them, using the code they read to you.
  - **Release** — parcels waiting for you to release to a courier
    continuing their journey.
  - **Collect** — parcels waiting for the person collecting them in
    person.
- **Lookup** — find any one parcel of yours by its reference number,
  wherever it currently is.
- **History** — every parcel that has passed through your terminal, with
  its outcome (Section 7). **Visible to Managers only** — if you're an
  Operator and don't see this tab, that's correct, not a problem with
  your account.

As a Manager, you also have one tab beyond these six sections: **Staff**
— managing who on your team has access, and to what (Section 8). Like
History, **Staff is visible to Managers only.**

---

## 3. What's staged in your demo right now

Your demo workspace has six sample parcels staged in it, each at a
different point in its journey, so you have something to look at and act
on immediately. Here is each one, described exactly as your own screens
show it.

### The two you can act on today

- **BML-KLDR4RBU** — under the **Incoming** tab. It shows "Scheduled," "From
  DEMO Belize City Interchange," and "No scheduled arrival time yet." There
  is nothing to click on it yet: it is still waiting to be sent to you, and
  it will not reach your **Arrive** tab until it has actually been marked
  departed and has arrived.
- **BML-ZVERGSME** — under **On Hand** and **Collect**, and on your
  **Overview** screen's "Collection at the counter" card. It shows "Held
  since 17 Nov, 23:06." This is the one worth trying end to end: open
  **Collect**, and the screen tells you to "Ask the recipient for the code
  on their own device, and their name." When the person collecting it
  arrives, ask for both, type them in, and press **Record collection**. This
  is the only complete action you can carry out alone in the demo today.

### The four that are already finished

These four are **delivered**, with nothing left to do, and you'll only find
them on the **History** tab (Section 6):

- **BML-5R62N72B** — delivered 17 Nov, 23:01.
- **BML-YGDTR3VW** — delivered 17 Nov, 23:03.
- **BML-UR3YP7CW** — delivered 17 Nov, 23:20, collected at the counter.
- **BML-86EBCC3F** — delivered 17 Nov, 23:20, released to a courier and
  delivered to the door.

The last two are worth a closer look: between them, they show the only two
ways a parcel ever leaves your shop — handed directly to the person
collecting it (**BML-UR3YP7CW**), or released to a courier who completes
the delivery (**BML-86EBCC3F**).

### Two more you'll see in History that are not yours

Your **History** tab will actually list **eight** entries, not six. Two of
them — **BML-FE5WKZQW** and **BML-GWEUUB35** — are demonstration shipments
created to test arrival and collection at the terminal. They are not part
of your demonstration. We cannot remove
them without a database change we are not prepared to make, and they are
safe to ignore. We are telling you plainly so that counting eight does not
read as something wrong with your demonstration, or as parcels you have
lost track of.

---

## 4. Receiving shipments and taking custody

**Receiving a parcel** starts with the **Incoming** tab, which shows
what's on its way to you before it has actually arrived. Confirming it has
physically arrived is your own action, on the **Arrive** tab — it needs
nothing from anyone else, just your own confirmation that the leg has
reached your terminal.

**Taking and holding custody.** The **On Hand** tab is the honest answer to
"what is physically in my building right now." A parcel stays there until
you hand it onward or someone collects it — see Section 5 for the two code-
gated actions that move a parcel into or out of your custody.

A finished parcel disappears from Overview, Incoming, On Hand and every
other live-count screen the moment it's done — those tabs only ever count
parcels still in progress. You'll still find it afterward on **History**
and **Lookup** (Section 6), so a parcel leaving these screens is normal,
not lost data.

---

## 5. Validating a collection code and completing a hand-off

Two actions move a parcel into or out of your custody, and both work the
same way: someone else reads you a code from their own device, and you
type it in. You are never shown either code yourself in advance — only the
other person can see it — because the point of the code is proving the
right person is standing in front of you.

- **Hand off** — taking custody from the person delivering a parcel to
  you (a courier, or the next leg of its journey). Use the **Hand off**
  tab and enter the code they show you.
- **Collect** — releasing a parcel to the person who has come to pick it
  up. Use the **Collect** tab, and ask for the code on their own device
  and their name, as the screen itself tells you to.

A wrong code is refused and tells you how many attempts are left before
the system locks that parcel's collection as a precaution. See Section 8
for what happens if that happens — unlocking it is not something you can
do yourself.

---

## 6. Releasing a parcel to a courier

When a parcel is picked up by a courier continuing its journey, use the
**Release** tab and enter the code the courier shows you, the same way as
Section 5's two actions. Once released, the parcel leaves your custody and
the system keeps tracking its movement from there.

---

## 7. Reviewing tracking and history

**Tracking a parcel's progress.** Every parcel's current stage, and what is
still expected to happen to it, is visible from its own card wherever it
appears on your screen — you do not need a separate tracking step.

**Reading history.** The **History** tab lists every parcel that has passed
through your terminal, with its outcome. This tab, like the **Staff** tab in
Section 7, is visible to Managers only — an Operator account does not see
either one. For one specific parcel, by its reference number, **Lookup**
works the same way but is visible to every member regardless of role.

Four things worth knowing about these two screens:

- **You cannot open a History row.** To see a parcel's full leg-by-leg
  timeline, type its reference number into the **Lookup** tab instead —
  clicking a row in History does nothing, and that is not a broken page.
- **Lookup only answers for parcels tied to your own terminal.** Type in a
  reference that belongs to a different terminal, and you will not be shown
  it. That's a protection, not a fault: the same rule that stops you from
  learning anything about another terminal's parcels is what stops anyone
  else from learning about yours.
- **A finished parcel disappears from every screen except History and
  Lookup.** The counts on Overview, Incoming, On Hand and Collect only ever
  count parcels still in progress, so seeing two there while History lists
  eight is correct — it is not lost data.
- **History can lag by one label.** A parcel that has arrived at your
  terminal but not yet been handed off to you can still show as "In
  Transit" in History, even while the **Hand off** tab correctly shows it as
  Arrived. Trust the tab you're actually working in; the History label
  catches up afterward.

---

## 8. Inviting and managing your staff

This feature deployed today. Everything described below has been watched
working end to end on the live, deployed site by our own quality-assurance
team — including, for the invitation itself, by a second real test account
standing in for a brand-new employee. As the Manager, the **Staff** tab on
your workspace is where you manage your own team.

- **Inviting someone.** Enter their email, choose whether they join as a
  Manager or an Operator, and choose which of your locations they get. The
  invitation appears in a waiting list and is still there after you refresh
  the page or sign in fresh later. Leaving out a location is refused before
  anything is even sent; a malformed email address is refused with a
  readable message. After sending, the screen tells you plainly whether the
  invitation email actually went out or was only simulated by this demo
  environment (see Section 9).
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
  The system asks you to confirm before it takes effect, so you get one more
  chance to check you've selected the right person — it's a plain pop-up
  asking you to confirm or cancel, and clicking Cancel is always safe and
  changes nothing. They stay visible on your list afterward with a Restore
  option, but their access genuinely stops working the moment you confirm —
  it is not just hidden from the screen.
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
  cannot remove their own last location. Section 9 says more about what
  this means for you specifically.

All of the above held up after a page refresh and after signing out and back
in fresh — it is a real, saved change, not something that looks done and
then reverts.

### Four people on your Staff list, not three

Open the **Staff** tab and you'll see **"Members (4)"**, not three. You are
one of the four. Of the other three, two — **Qa Manager** and **Qa
Operator** — are our own quality-assurance accounts, and the third,
**Stanley Fixture**, is a test employee from our own verification of this
feature, with their access already **ended**. None of those three can be
removed from your list without a database change nobody has authorised, so
they will stay there — please leave all three alone.

**Do not click Restore on Stanley Fixture.** Most warnings in this guide
are about something that merely looks wrong on screen. This is one of two
instructions where getting it wrong actually does something: that row
still shows a Restore option, and clicking it would hand a working Operator
account at your terminal to a test identity, not just bring back something
harmless. Leave that row exactly as it is.

**Do not end your own access, and do not change your own role to
Operator.** This guide earlier told you the system always keeps a company
with at least one active Manager and refuses to let the last one demote or
remove themselves. That protection is real, but it only stops you from
being the *last* active Manager — and because our Qa Manager account is
also an active Manager on your company right now, the system currently
sees two of you, so it will **not** stop you from ending your own access or
demoting yourself today. Doing either would lock you out of staff
management, and ending your own access would lock you out of the workspace
entirely — and you would not be able to undo it yourself. If that ever
happens, contact us and we will restore your access. This is the second of
the two instructions in this document where getting it wrong does
something rather than merely looking odd — leave your own row alone.

---

## 9. Actions that need someone else

These actions need someone else — a customer, a courier, a carrier, or a
BML administrator — no matter who you are or what role you hold. This is
checked directly against what the system actually allows, not assumed.

- **Adding a new counter location to your company, or closing an existing
  one.** Both need a BML administrator. What you *can* do yourself is decide
  which of your existing locations each of your employees may work at
  (Section 8). Put simply: **which of your locations a person can work at is
  yours to set; adding or closing a location is ours.**
- **Managing anyone outside your own company, or giving anyone platform
  administrator powers.** You cannot see or touch another company's staff,
  and you cannot grant anyone — including yourself — any administrator
  power over BML's platform. This isn't a restriction worth worrying about;
  it's why your staff list is genuinely your own and nobody else's.
- **Changing your own role away from Manager, if you are the company's only
  active Manager.** This needs another Manager to do it for you — you
  cannot step yourself down to Operator while you're the only one, and the
  product will tell you so rather than let you. If you ever genuinely need
  this done while you remain the only Manager, contact us — but know
  honestly what it actually involves on our side first: there is no simple
  role toggle for this case. It means ending your membership and sending
  you a fresh invitation at the new role, which you would have to accept
  again, with your location access granted to you again from scratch. It
  is a real change to how your account works, not a quick switch, so it's
  worth being sure before you ask.
- **Ending your own access, or removing your own last location, if you are
  the company's only active Manager.** The system refuses both the same
  way and for the same reason — it exists to stop the company being left
  with nobody in charge. You likely won't hit this on purpose, but if you
  ever do by accident, that refusal is the system working correctly, not
  something broken. If you ever genuinely need either done while you're
  the only Manager, contact us.
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
- **Choosing or operating the vehicle for the long-haul leg between
  terminals.** The boat or road trip itself — which vehicle, when it
  actually leaves, the journey in between — is run by BML or its carrier,
  not from your counter. Your part is only confirming, on the **Depart**
  and **Arrive** tabs, that a leg has actually left or reached your
  terminal (Section 4) — that confirmation is yours, the trip itself isn't.
- **Guaranteeing an invitation email actually arrives.** If the screen tells
  you an invitation was only simulated rather than actually sent, the new
  employee will not receive anything in their inbox. Tell us if that
  happens, rather than trying to work around it — we will get them into
  their account another way. Please don't share a password, an invitation
  link, or a collection code with anyone else, including back to us in
  writing.

---

## 10. Your demo workspace and your real terminal

Your demo workspace and your real SP-EL-TER terminal are two separate,
unconnected places in the system. Nothing you click, invite, receive or
release in the demo touches San Pedro Elite's real staff, real parcels or
real customers, in either direction.

Your real terminal is not active yet. There's nothing wrong with it and
nothing broken — it simply hasn't been switched on for live operation, so
you won't find a workspace to sign into for it today. When it does go
live, it will look and work exactly like the one this guide describes,
because the demo runs the same code as the real product. Nothing in this
guide will need to be relearned.

Until then, if you ever see a "Demo" label on a shipment, a company, or a
screen, that's your workspace telling you plainly which world you're in —
you should never have to guess.

---

## 11. Remaining limitations

Described plainly, not softened:

- **A Manager and an Operator see the same day-to-day screen.** Receiving,
  holding custody, releasing to a collecting customer, releasing to a
  courier, and collecting are all available to both roles identically today.
  The only difference a role currently makes is that the **Staff** tab
  (Section 8) and the **History** tab (Section 7) are visible to Managers
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
