# Landing page (apps/landing)

A static Vite site, independent of the SDK/server packages (own folder, own `package.json`, no workspace dependency). No tracking, no cookies.

## Local

```sh
cd apps/landing
npm install
npm run dev      # dev server
npm run build    # output in dist/
```

## Deploy on Vercel

`apps/landing/vercel.json` sets the framework (Vite), build command and `dist` output.

**Dani: manual steps**

1. In Vercel, choose "Add New… > Project" and import `kupferco/openblah`.
2. Set **Root Directory** to `apps/landing`. Leave the build settings as detected (they come from `vercel.json`).
3. Deploy. Production is the `main` branch; every pull request gets a preview URL.
4. Optional: add a custom domain under Project > Settings > Domains.
5. Verify: open the `*.vercel.app` URL on your phone; you should see the hero, three steps, the demo placeholder and the GitHub link.

## Adding the demo video

In `apps/landing/index.html`, replace the `<figure class="video" id="demo">` contents with a `<video controls playsinline preload="none" poster="...">` (file in `apps/landing/public/`) or an embed.
