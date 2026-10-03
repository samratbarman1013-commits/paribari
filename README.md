# PariBari

A real, multi-user Instagram-style social app — built with plain HTML/CSS/JS on top of
**Supabase** (Postgres + Auth + Storage + Realtime). No build step, no framework.

**Live app:** https://samratbarman1013-commits.github.io/paribari/

## What actually works

- **Real accounts** — email + password sign-up and sign-in (Supabase Auth)
- **Real posts** — photos uploaded from your device or camera, stored in Supabase Storage,
  shared between *all* users
- **Likes, comments, saves** — persisted per user in Postgres
- **Follow / unfollow** — with real follower & following counts
- **Direct messages** — real-time chat, delivered live via Supabase Realtime
- **Notifications** — likes, comments, follows and messages, with an unread badge
- **Profiles** — editable name, username, bio and avatar upload
- **Explore grid, search, dark mode**, and it installs as a PWA (offline shell)

## One-time setup (about 5 minutes)

The app ships **unconfigured** and shows a setup screen until you point it at your own
Supabase project. Do this once:

1. **Create a project** — go to [supabase.com](https://supabase.com), sign up free, and
   create a new project. (No credit card needed.)

2. **Create the database** — in your project, open **SQL Editor → New query**, paste the
   entire contents of `supabase-schema.sql`, and click **Run**. This creates the tables,
   security policies, storage buckets and the trigger that makes a profile on sign-up.

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
| `config.js` | **Your Supabase URL + anon key go here** |
| `supabase-schema.sql` | Run once in the Supabase SQL Editor |
| `sw.js` | Service worker (offline shell) |
| `manifest.webmanifest`, `icon-*.png` | PWA install assets |

## Hosting it yourself

Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Upload the folder
as-is. GitHub Pages is already enabled for this repo on the `main` branch.
