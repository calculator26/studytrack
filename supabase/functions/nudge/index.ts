// ============================================================
//  nudge — works out who could do with encouragement, and pushes it
//          to their devices.
//
//  Called two ways:
//    * pg_cron every 15 minutes, carrying the x-nudge-key header
//    * the app itself with mode:"test" and the signed-in user's token,
//      to prove notifications reach this device
//
//  Web push is done by hand against Web Crypto — VAPID auth (RFC 8292)
//  and payload encryption (RFC 8291) — so there is no library in the
//  path to rot or break on a runtime upgrade.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY") ??
  "BKDaGDZxF1RmeuB6AZW6-AWNQClD2B_rt8nxpHWRrUn1O-4l23URyIiWSFRjO12rxiCA5zxNO7FYL1yZHJszSpo";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
// Identifies us to the push services. Deliberately the site rather than
// anybody's email address — this value goes to Google/Mozilla/Apple on
// every single push.
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ??
  "https://calculator26.github.io/studytrack/";

/* ---------- small byte helpers ---------------------------------- */
const utf8 = (s: string) => new TextEncoder().encode(s);

function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------- VAPID: prove we are the same sender each time ------- */
async function vapidAuth(endpoint: string): Promise<string> {
  const pub = b64uToBytes(VAPID_PUBLIC);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      x: bytesToB64u(pub.slice(1, 33)),
      y: bytesToB64u(pub.slice(33, 65)),
      d: VAPID_PRIVATE,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const head = bytesToB64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, utf8(head + "." + body),
  ));
  return `vapid t=${head}.${body}.${bytesToB64u(sig)}, k=${VAPID_PUBLIC}`;
}

/* ---------- RFC 8291 aes128gcm payload encryption --------------- */
async function encrypt(p256dh: string, authSecret: string, plain: Uint8Array) {
  const uaPub = b64uToBytes(p256dh);        // the device's public key, 65 bytes
  const auth  = b64uToBytes(authSecret);   // the device's secret, 16 bytes
  const salt  = crypto.getRandomValues(new Uint8Array(16));

  // a throwaway keypair, fresh for every single message
  const as = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaKey }, as.privateKey, 256,
  ));

  // mix the shared secret with the device's auth secret
  const sharedKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: "HKDF", hash: "SHA-256", salt: auth,
      info: cat(utf8("WebPush: info\0"), uaPub, asPub),
    },
    sharedKey, 256,
  ));

  // then split that into the content key and the nonce
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: utf8("Content-Encoding: aes128gcm\0") },
    ikmKey, 128,
  ));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: utf8("Content-Encoding: nonce\0") },
    ikmKey, 96,
  ));

  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // 0x02 marks this as the last (only) record
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, cat(plain, new Uint8Array([2])),
  ));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function pushTo(sub: Sub, payload: unknown): Promise<Response> {
  const body = await encrypt(sub.p256dh, sub.auth, utf8(JSON.stringify(payload)));
  return await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization":    await vapidAuth(sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type":     "application/octet-stream",
      "TTL":              "86400",
      "Urgency":          "normal",
    },
    body,
  });
}

/* ---------- what to actually say -------------------------------- */
type Cand = {
  user_id: string; display_name: string; kind: string; local_date: string;
  goal_hours: number; hours_today: number; hours_7d: number; streak_days: number;
  exam_subject: string | null; exam_days: number | null; exam_hours_14d: number;
};

const f1 = (n: number) => String(Math.round(Number(n) * 10) / 10);

