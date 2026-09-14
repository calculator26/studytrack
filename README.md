# Knox Study Track

A shared study tracker for a whole year group. Everyone defines their own subjects, areas and
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
3. **Set who the administrators are.** Near the top of `schema.sql` there is one array:

   ```sql
   and lower(u.email) = any (array[
     'lchristie26@knox.nsw.edu.au',
     'akhannaboyle26@knox.nsw.edu.au'
   ])
   ```

   Those addresses get the admin console. Edit the list and re-run the file to change it.
   It is a function rather than a table on purpose: nothing reachable from the browser can
   grant anybody admin, because the anon key cannot redefine a function.
4. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Point the app at it

Open `config.js` and fill in the two values:

```js
window.CREW_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  CREW_NAME: "Knox Study Track",
  ALLOWED_EMAILS: []
};
```

The anon key is meant to be public — it is in every request the browser makes. Row-level
security is what stops people touching data that is not theirs, and that is set up by
`schema.sql`.

**To keep the peloton private**, put your mates' email addresses in `ALLOWED_EMAILS`:

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

### Everyone gets their own colour
Your colour is how you are told apart — it is the avatar behind your initials, your line
on the charts and your name in chat. The picker used to open on the same green for
everybody, and most people sensibly left it there: ninety-one of the first hundred and
twenty-six ended up sharing a colour with somebody.

A new arrival is now handed one nobody is using. Hues are stepped by the golden angle so
consecutive ones land far apart, and each is solved for a contrast ratio against white
between 4.6 and 9.6 to one, which is what keeps white initials on the avatar and the same
colour as a name on a white card both readable. Change it whenever you like — and if you
land on somebody else's, Setup says whose, with a **Give me a free one** button beside it.

Worth being honest about the limit: a few hundred *distinct* colours is easy, a few
hundred *tellable-apart* colours is not. Up to roughly a hundred and fifty they are
comfortably different; past that the initials on the avatar are doing most of the work,
which is why they are there.

### Signing up
**Sign in** and **Create account** sit side by side at the top of the first screen, so
somebody arriving from a link is not hunting for a small line of text at the bottom.

An account needs an email, a password and a display name, then there is a three-step
setup: picture and colour, subjects, goals. Nothing is prefilled — everyone's course list
is their own.

Subjects start from **the Knox list**, which is the full-width button and the only thing
offered. Each subject you tap arrives with its 2026 HSC exam dates and its course sections
already in it, the row turns green, and a count at the bottom tells you how many you have.
Typing one in by hand is folded away behind *Not on the list?* — deliberately, because a
hand-typed subject brings no exam dates and no course sections, and it will not match
anybody else's spelling on the leaderboard either.

### Subjects and areas
A **subject** is a course. An **area** is what you actually sit down and revise inside it —
a module, a topic, a paper section, whatever you call it. Areas are optional; you can log
against a subject in general instead. Each area can carry a **target hours** figure and the
**mark you currently score** in it, which is what makes the personal stats worth reading.

Adding one starts from the Knox list. **Choose from the Knox subject list** — in onboarding, and
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
time, 33/40, marketing was the weak one" is worth more than any dropdown, and the whole peloton
can read it.

### Fixing a session you already logged
Every session of yours carries a **pencil** next to the ×, wherever it turns up — on Today, in
your session log under My stats, in the peloton activity feed, and inside your own profile. It
opens the session with everything about it editable: the subject, the area, **the date it
lands on**, the minutes, and the note. Move a Tuesday session to Monday because you logged it
after midnight, correct 90 minutes that were really 45, rewrite a note once you know what the
mark was — it all recalculates immediately, including your goals, streaks and the peloton
leaderboard.

There is a **Delete session** button in there too, which asks first. The bare × in the list
still deletes on the spot.

The pencil only appears on your own rows. It is not the interface being polite about it —
the database will not let you write to anyone else's session no matter what the browser asks.

### Study reminders

**Setup → Study reminders** turns on a notification that lands on your device at a time you
pick, on days you have not logged anything. It costs nothing and involves no third party:
the browser makers carry the message themselves, and no email is ever sent.

Turning it on asks the browser for permission **once**. If you say no, the browser remembers
and only its own site settings — the padlock beside the address bar — can undo it, so say yes
if you actually want reminders.

