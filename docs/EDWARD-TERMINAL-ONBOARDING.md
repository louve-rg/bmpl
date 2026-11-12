# Terminal Workspace — onboarding pack for Edward (draft, for the owner's review)

**Not yet sent to anyone.** This is written for a client to read, not a
developer — plain language, no file paths, no jargon — but it has not gone
to Edward and should not until the owner decides to send it. His confirmed
email address lives on card **MDF-650** and is deliberately not repeated
here or in any shared file.

---

## What the Terminal Workspace is

It's the screen a terminal company's own staff use at one physical counter
to move a parcel through that stop — confirming it's left, confirming it's
arrived, handing it to whoever takes it next, or handing it across the
counter to the person collecting it.

It is not a tracking map, not a booking screen, and not a customer-facing
page. Only staff who have been added to a specific terminal company, for a
specific location of that company, ever see it — and only the work
actually waiting at *their* location shows up. A staff member at one
counter cannot see or act on parcels passing through a different counter,
even one belonging to the same company.

## What's on the screen

There is one screen. It shows up to five short lists, and only the ones
with something in them:

- **Ready to depart** — parcels about to leave this stop for the next one.
- **Confirm arrival** — parcels that have just reached this stop.
- **Hand off to recipient or next leg** — parcels being passed to the
  person collecting them, or carried onward by hand.
- **Release to courier** — parcels being picked up by a courier continuing
  the journey.
- **Collection at the counter** — parcels waiting for the person who
  booked them, or who was named to collect them, to pick them up in
  person.

**An empty screen means everything is caught up — it is not a sign
something is broken.** New work appears the moment it needs attention.

There is no difference in what the screen shows or allows between a
"Manager" and an "Operator" account today — both see exactly the same
screen, scoped to whichever locations that account has been given access
to. The title just describes the person's role at the company; it doesn't
unlock anything extra yet.

## The codes

Several of these steps ask for a short code — four to eight digits. The
design is simple and deliberate: **the person on the other side reads that
code aloud from their own device or paperwork, and the counter staff type it
in.** Staff never look the code up themselves, and the screen never shows it
to them in advance — that would defeat the point, which is proving the
other person actually has it in hand. Typing in the wrong code enough times
locks that parcel's collection until an administrator clears it, so it
can't be brute-forced by guessing.

**For the collection step specifically, that path does not exist yet.**
Today there is no screen or message anywhere that shows a recipient their
own collection code — so a real person arriving to collect a parcel has no
way to know what to present at the counter. This is being built now (cards
MDF-709 and MDF-710); until it ships, collection cannot actually be
completed by a real recipient, demo or otherwise. Do not demonstrate the
collection step as working end to end before those two cards close.

## Demo data vs. real data

Before any invitation goes out, the engineering team is adding a plain,
visible label — "Demo" or "Test" — that appears on screen next to anything
that isn't real: a demonstration company, or a demonstration parcel. The
goal is that Edward is never left to guess which is which by asking
someone or reading a database — if it says "Demo," it's demo; if it
doesn't, it's real. **This label does not exist on screen yet as of this
writing** (tracked as MDF-707); the underlying separation between demo and
real data is already enforced behind the scenes today — a demo company
cannot be mixed into a real one's records or vice versa — but the visible
label is still being built, and the owner may want to hold the invitation
until it ships, which is already this project's stated plan (card
MDF-708).

## What's deliberately not there yet

- **No live map or GPS tracking of any vehicle, courier, bus or boat.**
  Nothing in the system tracks a real-time position; this screen (like the
  rest of the platform) doesn't claim to.
- **No departure timetable or schedule calendar.** A parcel's movement is
  recorded as it actually happens, not predicted against a timetable.
- **No search across all of a company's shipments.** This screen only ever
  shows what is currently waiting for the signed-in staff member's own
  locations — there's no lookup by name, phone number or keyword here.
- **No photos on this screen** — nothing here is captured, uploaded or
  shown as an image. (A parcel's handoff photo, where one exists elsewhere
  in the product, is a different screen entirely.)
- **No way for a Manager or Operator to add a new location, invite another
  staff member, or change the company's own details from this screen.**
  Those are administrator actions, done separately, not something this
  account can do for itself.

## Before this goes to Edward

This document is one of three pieces the floor is preparing before any
invitation is considered (MDF-707): a register of existing test accounts so
none are duplicated, the demo-data labelling requirement described above
(not yet built), and this onboarding pack. The actual invitation and
account are handled separately on **MDF-708**, which the owner is holding
pending his own decision.
