# Telephone Pole Message Board

A playful Next.js app with a tall 3D wooden telephone pole. Visitors rotate and move along the pole, create paper posters or transparent-background graffiti graphics, then staple/place them to an exact raycast point on the cylinder. Placement is saved to Supabase as cylindrical coordinates.

## Stack

- Next.js App Router
- React Three Fiber
- Drei
- Tailwind CSS
- Supabase database and storage

## Project Structure

```txt
app/
  globals.css
  layout.tsx
  page.tsx
components/
  AddPosterModal.tsx
  PoleScene.tsx
  PosterBoardApp.tsx
  PosterOnPole.tsx
  poleConstants.ts
lib/
  posters.ts
  supabase.ts
supabase/
  schema.sql
types/
  poster.ts
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
cp .env.example .env.local
```

3. Fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
NEXT_PUBLIC_SUPABASE_POSTER_BUCKET=poster-images
ADMIN_PASSWORD=1234
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

4. In Supabase SQL Editor, run:

```sql
-- paste supabase/schema.sql
```

The schema also enables Supabase Realtime for `public.posters`. Without this, each visitor can still load saved posters on refresh, but new posters will not appear live on already-open pages.

5. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase Data Model

`public.posters`

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` | primary key |
| `type` | `text` | `poster`, `graffiti`, plus legacy `text`, `image`, `image_text` |
| `text` | `text` | nullable |
| `image_url` | `text` | nullable public storage URL for poster images, required for graffiti graphics |
| `color` | `text` | poster paper color |
| `contact` | `text` | required Twitter handle used for search; shown on paper posters only |
| `angle` | `double precision` | radians around the cylinder |
| `y` | `double precision` | vertical position on the pole |
| `width` | `double precision` | world-space poster width |
| `height` | `double precision` | world-space poster height |
| `staples` | `jsonb` | clicked staple positions for paper posters |
| `created_at` | `timestamptz` | default `now()` |

`storage.buckets`

- `poster-images`: public image bucket used by `uploadPosterImage()`.

## Live Updates

The app subscribes to Supabase Realtime `postgres_changes` for `public.posters`. For cross-device updates to work:

- Vercel must have `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase SQL Editor must run `supabase/schema.sql`.
- The `public.posters` table must be part of the `supabase_realtime` publication. The schema includes this automatically.

If those variables are missing, the app falls back to browser `localStorage`, which is private to one browser/device and will not sync.

## 3D Placement Notes

- The pole is a vertical cylinder with radius/height defined in `components/poleConstants.ts`.
- Placement uses React Three Fiber pointer events on the cylinder mesh.
- The clicked world point is converted into local cylinder space with `worldToLocal()`.
- `angle = atan2(localPoint.x, localPoint.z)`.
- `y = localPoint.y`, clamped so the poster stays on the pole.
- Paper posters and transparent-background graffiti graphics are rendered as curved meshes that follow the cylinder.
- Paper posters enter a 4-click stapling mode before they are saved.
- Graffiti enters a spray mode: the pole shows a curved outline, and each spray click reveals more of the transparent image before saving.
- Metallic staple meshes sit at the clicked staple points.
- Search by contact rotates and scrolls the pole to each matching poster or graffiti work.

## Admin Mode

Press `Shift + A` to open the admin login. The test password is `1234`.

Admin mode can delete individual works and clear the pole. Admin login is checked server-side through `/api/admin/auth` with `ADMIN_PASSWORD`; do not add a public `NEXT_PUBLIC_` admin password. Local draft mode deletes from `localStorage`. Supabase deletion goes through `/api/admin/posters` and needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; keep that key server-only and never expose it with a `NEXT_PUBLIC_` prefix.

## Local Fallback

If Supabase environment variables are missing, the app still runs using `localStorage` and data URLs. That makes quick design/testing easy, but every visitor persistence requires Supabase configuration.
