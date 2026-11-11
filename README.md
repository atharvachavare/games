# Mafia — party game

A browser-based Mafia game for 3+ friends playing in the same room, each on their own phone.

- One person creates a room and shares the 4-letter code (or invite link).
- The host picks how many Mafia to have (up to just under half the players), then starts the game. Roles are dealt like drawing chits — a fair random shuffle every game, with no memory of previous games: **N Mafia, 1 Doctor, everyone else Citizens**. Mafia members can see who their partners are.
- **Night:** each Mafia taps a player to kill (the most-picked target is chosen, ties broken at random), then the Doctor taps a player to save. If the Doctor saves the Mafia's target, nobody dies.
- **Day:** everyone alive votes someone out (or skips). The app reveals whether that person was the Mafia.
- Citizens win when every Mafia is voted out; the Mafia win when they equal or outnumber everyone else.

## How it works

It's a static site (`index.html`) with no backend. The host's browser runs the game and players connect to it peer-to-peer over WebRTC using [PeerJS](https://peerjs.com) (vendored as `peerjs.min.js`, using the free PeerJS cloud signalling server). The host must keep their tab open for the duration of the game; reloading restores the room.

## Run locally

```
python3 -m http.server 8000
```
then open http://localhost:8000 in several tabs/devices.

## Deploy

Any static host works. On Vercel: import the repo, framework preset "Other", no build command.
