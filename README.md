# Study Crew

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
   publication and the avatars storage bucket. It is safe to run more than once.
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
git commit -m "Study Crew"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/study-crew.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
A minute later it is live at `https://YOUR-USERNAME.github.io/study-crew/`.
Send that link to your mates.

Finally, back in Supabase under **Authentication → URL Configuration**, add that URL to
**Site URL** and **Redirect URLs**.

---

## How it works

### Signing up
Each person makes an account with an email, a password and a display name, then walks
through a three-step setup: profile picture and colour, their subjects and areas, and their
daily goals. Nothing is prefilled — everyone's course list is their own.

### Subjects and areas
A **subject** is a course. An **area** is what you actually sit down and revise inside it —
a module, a topic, a paper section, whatever you call it. Areas are optional; you can log
against a subject in general instead. Each area can carry a **target hours** figure and the
**mark you currently score** in it, which is what makes the personal stats worth reading.

### Goals
Set hours per weekday once. Any individual day can be overridden on the Today tab. A goal of
**0** marks a rest day, and rest days never break a streak — otherwise the plan punishes you
for following it.

### The timer
Pick what you are working on and press start. It records real elapsed time, survives closing
the tab, and appears on everyone else's **Studying right now** strip the moment it starts.
When you finish, you are asked what you got done before it saves.

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

Nobody can edit or delete anything of yours. That is enforced by the database, not the
interface.

---

## Files

| File | What it is |
|---|---|
| `index.html` | Markup for auth, onboarding and the four tabs |
| `app.js` | All the logic — auth, data, timer, charts, import |
| `styles.css` | The design system |
| `config.js` | Your Supabase keys and crew name |
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

**Nothing updates until I refresh** — realtime may not be enabled. The app also polls every
90 seconds, so it will catch up regardless.
