# Study Track

A shared study tracker for a small group. Everyone defines their own subjects, areas and
goals, logs their own sessions, and sees everyone else's. Static front end, Supabase for
auth and data. No build step, no framework, no npm install.

---

## Setting it up

Takes about ten minutes.

### 1. Create the Supabase project

1. Go to **supabase.com**, create a free project, and wait for it to finish provisioning.
2. Open **SQL Editor → New query**, paste in the whole of `schema.sql`, and run it.
   It creates the tables, the row-level security policies, the signup trigger, the realtime
   publication, the account-deletion function and the avatars storage bucket. It is safe to
   run more than once — **re-run it after pulling changes**, since new versions add policies
   and functions the app expects.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Point the app at it

Open `config.js` and fill in the two values:

```js
window.CREW_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  CREW_NAME: "Knox Study Crew",
  ALLOWED_EMAILS: []
};
```

The anon key is meant to be public — it is in every request the browser makes. Row-level
security is what stops people touching data that is not theirs, and that is set up by
`schema.sql`.

**To keep the crew private**, put your mates' email addresses in `ALLOWED_EMAILS`:

```js
ALLOWED_EMAILS: ["lewis@example.com", "sam@example.com", "priya@example.com"]
```

That blocks signup in the UI. For a hard server-side lock as well, go to
**Authentication → Sign In / Providers** in Supabase and turn **Allow new users to sign up**
off once everyone has an account.

### 3. Turn off email confirmation (recommended for a small group)

**Authentication → Sign In / Providers → Email → Confirm email: off.**
Otherwise everyone has to click a link in an email before they can sign in, and Supabase's
free tier rate-limits those emails hard.

### 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Study Track"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/studytrack.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
A minute later it is live at `https://YOUR-USERNAME.github.io/studytrack/`.
Send that link to your mates.

Finally, back in Supabase under **Authentication → URL Configuration**, add that URL to
**Site URL** and **Redirect URLs**.

---

## How it works

### On a phone
The whole thing is built to work on a phone, not just survive one. The masthead collapses to
a single row — mark, live count, your avatar — with the tabs beneath it. Forms stack to one
column, every field is 16px so iOS does not zoom the page when you tap into it, and buttons
are a proper thumb size. The leaderboard drops to the columns that decide something and
scrolls sideways for the rest; the two wide charts scroll rather than shrinking their labels
into nothing. Modals become bottom sheets. **Sign out moves into your own profile** — tap
your avatar top right.

### The header
The mark, the group name, and a live count of **who is on the track right now** — anyone
running a timer shows up as a bubble, you included, with a pulsing dot and their elapsed time
on hover. Click a bubble to open that person's profile.

### Signing up
Each person makes an account with an email, a password and a display name, then walks
through a three-step setup: profile picture and colour, their subjects and areas, and their
daily goals. Nothing is prefilled — everyone's course list is their own.

### Subjects and areas
A **subject** is a course. An **area** is what you actually sit down and revise inside it —
a module, a topic, a paper section, whatever you call it. Areas are optional; you can log
against a subject in general instead. Each area can carry a **target hours** figure and the
**mark you currently score** in it, which is what makes the personal stats worth reading.

You do not have to type any of it. **Choose from the Knox subject list** — in onboarding, and
again under Setup — and the subject arrives with its 2026 HSC exam dates and its syllabus
sections already filled in. English Advanced brings the four modules, Physics brings modules
5 to 8, Japanese Continuers brings speaking, listening, reading, writing, kanji and grammar.

Then change whatever you like. Every name is an editable field, every area has a delete
button, and there is an add box on every subject. Rename *Module B — Eliot* to whatever your
teacher calls it. Delete the ones you do not sit. Add *Practice essays* if that is how you
think. The list is a starting point, not a rule — nothing in it is enforced, and typing a
subject in by hand still works exactly as it did.

### The HSC timetable
Every written paper for the subjects you take, in date order with the real start and finish
times, is on the **My stats** tab under *Your HSC timetable* — pulled from the official NESA
2026 written examination timetable, which is hard-coded in `catalogue.js`. Papers you have
already sat grey out. Subjects assessed by submission or performance rather than a written
paper — English Extension 2, Music Extension — are called out underneath rather than
silently dropped.

If you rename a subject to something the catalogue does not recognise, it keeps the exam date
you already had and shows as *your own date*. Nothing breaks.

### Goals
Set hours per weekday once. Any individual day can be overridden on the Today tab. A goal of
**0** marks a rest day, and rest days never break a streak — otherwise the plan punishes you
for following it.

### Logging a session
Two dropdowns: the **subject**, then the **area** inside it. The area list follows whatever
subject you pick, and *Whole subject* is always the first option when you were not working on
anything more specific.

There is no "mode" dropdown. A fixed list of Consolidate / Drill / Timed paper never
described what anyone actually did, so **write it in the note instead** — "Section II under
time, 33/40, marketing was the weak one" is worth more than any dropdown, and the whole crew
can read it.

