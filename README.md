# Octagonle

Guess the UFC fighter in 8 tries. Each guess shows how close you are on **gender, weight class, country, age and height**:

- 🟩 **Green**: exact match
- 🟨 **Yellow**: close (one weight class away, same continent, or within 2 years / 2 inches)
- 🟥 **Red**: not close
- ↑ / ↓ arrows: the answer is older/taller/heavier, or younger/shorter/lighter

Difficulty (toggle at the top):
Both use only current UFC fighters.
- **Easy**: current fighters who have held a UFC title, interim titles included (~47 fighters).
- **Hard**: every active fighter on the UFC roster (~650 fighters).

Modes (each difficulty has both, with separate stats):
- **Daily**: one fighter per day, the same for everyone (rolls over at local midnight).
- **Unlimited**: a new random fighter every game.

Links: `#easy`, `#unlimited` and `#easy-unlimited` open straight into that game.

Streaks, win % and guess distribution are saved in each player's browser. (Accounts were removed for now; the account-enabled version is kept in `archive/accounts/`.)

## Run it

Requires Node.js 18 or newer. There are no npm dependencies.

```sh
npm start            # http://localhost:3000
```

Set `PORT` to change the port (default 3000).

## Refresh the fighter pools

```sh
npm run build:fighters
```

On GitHub this runs automatically every Monday (see below). To run it by hand, use the command above and restart the server. It takes a few minutes.

The build also maintains `public/data/daily.json`, the daily fighter for each date about 60 days ahead. A day's fighter never changes once scheduled (unless they leave the roster before that day), so an update can't change a daily puzzle someone is in the middle of. If the sources come back looking broken (fewer than 450 fighters or 30 champions), the build stops without changing anything.

- **Hard** (`public/data/fighters.json`) is everyone on Wikipedia's [List of current UFC fighters](https://en.wikipedia.org/wiki/List_of_current_UFC_fighters): the debuted roster plus recent signings. Fans keep that page closely up to date with releases and retirements.
- **Easy** (`public/data/champions.json`) is the Hard fighters who appear on Wikipedia's [List of UFC champions](https://en.wikipedia.org/wiki/List_of_UFC_champions).

Bios and transparent headshots come from each fighter's ufc.com page. Wikipedia fills gaps: birth dates (ages are calculated in the browser so they stay current), height, nationality, and a photo when ufc.com has none (marked `"photo": true`, and the hint shows a blur instead of a silhouette). Fighters with no photo or height anywhere, usually brand-new signings, are skipped until ufc.com adds them.

Country is the fighter's birthplace country. If a fighter's ufc.com page isn't found automatically, add their name to `SLUG_OVERRIDES` in `scripts/build-fighters.mjs`; fix bad values in `OVERRIDES`.

## Deploy

The game is entirely static. `.github/workflows/update-and-deploy.yml` publishes it to **GitHub Pages** and keeps it current:

- Every Monday at 08:00 UTC it refreshes the fighters and daily schedule, commits the changes, and redeploys.
- Every push to `main` redeploys.
- Actions tab → "Update fighters and deploy" → **Run workflow** runs an update immediately.

One-time setup: push the project to a GitHub repo, then in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. (GitHub Pages is free for public repos.) If an update fails, GitHub emails you and the site keeps the last good data.

The `public/` folder also works on any other static host (Netlify, Cloudflare Pages, Vercel), but then you'd run the weekly update yourself.

## Layout

```
server.mjs                 tiny static file server for local play
public/index.html          page
public/css/styles.css      styles (light and dark)
public/js/app.js           game logic and UI
public/js/stats.js         stats and streak rules
public/js/daily.js         daily fighter selection (shared with the build)
public/data/               fighter pools and daily schedule (generated)
public/js/countries.js     flags and continents
scripts/build-fighters.mjs fighter data and headshot scraper
```

Fan-made and not affiliated with the UFC.