You get at most one a day, in your own timezone, and it varies with what your data says:

| When | What it says |
|---|---|
| Nothing logged today | Reminds you what your goal was |
| An exam inside a fortnight | Names the subject and how little you have done on it |
| A streak of three days or more | Tells you it is on the line |
| You already hit your goal | Says well done and leaves you alone |
| Sunday | A one-line summary of the week |

Pick days to skip with the Mon–Sun chips. **Send a test** proves it reaches this device.

**On iPhone and iPad there is one extra step.** Safari only allows reminders once the app is
on your Home Screen: tap Share, then *Add to Home Screen*, and open it from there. In an
ordinary Safari tab the switch stays greyed out, because nothing would arrive. Chrome, Edge,
Firefox and Safari 16.1+ on desktop, and Chrome on Android, all work in a normal tab.

Reminders are per device. Turn them on for your phone and your laptop separately if you want
both. Turning them off removes that device.

### If notifications are blocked

Plenty of school and work laptops have notifications switched off by policy. When that
happens the switch above stays greyed out and says so, rather than pretending to work.
Two things still reach you.

**The app nudges you itself.** A bar across the top of the app shows where you stand
against today's goal. Once your reminder time has passed it turns orange, the tab title
starts alternating with `⚠ 0 h today` whenever you are looking at another tab, and a dot
appears on the tab icon. None of that is a notification, so no policy can switch it off.
Dismiss it with the × and it stays gone until tomorrow.

**Your calendar can do it instead.** Setup → Study reminders → *Calendar reminder* gives
you a personal link. Add it once and your calendar delivers the reminder — the browser is
not involved, so a notification block does not apply.

In Google Calendar: **Other calendars → + → From URL**, paste, Add. On iPhone: Settings →
Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.

The feed carries two things:

- a repeating **Log your study** reminder at your chosen time, skipping the days you chose
  to skip, marked free so it never makes you look busy
- **every exam you have dated**, as a real all-day entry, with alerts a week before and the
  day before

It cannot say *"you have done nothing today"*, because calendars only re-fetch a subscribed
feed every few hours. It carries what is known in advance. For live, data-aware nudges you
need push, which works on phones.

Treat the link like a password — anyone who has it can read your exam dates. **Reset link**
issues a new one and kills the old one immediately; you then re-add it in your calendar.

### Nudging a mate

Open somebody's profile and there is a **Nudge** button. Press it and a banner
appears on their screen saying you prodded them, with the time you did it. If they
have reminders switched on it also goes to their phone.

It refuses more often than it fires, on purpose:

| It will not send if | Why |
|---|---|
| They have a timer running | They are already doing the thing |
| Their timer is merely paused | Still mid-session — they stepped away for a drink |
| They logged a session in the last half hour | They have just finished |
| You nudged that person under 15 minutes ago | One per person per quarter hour |
| It is yourself | Obviously |

The button tells you which of these applies before you press it, and the answer
comes from the database rather than the page — the anon key is public, so a rule
the browser enforces is a rule the browser can skip.

The banner **stays until you dismiss it**. If several people nudged you while you
were away they collapse into one — *"Lewis, Sam and 3 others nudged you"* — rather
than stacking up a wall of guilt. While a nudge is showing, your own progress bar
steps aside, since two bars with the same button is just noise.

Who nudged whom is the one thing in the app the peloton cannot see. Sessions and
hours are deliberately public; your nudges are visible only to you and the person
at the other end.

### What the timer files your hours against
A timer measures the day you are actually sitting there, not the day you happen
to be looking at. Scrolling the Today tab back through last week and then starting
a timer files the hours under today, where they happened. The manual add form is the
one that logs against the day on screen — that is what it is for.

Finishing only lets go of the timer once the session is safely in the database. If
the save fails, the sheet stays open with your note in it and the timer keeps running,
so nothing is lost to a dropped connection.

### While a session is running
The browser tab title becomes a live clock — `▶ 12:34 · Knox Study Track` — so a pinned tab
tells you where you are up to without switching to it. It shows `❚❚` while paused.

Move to any other tab in the app and a pill appears in the bottom corner with the running
clock, what you are working on, and **Resume/Pause** and **Finish** next to it. Click the
clock itself to jump back to the timer. It stays out of your way on Today, where the real
timer is already on screen.