function compose(c: Cand): { title: string; body: string } {
  const goal = f1(c.goal_hours);
  const today = f1(c.hours_today);
  // rotate the wording so it does not read like the same robot every night
  const pick = (a: string[]) => a[Number(c.local_date.slice(8, 10)) % a.length];

  switch (c.kind) {
    case "goal_hit":
      return {
        title: `${today} h logged — that is your ${goal} h done`,
        body: pick([
          "Anything past here is bonus. Nice work.",
          "Goal cleared. You can stop guilt-free.",
          "That is the day earned.",
        ]),
      };

    case "exam": {
      const d = Number(c.exam_days);
      const hrs = Number(c.exam_hours_14d);
      return {
        title: `${c.exam_subject} in ${d} ${d === 1 ? "day" : "days"}`,
        body: (hrs > 0
          ? `${f1(hrs)} h on it in the last fortnight. `
          : "Nothing logged on it in a fortnight. ") +
          "Half an hour tonight would move that.",
      };
    }

    case "streak":
      return {
        title: `${c.streak_days} day streak on the line`,
        body: `You have logged something ${c.streak_days} days running. Twenty minutes keeps it alive.`,
      };

    case "digest":
      return {
        title: `Last week: ${f1(c.hours_7d)} h`,
        body: Number(c.hours_7d) > 0
          ? "That is the week behind you. Want to set the tone for this one tonight?"
          : "Nothing logged all week. Start small tonight — twenty minutes counts.",
      };

    default: { // goal_miss
      /* Short of the goal is not the same as having done nothing, and
         telling someone who has put in two hours that they logged nothing
         is the fastest way to get the whole thing muted. */
      const done = Number(c.hours_today) > 0;
      const short = Math.max(0, Number(c.goal_hours) - Number(c.hours_today));
      return {
        title: done ? `${today} h of ${goal} h today` : "Nothing logged today",
        body: done
          ? pick([
            `${f1(short)} h to go. Twenty minutes would close most of that.`,
            `${f1(short)} h short. Still time tonight.`,
            `Nearly there — ${f1(short)} h left on today's goal.`,
          ])
          : pick([
            `Your goal is ${goal} h. Twenty-five minutes now still counts.`,
            `${goal} h was the plan. A short session beats none.`,
            "Still time to put something on the board.",
          ]),
      };
    }
  }
}

/* ---------- handler --------------------------------------------- */
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nudge-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body is fine */ }

  const { data: cfg } = await db.from("notification_config")
    .select("cron_secret, live, test_user_id").eq("id", 1).single();

  const fromCron = !!cfg?.cron_secret && req.headers.get("x-nudge-key") === cfg.cron_secret;

  /* --- a signed-in person asking to test their own device --- */
  if (!fromCron) {
    if (body.mode !== "test") return json({ error: "forbidden" }, 403);
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "not signed in" }, 401);

    if (!VAPID_PRIVATE) return json({ error: "VAPID_PRIVATE_KEY is not set" }, 500);

    const { data: subs } = await db.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth").eq("user_id", who.user.id);
    if (!subs?.length) return json({ error: "no devices registered" }, 400);

    // One bad device must not sink the whole test, so each is caught.
    const results = await Promise.all(subs.map(async (s) => {
      try {
        const r = await pushTo(s as Sub, {
          title: "Study Track reminders are on",
          body: "This is what a nudge will look like.",
          kind: "test",
          url: "/",
        });
        if (r.status === 404 || r.status === 410) {
          await db.from("push_subscriptions").delete().eq("id", (s as Sub).id);
        }
        return r.status;
      } catch (e) {
        console.error("test push failed", String(e));
        return -1;
      }
    }));
    return json({ sent: results.filter((s) => s < 300).length, statuses: results });
  }

  /* --- the scheduled run --- */
  if (!VAPID_PRIVATE) return json({ error: "VAPID_PRIVATE_KEY is not set" }, 500);

  const { data: cands, error } = await db.rpc("nudge_candidates");
  if (error) return json({ error: error.message }, 500);

  const out: unknown[] = [];
  for (const c of (cands ?? []) as Cand[]) {
    const msg = compose(c);

    // Claim the day BEFORE sending: the unique index on
    // (user_id, kind, day) means a second run cannot get past here.
    const { data: logRow, error: logErr } = await db.from("notification_log")
      .insert({
        user_id: c.user_id, kind: c.kind, day: c.local_date,
        channel: "push", title: msg.title, body: msg.body,
      })
      .select("id").single();

    if (logErr) { out.push({ user: c.user_id, skipped: "already sent today" }); continue; }

    const { data: subs } = await db.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth").eq("user_id", c.user_id);

    let ok = 0;
    const statuses: number[] = [];
    for (const s of (subs ?? []) as Sub[]) {
      let status = 0;
      try {
        const r = await pushTo(s, { ...msg, kind: c.kind, url: "/" });
        status = r.status;
        if (r.status < 300) {
          ok++;
          await db.from("push_subscriptions")
            .update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
        } else if (r.status === 404 || r.status === 410) {
          // the device is gone for good — stop carrying it
          await db.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          await db.rpc("bump_push_failure", { sub_id: s.id });
        }
      } catch (e) {
        status = -1;
        console.error("push failed", s.endpoint, String(e));
      }
      statuses.push(status);
    }

    if (ok === 0) {
      // Nothing landed, so do not let the log row block tonight's retry.
      await db.from("notification_log").delete().eq("id", logRow.id);
      out.push({ user: c.user_id, kind: c.kind, sent: 0, statuses, retried: true });
    } else {
      out.push({ user: c.user_id, kind: c.kind, sent: ok, statuses });
    }
  }

  return json({ ran_at: new Date().toISOString(), considered: (cands ?? []).length, results: out });
});
