'use strict';
// Server-side Mafia game engine. Pure functions over a plain JSON state object.
const crypto = require('crypto');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randInt = n => crypto.randomInt(n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[randInt(a.length)];
const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[randInt(CODE_CHARS.length)]).join('');
const newId = () => crypto.randomBytes(6).toString('hex');

// Mafia must start outnumbered, and there must be room for a Doctor.
const maxMafia = n => Math.max(1, Math.floor((n - 1) / 2));
const clampMafia = (m, n) => Math.min(Math.max(1, m | 0), maxMafia(n));

class GameError extends Error {}
const fail = m => { throw new GameError(m); };

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!n) fail('Enter your name first.');
  return n;
}

function newGame(code, secret, name) {
  const host = { id: newId(), secret, name: cleanName(name), role: null, alive: true };
  return {
    v: 1, code, phase: 'lobby', round: 0, hostId: host.id, players: [host], mafiaCount: 1,
    mafiaVotes: {}, mafiaTarget: null, doctorSave: null, lastNight: null,
    votes: {}, verdict: null, tally: null, winner: null,
  };
}

const bySecret = (G, s) => G.players.find(p => p.secret === s);
const byId = (G, id) => G.players.find(p => p.id === id);
const alive = G => G.players.filter(p => p.alive);

function join(G, secret, name) {
  name = cleanName(name);
  const existing = bySecret(G, secret);
  if (existing) { if (G.phase === 'lobby') existing.name = name; return; }
  if (G.phase !== 'lobby') fail('This game has already started. Wait for the next round.');
  if (G.players.some(p => p.name.toLowerCase() === name.toLowerCase())) fail('That name is taken in this room.');
  if (G.players.length >= MAX_PLAYERS) fail('Room is full.');
  G.players.push({ id: newId(), secret, name, role: null, alive: true });
}

function checkWinner(G) {
  const a = alive(G);
  const m = a.filter(p => p.role === 'mafia').length;
  if (m === 0) return 'citizens';
  if (m >= a.length - m) return 'mafia';
  return null;
}

function finishIfWon(G) { const w = checkWinner(G); if (w) { G.winner = w; G.phase = 'over'; } }

function resolveNight(G) {
  const target = G.mafiaTarget;
  const saved = !!target && G.doctorSave === target;
  if (target && !saved) byId(G, target).alive = false;
  G.lastNight = { round: G.round, victim: target, victimName: target ? byId(G, target).name : null, saved };
  G.phase = 'morning';
  finishIfWon(G);
}

function tallyVotes(G) {
  const counts = {};
  for (const t of Object.values(G.votes)) counts[t] = (counts[t] || 0) + 1;
  const tally = Object.entries(counts)
    .map(([id, n]) => ({ id, name: id === 'skip' ? 'Skip' : byId(G, id).name, n }))
    .sort((a, b) => b.n - a.n);
  G.tally = tally;
  const top = tally[0];
  const tie = tally.length > 1 && tally[1].n === top.n;
  if (!top || tie || top.id === 'skip') {
    G.verdict = { eliminated: null, tie, skipped: !!top && top.id === 'skip' && !tie };
  } else {
    const p = byId(G, top.id);
    p.alive = false;
    G.verdict = { eliminated: p.id, name: p.name, wasMafia: p.role === 'mafia',
      mafiaLeft: alive(G).filter(x => x.role === 'mafia').length, mafiaTotal: G.mafiaCount };
  }
  G.phase = 'verdict';
  finishIfWon(G);
}

function resetToLobby(G) {
  G.phase = 'lobby'; G.round = 0;
  G.players.forEach(p => { p.role = null; p.alive = true; });
  Object.assign(G, { mafiaVotes: {}, mafiaTarget: null, doctorSave: null, lastNight: null, votes: {}, verdict: null, tally: null, winner: null });
}