### The timer
Pick what you are working on and press start. It records real elapsed time, survives closing
the tab, and appears on everyone else's **Studying right now** strip the moment it starts.
When you finish, you are asked what you got done before it saves.

Have the app open in more than one tab, or on a laptop and a phone at once, and they all
show the same clock: whichever one you press a button in tells the others straight away.
Finish a session in one and the rest let go of it rather than putting it back on the board.

### Profiles
Click anyone — on the podium, in the leaderboard, or next to their name in the activity
feed — and you get their whole profile: hours, streak, goal-hit rate, best day, hours by
subject, every area with its target and current mark, and **every session they have ever
logged**, notes and all.

Your own profile is edited under Setup: picture, display name, school and colour. There is
also a **Delete my account** button there, which removes every session, subject, area and
goal, your profile, and the login itself. It is not reversible, and it is the fastest way to
clear out test accounts.

### The admin console
The addresses listed in `schema.sql` get one extra thing: a dark control room for keeping the
peloton honest. The way in is a button at the bottom of **Setup**, and it is only rendered after
the *database* confirms the account is an administrator — nobody else sees it.

Five sections:

- **Overview** — members, sessions, hours, who is running a timer right now, and a 14-day bar
  of the whole peloton's output.
- **Members** — everyone, with sessions, hours, streak, when they last logged anything and
  whether they are still mid-setup. Rename someone, change their school, clear every session
  they have logged, or remove the account outright.
- **Sessions** — every block anyone has ever logged, searchable by note, subject or person and
  filterable by member and date. Edit opens the same sheet members use on their own sessions,
  so a correction looks exactly like one they would have made. Tick several and delete them
  together.
- **Integrity** — the anti-abuse part. It flags single blocks over six hours, days totalling
  more than sixteen, dates in the future, dates from before the member joined, exact duplicate
  entries, and timers left running overnight. Every flag is a **signal, not a verdict** — a
  seven hour Saturday before trials is real, and the console says so rather than accusing
  anyone. Nothing is ever removed automatically.
- **Audit log** — every removal and profile change made from the console, with a snapshot of
  the row as it was.

**The audit log cannot be edited or cleared, by anyone.** It has no update policy and no delete
policy in `schema.sql`, so an administrator can delete a member's session but cannot delete the
record of having done it. That is deliberate: the console is a lot of power over other people's
work, and the log is what keeps it accountable.

Two other deliberate limits. An admin **cannot create a session in somebody else's name** —
the insert policy is unchanged, and no part of moderation needs that, so leaving it out means
nobody can fabricate work for another member. And an admin **cannot delete their own account**
from the console; that still lives in Setup, where it belongs.

The panel itself is only a door, not a lock. Every check in `admin.js` runs in the browser and
could be bypassed by anyone willing to open devtools — what actually stops them is the row
level security in `schema.sql`, where every update and delete policy reads
`user_id = auth.uid() or public.is_admin()`. Force the panel open without being an admin and
you get a working-looking screen whose every button quietly changes nothing.

### What each browser actually downloads
Knox Study Track is built for a whole year group, so no client holds the whole database.
It keeps **your** rows — your subjects, your areas, your sessions — because you are the
only person who can edit them, and for everyone else it holds the rollup the statistics
are actually made of: how many minutes each person did on each day. Every peloton-wide
number here (hours, streaks, the charts, the sparklines, goal-hit rates) comes from that
one fact, so the raw sessions never need to travel.

Someone else's full history is fetched when you open their profile, and put away when
you close it. The activity feed is the forty newest entries, with their labels attached.
Live updates arrive over the socket carrying the row, so the numbers move without anyone
re-reading anything; a top-up read once a minute tidies up behind it.

The practical effect, measured on the real database: a routine update went from about
**284 KB to 2.4 KB**, and a cold start from 284 KB to about 47 KB.

### Private mode
Two switches in **Setup**, both off for everyone by default, and deliberately separate
because they are two different wishes.

**Hide my hours from everyone else.** You come off the leaderboard, the charts, the
activity feed and the live strip, and your hours stop appearing beside your name in chat.
Your own stats, streaks and goals carry on working exactly as before — you just keep them
to yourself. You can still talk in chat and still be nudged. This one is enforced by row
level security on `sessions` and `live_timers`, not by the app: the anon key is public, so
a rule kept in the browser is a rule anyone can skip. An administrator can still see your
sessions, because moderation would be impossible otherwise.

