# Mafia — party game

A browser-based Mafia game for 3+ friends playing in the same room, each on their own phone.

- One person creates a room and shares the 4-letter code (or invite link).
- The host picks how many Mafia to have (up to just under half the players), then starts the game. Roles are dealt like drawing chits — a fair random shuffle every game, with no memory of previous games: **N Mafia, 1 Doctor, everyone else Citizens**. Mafia members can see who their partners are.
- **Night:** each Mafia taps a player to kill (the most-picked target is chosen, ties broken at random), then the Doctor taps a player to save. If the Doctor saves the Mafia's target, nobody dies.
- **Day:** everyone alive votes someone out (or skips). The app reveals whether that person was a Mafia.
- Citizens win when every Mafia is voted out; the Mafia win when they equal or outnumber everyone else.

## How it works

- `index.html` — the whole front end (no build step).
- `api/room.js` — a Vercel serverless function that runs the game. Phones poll it every 2 seconds over plain HTTPS and send actions to it, so a patchy connection only delays an update; nobody's phone is a single point of failure, and closing/reopening the app puts you straight back into your game.
- `lib/game.js` — the game rules. Roles and secrets never leave the server: each phone only receives what that player is allowed to see.
- `lib/store.js` — room storage in Upstash Redis (rooms expire 6 hours after their last change), with an in-memory fallback for local development.
- Run `npm install` before `npm run dev` if you want to point local dev at a Redis connection string.

## Run locally

```
npm run dev
```
then open http://localhost:3000 in several browser windows (use private windows or different browsers so each is a separate player).

## Deploy on Vercel

1. Import the repo (framework preset "Other", no build command).
2. In the project: **Storage → Create Database** → pick **Upstash for Redis** or **Redis** (free plan) → connect it to the project. Either works: the server picks up Upstash REST settings (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, any custom prefix, or `UPSTASH_REDIS_REST_URL`/`_TOKEN`) or a Redis connection string (`REDIS_URL`/`KV_URL`).
3. Redeploy (settings only reach deployments made after connecting).

# Guess It! — forehead guessing game

`/headsup` (`headsup.html`, word lists in `headsup-words.js`). A single-phone party game: hold the phone sideways on your forehead, friends give clues, tilt down for correct and up to pass (or tap the buttons).

- 36 categories (about 4,200 names): Hindi, English and all movies, movie characters, TV and web series, Bollywood songs, Bollywood, Hollywood and all actors, singers, cricketers, sports stars, historical figures, heroes and villains, cartoons, anime, animals, food, famous places, brands, act-it-out actions, jobs, Pokémon, YouTubers, influencers, internet memes, Hindi and Instagram memes, viral trends, reality TV, Hindi reality shows, movie dialogues, Marathi movies, Marathi actors, Marathi songs, all Marathi, and an everything mix. Word lists live in `headsup-words.js`, `headsup-words-more.js`, `headsup-words-marathi.js` and `headsup-words-pop.js`.
- Names never repeat on a phone: every name shown is remembered in the browser's local storage and counts as seen in every category (a Hindi movie seen in "Hindi Movies" won't come up in "All Movies", and "Spider-Man" seen as a movie won't come back as a superhero). When a category is used up, it can be reshuffled.
- Needs no server or internet connection once the page has loaded.