### Fixing a session you already logged
Every session of yours carries a **pencil** next to the ×, wherever it turns up — on Today, in
your session log under My stats, in the crew activity feed, and inside your own profile. It
opens the session with everything about it editable: the subject, the area, **the date it
lands on**, the minutes, and the note. Move a Tuesday session to Monday because you logged it
after midnight, correct 90 minutes that were really 45, rewrite a note once you know what the
mark was — it all recalculates immediately, including your goals, streaks and the crew
leaderboard.

There is a **Delete session** button in there too, which asks first. The bare × in the list
still deletes on the spot.

The pencil only appears on your own rows. It is not the interface being polite about it —
the database will not let you write to anyone else's session no matter what the browser asks.

### While a session is running
The browser tab title becomes a live clock — `▶ 12:34 · Study Track` — so a pinned tab
tells you where you are up to without switching to it. It shows `❚❚` while paused.

Move to any other tab in the app and a pill appears in the bottom corner with the running
clock, what you are working on, and **Resume/Pause** and **Finish** next to it. Click the
clock itself to jump back to the timer. It stays out of your way on Today, where the real
timer is already on screen.

### The timer
Pick what you are working on and press start. It records real elapsed time, survives closing
the tab, and appears on everyone else's **Studying right now** strip the moment it starts.
When you finish, you are asked what you got done before it saves.

### Profiles
Click anyone — on the podium, in the leaderboard, or next to their name in the activity
feed — and you get their whole profile: hours, streak, goal-hit rate, best day, hours by
subject, every area with its target and current mark, and **every session they have ever
logged**, notes and all.

Your own profile is edited under Setup: picture, display name, school and colour. There is
also a **Delete my account** button there, which removes every session, subject, area and
goal, your profile, and the login itself. It is not reversible, and it is the fastest way to
clear out test accounts.

### Comparison
The Crew tab has a podium and a full leaderboard over Today / 7 days / 30 days / all time,
with hours, sessions, average per day, longest day, goal-hit rate, streak and a seven-day
sparkline each. Below that: a cumulative race chart, daily output stacked by person, a
head-to-head that puts any two people side by side down to subject splits, and a live
activity feed.

### Importing
The Setup tab takes the JSON backup from the solo study tracker, or a CSV with the columns
`date, subject, area, minutes, mode, note`. Missing subjects and areas are created
automatically. There is an export button too.

---

## Privacy, plainly

**Everyone signed in can read everyone else's sessions, hours and notes.** That is the point
of the app, but it means session notes are not a private diary — write them as if your mates
are reading them, because they are.

**Nobody else** can edit or delete anything of yours, and you cannot touch theirs. That is
enforced by the database, not the interface. Your own sessions you can edit and delete freely
— see *Fixing a session you already logged* above.

Editing is silent: a session that has been changed does not say so, and the crew sees the new
version. Nothing keeps the old one.

---

## Files

| File | What it is |
|---|---|
| `index.html` | Markup for auth, onboarding and the four tabs |
| `app.js` | All the logic — auth, data, timer, charts, import |
| `styles.css` | The design system |
| `config.js` | Your Supabase keys and group name |
| `favicon.svg` | The mark — a track seen from above, with a runner on the lane |
| `catalogue.js` | Every Knox HSC subject: 2026 exam dates and syllabus sections |
| `schema.sql` | Tables, RLS policies, trigger, storage bucket |
| `_test/` | A mock Supabase client for opening the app locally with fake data. Not needed in production — delete it if you want. |

To try it locally without a Supabase project at all, open `_test/index.html` in a browser.
It runs the whole interface against four fake members and three weeks of invented sessions.

---

## Troubleshooting

**"Not configured yet"** — `config.js` still has the placeholder URL in it.

**Signup works but nothing loads** — you probably skipped `schema.sql`, so the `profiles`
table does not exist. Run it and refresh.

**Avatars will not upload** — check the `avatars` bucket exists under Storage and is public.
`schema.sql` creates it; if the storage policies failed, run that section again.

**The leaderboard only shows you** — everyone needs to finish onboarding before they appear.

**"Delete my account" says the login is still there** — your project has not got the
`delete_own_account()` function yet. Re-run `schema.sql`; it is safe to run again. Until
then the button still clears all of your data, it just cannot remove the login itself.

**A subject is missing from the Knox list** — add it by hand; it works exactly the same, it
just will not prefill. Then add it to the `S` array in `catalogue.js` if you want it there
permanently. Courses Knox has run in the past but that have no 2026 exam (PDHPE, Information
Processes and Technology) are hidden behind the *Show discontinued courses* checkbox.

**An exam date looks wrong** — `catalogue.js` is built from the NESA timetable version
`01-05-26`. If NESA reissues it, the dates live in the `exams` array on each subject.

**Nothing updates until I refresh** — it should not. Every clock on the page ticks once a
second off its own start time, whether or not you have a timer running, and the app asks who
is studying every 15 seconds on top of Supabase realtime. If realtime is off entirely, the
poll still catches everything within about 15 seconds.

A background tab is throttled by the browser to roughly one tick a minute and stops polling
altogether — that is deliberate, and it catches up the moment you come back to it. Because
every time is worked out from `started_at` rather than counted up, nothing drifts while you
are away.

**Someone shows as studying who is not** — a running timer heartbeats every 60 seconds. If
their tab closes, they drop off the live strip about five minutes later.