**Hide everyone else's hours from me.** The Peloton page, the live strip and the hours in
chat go away. Nothing about you changes for anyone else. For when the comparison is more
pressure than push.

### Countdowns
Today carries two: **Valedictory**, and **English Paper 1** — the date for which is read
out of the catalogue rather than typed in a second place, so it cannot drift from NESA's
timetable. Either card disappears once its day has passed, and once both have gone the
space says the HSC is underway.

### Timers that look after themselves
A timer left running overnight is the commonest way this app produces a wrong number, so
one that has been going **five hours** pauses itself and clamps to that figure — past any
real unbroken sitting, well short of a night's sleep, and still editable before you save.

A paused timer stops checking in, which is what makes it fade off the **Studying right
now** strip by itself: a running timer has to have reported in the last five minutes, a
paused one is shown for thirty and then goes quiet. A session paused yesterday lunchtime
no longer sits between two people who are actually working. Administrators can also clear
anyone's timer outright, from **Members** in the console.

### Chat
A fifth tab, and one room for the whole year group. Open it and you are in it — there is
nothing to join and nothing to choose. A dot appears on the tab when somebody has said
something since you last looked.

Beside each name is **the hours that person has logged today**, and the colour steps up
with it: green past one hour, deeper green past three, teal past five, gold past eight,
with a ring round the avatar at the top. Nobody is ever shown a zero — an empty morning
simply has no badge, so a quiet room looks clean rather than accusing. The number comes
from data the app already holds, so the whole badge costs nothing to show.

You can delete your own messages. Enter sends, Shift+Enter starts a new line, and 500
characters is the limit. Ten messages a minute is the limit too, enforced by the database
rather than the browser.

**Moderation** lives in the admin console under **Chat**: the last 200 messages with
search and a member filter, delete one or delete a selection, and a mute that stops
someone posting until you lift it. Deletions and mutes are written to the audit log like
every other removal.

**Pictures.** The button beside the box attaches one; you can also drag one in or paste
one straight from the clipboard. A photo off a phone is three or four megabytes, so it is
redrawn at a sensible size in the browser before it is uploaded — a typical camera shot
comes out around a fiftieth of what it was, which is the difference between this being
free and this costing money. Tap a picture to see it full size.

They live in a **private** bucket, not a public one: links are signed and last an hour, so
a URL copied out of the chat stops working, and deleting a message really does take its
picture away. An administrator deleting a message deletes the file with it.

**Mentions.** Type `@` and pick somebody from the list. They get the same banner a nudge
gives — it waits its turn if a nudge is already showing, and stays until dismissed. Your
own name is highlighted more strongly than anybody else's so you can find it in a busy
room. What is stored is the list of people, not the text, so a mention cannot be faked by
typing somebody's name and is not lost if they change it — and deleting the name out of
the box before sending takes them off it.

**On cost.** Opening the tab fetches the newest 50 and nothing else; older ones only if
you ask for them. New messages arrive over the socket already carrying the row, so
nothing re-reads anything. A message row holds only who, what and when — the name, the
colour and the hours are all resolved from what your browser already has.

### Filtering the leaderboard
Above the podium are two pickers. **Subject** narrows the whole Peloton page to one subject —
podium, table, both charts and the head-to-head all follow it — and **Ranked by** changes
what the order actually means: hours, sessions, longest day, goal-hit rate or current streak.
The day-range chips keep working alongside both.

Everyone who takes the subject is on the board, including anyone who has not logged to it
in the range, so "first of six" never quietly becomes "first of two". Goal hit and streak
are left blank under a subject filter: they count whole days across everything you study,
so they answer a different question from the one the board is asking.

Neither picker is remembered between visits. The Peloton page always opens on everybody,
ranked on hours, over today — the race people are actually in right now. The day-range chips
switch to 7 days, 30 days or all time.

**A wrinkle worth knowing.** Subjects belong to each person, so your Physics and mine are
two separate rows, and the only thing tying them together is the name. Spacing and
capitals are folded together, so `english advanced` and `English Advanced` are one board.
Anything beyond that is shown rather than hidden. The picker lists how many people take
each subject and marks names the Knox list does not know as `custom`, and picking one
tells you what it has collided with:

- a twin differing only by punctuation — *"Also spelt Enterprise Computing. by one person,
  who is ranked separately."*
- an abbreviation of a real course — *"Maths Standard 2 is not a catalogue subject name.
  Did you mean Mathematics Standard 2, which 11 people take?"*

Rename either one to put everybody on the same board. Where the guess would be a coin
toss — `German X` could be Continuers or Extension — nothing is suggested, because only
the person who typed it knows which they meant.

### Comparison
The Peloton tab has a podium and a full leaderboard over Today / 7 days / 30 days / all time,
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

The exception is an **administrator**, who can correct or remove anyone's entries so that
abuse can actually be cleaned up. There is no way to hide this: every such action is written to
an append-only audit log that even the administrator who wrote it cannot alter. Administrators
are named in `schema.sql` and nowhere else.

Editing is silent: a session that has been changed does not say so, and the peloton sees the new
version. Nothing keeps the old one.

Reminder settings and registered devices are the one thing in here the peloton **cannot** see.
Unlike sessions and goals, those rows are readable only by you. Nobody can tell whether you
have reminders on, and the nudge itself is generated and sent without any human seeing it.

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
| `admin.js` | The admin console — overview, members, sessions, integrity flags, audit log |
| `admin.css` | The console's own dark theme, kept apart from the app's design system |
| `schema.sql` | Tables, RLS policies, trigger, storage bucket |
| `sw.js` | Service worker. Handles reminder notifications, and deliberately caches nothing |
| `manifest.json` | Lets the app be installed to a Home Screen, which iOS requires for reminders |
| `supabase/functions/nudge/` | The scheduled job that decides who needs a nudge and sends it |
| `supabase/functions/calendar/` | Serves each person's `.ics` feed — the reminder channel that works where notifications are blocked |
| `_test/` | A mock Supabase client for opening the app locally with fake data. Not needed in production — delete it if you want. |

`_test/index.html` takes a few switches: `?admin=0` signs you in as an ordinary member so you
can check the console really is invisible, `?dirty=1` seeds one entry per integrity rule so the
flagging can be exercised, and `?stuck=1` leaves a timer of your own running for 25 hours so the
Discard path can be tested from a cold load.

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

**Reminders say "not available in this browser"** — on iPhone or iPad, add the app to your
Home Screen and open it from there. Otherwise it is usually a managed browser with
notifications switched off by policy, which nothing in the app can override: use the
calendar reminder instead. To check, open `chrome://settings/content/notifications` — if it
says *managed by your organisation*, that is the answer.

**The calendar link 404s** — you reset it and are still subscribed to the old one. Copy the
current link from Setup and re-add it.

**The calendar reminder is a day out of date** — subscribed feeds are re-fetched on the
calendar's own schedule, often only every few hours, and nothing on our side can hurry it.

**Reminders are on but nothing arrives** — check the browser has not blocked notifications
for the site, then press *Send a test*. If the test works and the nightly nudge does not,
the `VAPID_PRIVATE_KEY` secret is probably missing from the Supabase project, or the
`study-nudges` cron job is not scheduled.

**"Delete my account" says the login is still there** — your project has not got the
`delete_own_account()` function yet. Re-run `schema.sql`; it is safe to run again. Until
then the button still clears all of your data, it just cannot remove the login itself.

**The admin console button is not there** — the account you are signed in as is not in the
array in `schema.sql`, or the file has not been re-run since that array was added. The app asks
the database directly (`select is_admin()`); if the function does not exist yet, there is simply
no console and nothing breaks.

**The console opens but nothing it does sticks** — the panel is running against a project whose
policies still say `user_id = auth.uid()` with no admin clause. Re-run `schema.sql`. Every
button will look like it worked and change nothing until you do.

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

**My own timer is stuck and Discard is greyed out** — it should not be any more. Every control
on the timer card is gated on this tab knowing about your timer, so if the tab ever lost track
of a row that was still on the server, there was no button left that could remove it. The app
now takes an orphaned row of yours back off the server within thirty seconds — or instantly on
a refresh — which lights Discard up again. If a delete is actually refused you get a message
saying so rather than a card that clears while the peloton keeps seeing you study.

**Someone shows as studying who is not** — a running timer heartbeats every 60 seconds. If
their tab closes, they drop off the live strip about five minutes later.
