# PariBari v2

A real, multi-user Instagram-style social app — built with plain HTML/CSS/JS on top of
**Supabase** (Postgres + Auth + Storage + Realtime). No build step, no framework.

**Live app:** https://samratbarman1013-commits.github.io/paribari/

## What actually works

- **Real accounts** — email + password sign-up and sign-in (Supabase Auth)
- **Feed with carousels** — swipe through up to 20 photos, or post a video; tap any post to
  open the full **post detail** view with its comment thread
- **Likes, comments, saves** — plus **comment likes and threaded replies**
- **#hashtags and @mentions** — tappable in every caption and comment; hashtags open a feed
  of everything tagged with them
- **Stories** — 24-hour photo/video stories with a tap-through viewer, replies straight to
  DMs, and **story highlights** saved permanently on your profile
- **Notes** — a short 24-hour status that sits above the story bar
- **Reels** — a vertical short-video feed with likes and comments
- **Direct messages** — real-time chat with read receipts (✓ / ✓✓), photo messages,
  **❤️ reactions** (double-tap a message), **reply-to**, typing indicators and shared posts
- **Follow / unfollow** — real follower & following counts with tappable lists
- **Who to follow** — suggestions on Explore and in the desktop right rail
- **Notifications** — likes, comments, follows and messages, with an unread badge
- **Profile tabs** — Posts / Reels / Tagged / Saved, plus editable name, username, bio, avatar
- **Search** — Top / People / Tags tabs
- **Settings** — dark mode, account, activity, backend info, sign out
- **Instagram-style layout** — desktop left sidebar with a right rail, mobile bottom tab bar
- Installs as a PWA (offline shell)

> **Not included:** live video, shopping/product tags, broadcast channels, AI features and
> algorithmic (ML) feed ranking. Those need infrastructure this app doesn't have.

## One-time setup (about 5 minutes)

The app ships **unconfigured** and shows a setup screen until you point it at your own
Supabase project. Do this once:

1. **Create a project** — go to [supabase.com](https://supabase.com), sign up free, and
   create a new project. (No credit card needed.)

2. **Create the database** — in your project, open **SQL Editor → New query**, paste the
   entire contents of `supabase-schema.sql`, and click **Run**. This creates the tables,
   security policies, storage buckets and the trigger that makes a profile on sign-up.

   Then do the same again with **`supabase-upgrade.sql`** (SQL Editor → New query → Run).
   That adds Stories, Reels, read receipts and photo messages.

   And once more with **`supabase-v2.sql`** — that adds carousels/video posts, comment likes
   and replies, highlights, Notes, and DM reactions / replies / shared posts.

   If you skip either one the app still works — those extras simply stay empty.

3. **Turn off email confirmation (easiest for testing)** — go to
   **Authentication → Sign In / Providers → Email** and switch *Confirm email* **off**.
   Then new accounts can sign in immediately. (Leave it on if you'd rather verify emails.)

4. **Copy your keys** — go to **Settings → API** and copy:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon / public** API key

5. **Paste them into `config.js`**:

   ```js
   window.PARIBARI_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...your-anon-key..."
   };
   ```

6. Reload the app. That's it — sign up and post.

> The anon key is *meant* to be public in front-end code; your data is protected by the
> Row Level Security policies installed by `supabase-schema.sql`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell and markup |
| `styles.css` | All styling (light + dark) |
| `app.js` | All app logic |
| `config.js` | **Your Supabase URL + publishable key go here** |
| `supabase.js` | Bundled Supabase client library (no CDN needed) |
| `supabase-schema.sql` | Run once in the Supabase SQL Editor |
| `supabase-upgrade.sql` | Run once after that — adds Stories, Reels, chat upgrades |
| `supabase-v2.sql` | Run once after that — adds carousels, comment likes/replies, highlights, Notes, DM extras |
| `sw.js` | Service worker (offline shell) |
| `manifest.webmanifest`, `icon-*.png` | PWA install assets |

## Hosting it yourself

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Upload the folder
as-is. GitHub Pages is already enabled for this repo on the `main` branch.