// Apply one player action. Throws GameError for things the player should be told about;
// silently ignores stale actions (e.g. a button tapped twice on a slow connection).
function act(G, secret, msg) {
  const me = bySecret(G, secret);
  if (!me) fail('You are not in this room.');
  const isHost = me.id === G.hostId;
  // Actions that move the game forward carry the phase they were tapped in, so a
  // retried or double-tapped request can't skip a phase.
  if (msg.at && msg.at !== G.phase + ':' + G.round) return;

  switch (msg.t) {
    case 'setMafia':
      if (!isHost || G.phase !== 'lobby') return;
      G.mafiaCount = clampMafia(msg.n, G.players.length);
      return;

    case 'kick':
      if (!isHost || G.phase !== 'lobby' || msg.target === G.hostId) return;
      G.players = G.players.filter(p => p.id !== msg.target);
      return;

    case 'leave':
      if (G.phase === 'lobby') G.players = G.players.filter(p => p !== me);
      else me.left = true;
      if (me.id === G.hostId) {
        const next = G.players.find(p => p !== me && !p.left);
        if (next) G.hostId = next.id;
      }
      return;

    case 'start': {
      if (!isHost || G.phase !== 'lobby') return;
      if (G.players.length < MIN_PLAYERS) fail(`Need at least ${MIN_PLAYERS} players.`);
      // Deal roles like drawing chits from a bowl: a fair shuffle, the first N are
      // Mafia and the next one is the Doctor. Every game is independent.
      const ids = shuffle(G.players.map(p => p.id));
      const m = clampMafia(G.mafiaCount, ids.length);
      G.mafiaCount = m;
      G.players.forEach(p => { p.alive = true; p.role = 'citizen'; delete p.left; });
      ids.slice(0, m).forEach(id => { byId(G, id).role = 'mafia'; });
      byId(G, ids[m]).role = 'doctor';
      Object.assign(G, { round: 1, phase: 'night_mafia', mafiaVotes: {}, mafiaTarget: null, doctorSave: null,
        lastNight: null, votes: {}, verdict: null, tally: null, winner: null });
      return;
    }

    case 'kill': {
      if (G.phase !== 'night_mafia' || !me.alive || me.role !== 'mafia') return;
      const t = byId(G, msg.target);
      if (!t || !t.alive || t.role === 'mafia') fail('Pick a valid target.');
      G.mafiaVotes[me.id] = t.id;
      const mafiaAlive = alive(G).filter(p => p.role === 'mafia');
      if (!mafiaAlive.every(p => G.mafiaVotes[p.id])) return; // wait for the rest of the Mafia
      // Most-picked target wins; a tie is settled at random.
      const counts = {};
      mafiaAlive.forEach(p => { const x = G.mafiaVotes[p.id]; counts[x] = (counts[x] || 0) + 1; });
      const best = Math.max(...Object.values(counts));
      G.mafiaTarget = pick(Object.keys(counts).filter(x => counts[x] === best));
      if (G.players.some(p => p.role === 'doctor' && p.alive)) G.phase = 'night_doctor';
      else resolveNight(G);
      return;
    }

    case 'save': {
      if (G.phase !== 'night_doctor' || !me.alive || me.role !== 'doctor') return;
      const t = byId(G, msg.target);
      if (!t || !t.alive) fail('Pick a valid player.');
      G.doctorSave = t.id;
      resolveNight(G);
      return;
    }

    // Anyone can move the day along, so the game never gets stuck waiting on one phone.
    case 'startVote':
      if (G.phase !== 'morning') return;
      G.phase = 'voting'; G.votes = {};
      return;

    case 'vote': {
      if (G.phase !== 'voting' || !me.alive) return;
      if (msg.target !== 'skip') {
        const t = byId(G, msg.target);
        if (!t || !t.alive || t.id === me.id) fail('Pick a valid player.');
      }
      G.votes[me.id] = msg.target;
      if (alive(G).every(p => G.votes[p.id])) tallyVotes(G);
      return;
    }

    case 'forceTally':
      if (!isHost || G.phase !== 'voting') return;
      tallyVotes(G);
      return;

    case 'nextNight':
      if (G.phase !== 'verdict') return;
      Object.assign(G, { round: G.round + 1, phase: 'night_mafia', mafiaVotes: {}, mafiaTarget: null,
        doctorSave: null, votes: {}, verdict: null, tally: null });
      return;

    case 'playAgain':
      if (G.phase !== 'over') return;
      G.players = G.players.filter(p => !p.left);
      resetToLobby(G);
      return;

    default:
      return;
  }
}

// What one player is allowed to see. Secrets never leave the server.
function viewFor(G, secret) {
  const me = bySecret(G, secret);
  if (!me) return null;
  const over = G.phase === 'over';
  const v = {
    v: G.v, code: G.code, phase: G.phase, round: G.round, hostId: G.hostId, me: me.id,
    players: G.players.map(p => ({
      id: p.id, name: p.name, alive: p.alive, left: !!p.left,
      // Mafia know each other; everyone else only sees their own role until the game ends.
      role: (over || p === me || (me.role === 'mafia' && p.role === 'mafia')) ? p.role : null,
    })),
    lastNight: G.lastNight, verdict: G.verdict, winner: G.winner,
    votedCount: Object.keys(G.votes).length, aliveCount: alive(G).length,
    myVote: G.votes[me.id] || null,
    mafiaCount: clampMafia(G.mafiaCount, G.players.length), maxMafia: maxMafia(G.players.length),
    tally: (G.phase === 'verdict' || over) ? G.tally : null,
  };
  if (me.role === 'mafia') { v.myKill = G.mafiaTarget; v.mafiaVotes = G.mafiaVotes; }
  if (me.role === 'doctor') v.mySave = G.doctorSave;
  return v;
}

module.exports = { newGame, join, act, viewFor, randCode, GameError, MIN_PLAYERS };
