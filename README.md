# Word Paths · Porter Family Portal

Wordament-style letter grid for [porterfamily.us](https://porterfamily.us): drag adjacent tiles (including diagonals) to find words, clear word-count and longer-word goals, and play four difficulty levels.

**Name:** Word Paths (classic grid word-finding only — not a Microsoft Wordament or Hasbro Boggle product).

## Features

- **Portal identity** — hosted portal-sdk (`/portal-assets/sdk/portal-app.js`); grant `word-paths`. Do not copy `auth.js`.
- **Levels** — Easy, Medium, Hard, Expert from a generated board bank with calibrated goals
- **Goals** — every board has a **points target** and a **letter-length goal** (3–10); optional word-count and special-tile goals rotate by board; harder levels demand more
- **Scoring** — Scrabble-style tile values on each piece; multi-letter tiles **Qu (15)**, **Th (12)**, **ING (18)**, **ER (8)**; length multiplier; time vs level average on clear
- **Special tiles** — 0 or 1 multi-letter tile per puzzle
- **Puzzle size** — UI shows how many total dictionary words exist on the board
- **Large bank** — ~64k dictionary words and 80 boards per level (320 total); recent boards avoided
- **Mobile** — geometry-based path picking for cleaner diagonal drags
- **Settings** — color schemes, optional hints, reset scores
- **Progress** — autosaved resume (every few seconds + on hide); history and best scores in `localStorage` per portal `user_id`

| Level | Board feel | Goal pressure |
|-------|------------|---------------|
| Easy | Open letters | Lower point fraction, shorter length targets |
| Medium | Balanced | Moderate points + length goals |
| Hard | Tougher mix | Higher targets, longer words |
| Expert | Sparse / high targets | Strictest points and length goals |

## Local preview

```bash
python3 scripts/build_dictionary.py      # once (or when refreshing word list)
python3 scripts/generate_boards.py       # once (or --per-level 80 to rebuild)
python3 scripts/smoke_test.py
python3 -m http.server 8092 --directory public
# open http://127.0.0.1:8092/?dev=1
```

## Production deploy

1. **Static files**

   ```bash
   ./scripts/deploy_lightsail.sh
   ```

   Syncs `public/` → `/var/www/words` on the Lightsail host.

2. **Nginx** — portal config includes `/words/` (`porter-family-portal/deploy/nginx-portal.conf`):

   ```bash
   cd /home/john/code/porter-family-portal && ./scripts/apply_nginx.sh
   ```

3. **Register app + grants** — portal-admin seeds app id `word-paths` on bootstrap. After deploy/restart of portal-admin on an existing DB, the app row is inserted if missing. Grant users **Word Paths** under Admin → Users.

4. Open `https://porterfamily.us/words/`

### Environment / ops notes

Word Paths is **static only**. Access control is:

- Session cookie validated by portal-admin on `/api/portal/auth/me`
- Client checks grant for `app_id: word-paths` (portal admins allowed)

## Rules

- 4×4 grid; connect adjacent letters (including diagonals)
- Each tile once per word; minimum 3 letters
- `Qu` is a single tile (counts as two letters in the word)
- Validated against the bundled English dictionary (no proper-noun filter is perfect)

## Data pipeline

| Script | Output |
|--------|--------|
| `scripts/build_dictionary.py` | `public/data/dictionary.json` |
| `scripts/generate_boards.py` | `public/data/boards.json` |

Dictionary source defaults to `/usr/share/dict/words` (lowercase filter), falling back to a remote alpha word list if needed.

Board generator solves each random grid with a trie, buckets by solution stats, and attaches achievable goals as a fraction of available words.

## Layout

```
public/
  index.html
  css/word-paths.css
  js/          # ES modules: app, auth, board, engine, dictionary, puzzles, scoring, settings, storage
  data/
    dictionary.json
    boards.json
scripts/
  build_dictionary.py
  generate_boards.py
  deploy_lightsail.sh
  smoke_test.py
deploy/
```

## Related repos

| Repo | Role |
|------|------|
| `porter-family-portal` | Nginx routes, portal home |
| `portal-admin` | SSO, app catalog, grants (`word-paths`) |
