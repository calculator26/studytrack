// ============================================================
//  calendar — a personal .ics feed, so a reminder can arrive on a
//  device where the school has switched browser notifications off.
//
//  Google Calendar (and Apple, and Outlook) fetch a subscribed feed
//  anonymously and cannot send an auth header, so the token in the
//  query string is the entire access control. It is rotatable from
//  the app, and grants nothing but exam dates and a reminder time.
//
//  Carries two things:
//    * a repeating "log your study" reminder at the chosen time
//    * every exam already in the app, as a real calendar entry
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* RFC 5545 wants CRLF, escaped text, and no line over 75 octets.
   Built from a char code rather than a string literal, because a lone
   backslash in a quoted escape sequence is exactly the kind of thing that
   silently collapses and produces a feed no calendar will parse. */
const BS = String.fromCharCode(92);
const esc = (s: string) =>
  String(s)
    .split(BS).join(BS + BS)     // backslash first, or it escapes the others
    .split(";").join(BS + ";")
    .split(",").join(BS + ",")
    .replace(/\r/g, "")
    .split("\n").join(BS + "n");

function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {          // iterate by code point, never split one
    const next = cur + ch;
    if (new TextEncoder().encode(next).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");         // continuation lines begin with a space
}

const ics = (lines: string[]) => lines.map(fold).join("\r\n") + "\r\n";

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
  pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
const dateOnly = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

/* 0=Sun..6=Sat, matching Postgres, mapped to the iCalendar day codes. */
const DAYCODE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: rows, error } = await db.rpc("calendar_feed", { token });
  if (error) return new Response("Error", { status: 500 });
  const me = rows?.[0];
  if (!me) return new Response("Not found", { status: 404 });

  const { data: exams } = await db.rpc("calendar_exams", { target: me.user_id });

  const now = stamp(new Date());
  const at = String(me.remind_at || "19:30:00").slice(0, 8).replace(/:/g, "");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  /* Skip days come out of the reminder's recurrence rule rather than being
     filtered later, so the calendar itself knows about them. */
  const quiet: number[] = me.quiet_days || [];
  const days = DAYCODE.filter((_, i) => quiet.indexOf(i) < 0);

  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Study Track//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Study Track",
    "X-WR-CALDESC:" + esc("Your study reminder and every exam you have dated in Study Track"),
    /* Hint to re-fetch hourly. Google honours this loosely at best, which is
       why this feed only carries things known in advance. */
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  if (days.length) {
    out.push(
      "BEGIN:VEVENT",
      "UID:daily-" + me.user_id + "@studytrack",
      "DTSTAMP:" + now,
      /* No Z and no TZID: a floating time, which every calendar reads in the
         viewer's own local time. Exactly what a study reminder wants. */
      "DTSTART:" + today + "T" + at,
      "DURATION:PT15M",
      "RRULE:FREQ=WEEKLY;BYDAY=" + days.join(","),
      "SUMMARY:" + esc("Log your study"),
      "DESCRIPTION:" + esc("Open Study Track and log what you did today. Even twenty minutes counts."),
      "URL:https://calculator26.github.io/studytrack/",
      /* Free, not busy — this must not make anyone look booked every evening. */
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:PT0S",
      "DESCRIPTION:" + esc("Log your study"),
      "END:VALARM",
      "END:VEVENT",
    );
  }

  for (const e of (exams ?? []) as { title: string; exam_date: string }[]) {
    const day = String(e.exam_date).slice(0, 10);
    out.push(
      "BEGIN:VEVENT",
      "UID:exam-" + dateOnly(day) + "-" + esc(e.title).replace(/[^A-Za-z0-9]/g, "").slice(0, 24) +
        "-" + me.user_id + "@studytrack",
      "DTSTAMP:" + now,
      "DTSTART;VALUE=DATE:" + dateOnly(day),
      "DTEND;VALUE=DATE:" + nextDay(day),
      "SUMMARY:" + esc(e.title + " exam"),
      "DESCRIPTION:" + esc("From your subjects and areas in Study Track."),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P7D",
      "DESCRIPTION:" + esc(e.title + " exam in a week"),
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P1D",
      "DESCRIPTION:" + esc(e.title + " exam tomorrow"),
      "END:VALARM",
      "END:VEVENT",
    );
  }

  out.push("END:VCALENDAR");

  return new Response(ics(out), {
    headers: {
      "Content-Type":  "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="studytrack.ics"',
      "Cache-Control": "public, max-age=1800",
    },
  });
});
