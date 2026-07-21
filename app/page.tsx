"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

type DieFace = "1" | "2" | "3" | "energy" | "smash" | "heart";
type Phase = "roll" | "resolve" | "shop" | "yield" | "over";
type Trait = "extraDie" | "armor" | "claws" | "regen" | "reactor" | "score" | "drain" | "tail" | "focus" | "city" | "bargain";
type Instant = { vp?: number; heal?: number; energy?: number; damageAll?: number; damageCity?: number };
type Player = { id: number; name: string; bot: boolean; hp: number; vp: number; energy: number; eliminated: boolean; monster: number; cards: string[] };
type Card = { id: string; name: string; cost: number; type: "KEEP" | "NOW"; description: string; art: number; weight: number; trait?: Trait; instant?: Instant };
type GameState = { started: boolean; players: Player[]; currentId: number; cityId: number | null; dice: DieFace[]; held: boolean[]; rollsLeft: number; phase: Phase; market: string[]; deck: string[]; discard: string[]; log: string[]; turn: number; rollNonce: number; winnerId: number | null; pendingYield: { targetId: number; attackerId: number; continueBot: boolean } | null; difficulty: "easy" | "normal" | "ruthless" };
type Member = { id: number; name: string; monster: number };
type Room = { code: string; token: string; playerId: number; host: boolean; revision: number; status: "lobby" | "active"; players: Member[] };
type Action =
  | { type: "NEW_GAME"; playerCount: number; monster: number; difficulty: GameState["difficulty"] }
  | { type: "NEW_MULTI"; players: Member[] }
  | { type: "LOAD"; state: GameState }
  | { type: "ROLL" } | { type: "TOGGLE_HOLD"; index: number } | { type: "RESOLVE" }
  | { type: "YIELD_CITY" } | { type: "STAY_CITY" } | { type: "BUY"; cardId: string }
  | { type: "SWEEP_MARKET" } | { type: "END_TURN" } | { type: "BOT_ROLL"; dice: DieFace[] } | { type: "BOT_RESOLVE" };

const MONSTERS = ["Pyroclast", "Voltwing", "Gravilla", "Tempest Coil", "Prism Claw", "Reactor Jack", "Mecha Mako", "Verdant Titan", "Moonseer"];
const BOT_NAMES = ["Rumble-9", "HEXAPE", "Neon Fang", "Moss Unit", "Star Talon"];
const FACES: DieFace[] = ["1", "2", "3", "energy", "smash", "heart"];
const TRAITS: Trait[] = ["extraDie", "armor", "claws", "regen", "reactor", "score", "drain", "tail", "focus", "city", "bargain"];
const TRAIT_COPY: Record<Trait, string> = {
  extraDie: "Roll one extra die each turn.", armor: "Reduce each hit you take by 1.", claws: "Your Smash results deal +1 damage.",
  regen: "Heal +1 whenever hearts restore health.", reactor: "Gain 1 energy at the start of your turn.", score: "Number sets score +1 victory point.",
  drain: "Heal 1 after dealing Smash damage.", tail: "Deal 1 damage to an attacker when you yield.", focus: "A pair of 3s scores 1 VP.",
  city: "Gain +1 additional VP when starting in the city.", bargain: "Market cards cost 1 less energy (minimum 1).",
};
const KEEP_NAMES = [
  "Expanded Core", "Battle Carapace", "Ion Maw", "Rapid Regrowth", "Pocket Reactor", "Crowd Favorite", "Drain Ray", "Spiked Tail", "Hyper Focus", "City Crown", "Coupon Claws",
  "Titan Lungs", "Mirror Hide", "Plasma Knuckles", "Jungle Renewal", "Solar Stomach", "Headline Hunter", "Siphon Fangs", "Razor Ridge", "Threefold Mind", "Rooftop Throne", "Black-Market Wink",
  "Quantum Spleen", "Bubble Armor", "Meteor Fists", "Mossy Metabolism", "Portable Dynamo", "Fan Club", "Vampire Circuit", "Retaliation Spines", "Lucky Antennae", "Mayor of Mayhem", "Energy Broker",
];
const NOW_NAMES = [
  "Nova Burst", "Overcharge", "Repair Swarm", "Media Frenzy", "Citywide Panic", "Metamorphosis", "Grid Dividend", "City Rupture", "Reserve Plating", "Orbital Snack", "Flash Victory",
  "Emergency Battery", "Kaiju Karaoke", "Harbor Shockwave", "Instant Evolution", "Power-Line Picnic", "Skyline Slam", "Armor Patch", "Victory Lap", "Fusion Breakfast", "Mass Evacuation", "Downtown Detour",
  "Thunder Delivery", "Healing Rain", "Stadium Roar", "Subway Surge", "Monorail Toss", "Reactor Refund", "Greenbelt Feast", "Broadcast Blitz", "Bay Quake", "Prism Recharge", "Last-Minute Upgrade",
];
const INSTANTS: Instant[] = [
  { vp: 2, damageAll: 1 }, { energy: 3 }, { heal: 4 }, { vp: 2 }, { damageAll: 2 }, { heal: 2, energy: 2 },
  { energy: 4 }, { vp: 1, damageCity: 1 }, { heal: 2, vp: 1 }, { heal: 3, energy: 1 }, { vp: 3 },
];
const instantCopy = (x: Instant) => [x.vp && `gain ${x.vp} VP`, x.heal && `restore ${x.heal} health`, x.energy && `gain ${x.energy} energy`, x.damageAll && `every rival loses ${x.damageAll} health`, x.damageCity && `the city ruler loses ${x.damageCity} health`].filter(Boolean).join("; ").replace(/^./, (c) => c.toUpperCase()) + ".";
const CARDS: Card[] = [
  ...KEEP_NAMES.map((name, i): Card => ({ id: `keep-${i}`, name, cost: 3 + (i % 4), type: "KEEP", description: TRAIT_COPY[TRAITS[i % TRAITS.length]], trait: TRAITS[i % TRAITS.length], art: i % 4, weight: 6 + (i % 5) })),
  ...NOW_NAMES.map((name, i): Card => ({ id: `now-${i}`, name, cost: 3 + (i % 5), type: "NOW", description: instantCopy(INSTANTS[i % INSTANTS.length]), instant: INSTANTS[i % INSTANTS.length], art: i % 4, weight: 5 + (i % 6) })),
];
const CARD_MAP = Object.fromEntries(CARDS.map((card) => [card.id, card])) as Record<string, Card>;
const initialState: GameState = { started: false, players: [], currentId: 0, cityId: null, dice: Array(6).fill("energy") as DieFace[], held: Array(6).fill(false), rollsLeft: 3, phase: "roll", market: [], deck: [], discard: [], log: [], turn: 1, rollNonce: 0, winnerId: null, pendingYield: null, difficulty: "normal" };
const ROOM_API_ORIGIN = "https://kaiju-clash-neon-city.alphacodeai.chatgpt.site";
const onGitHubPages = () => typeof window !== "undefined" && window.location.hostname.endsWith("github.io");
const apiPath = (path: string) => `${onGitHubPages() ? ROOM_API_ORIGIN : ""}${path}`;
const assetPath = (path: string) => `${onGitHubPages() ? "/KingOfTokyo" : ""}${path}`;

function randomIndex(maxExclusive: number) {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) return Math.floor(Math.random() * maxExclusive);
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % maxExclusive;
}
function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function randomFace(): DieFace { return FACES[Math.floor(Math.random() * FACES.length)]; }
function hasTrait(player: Player, trait: Trait) { return player.cards.some((id) => CARD_MAP[id]?.trait === trait); }
function alive(players: Player[]) { return players.filter((player) => !player.eliminated); }
function checkWinner(players: Player[]) { const points = players.find((p) => !p.eliminated && p.vp >= 20); const living = alive(players); return points?.id ?? (living.length === 1 ? living[0].id : null); }
function price(player: Player, card: Card) { return Math.max(1, card.cost - (hasTrait(player, "bargain") ? 1 : 0)); }
function refillMarket(market: string[], deck: string[], discard: string[]) { const nextMarket = [...market]; let nextDeck = [...deck], nextDiscard = [...discard]; while (nextMarket.length < 3) { if (!nextDeck.length) { nextDeck = shuffle(nextDiscard); nextDiscard = []; } const card = nextDeck.shift(); if (!card) break; nextMarket.push(card); } return { market: nextMarket, deck: nextDeck, discard: nextDiscard }; }
function damagePlayer(players: Player[], id: number, amount: number) { return players.map((p) => { if (p.id !== id || p.eliminated) return p; const hp = Math.max(0, p.hp - Math.max(0, amount - (hasTrait(p, "armor") ? 1 : 0))); return { ...p, hp, eliminated: hp === 0 }; }); }
function applyCard(players: Player[], buyerId: number, card: Card, cityId: number | null) {
  const buyerBefore = players.find((p) => p.id === buyerId)!;
  let next = players.map((p) => p.id === buyerId ? { ...p, energy: p.energy - price(buyerBefore, card), cards: card.type === "KEEP" ? [...p.cards, card.id] : p.cards } : p);
  const instant = card.instant;
  if (!instant) return next;
  next = next.map((p) => p.id === buyerId ? { ...p, vp: p.vp + (instant.vp ?? 0), hp: Math.min(10, p.hp + (instant.heal ?? 0)), energy: p.energy + (instant.energy ?? 0) } : p);
  if (instant.damageAll) next.filter((p) => p.id !== buyerId && !p.eliminated).forEach((p) => { next = damagePlayer(next, p.id, instant.damageAll!); });
  if (instant.damageCity && cityId !== null && cityId !== buyerId) next = damagePlayer(next, cityId, instant.damageCity);
  return next;
}
function makeGame(players: Player[], difficulty: GameState["difficulty"]): GameState { const deck = shuffle(CARDS.map((c) => c.id)); return { ...initialState, started: true, players, deck: deck.slice(3), market: deck.slice(0, 3), difficulty, log: [`${players[0].name} takes the first turn.`, "Reach 20 VP or become the last monster standing."] }; }
function startNextTurn(state: GameState): GameState {
  const living = alive(state.players); if (living.length <= 1) return { ...state, phase: "over", winnerId: living[0]?.id ?? null };
  let nextId = state.currentId; do nextId = (nextId + 1) % state.players.length; while (state.players[nextId].eliminated);
  const players = state.players.map((p) => p.id === nextId ? { ...p, vp: p.vp + (state.cityId === nextId ? 2 + (hasTrait(p, "city") ? 1 : 0) : 0), energy: p.energy + (hasTrait(p, "reactor") ? 1 : 0) } : p);
  const winnerId = checkWinner(players); if (winnerId !== null) return { ...state, players, currentId: nextId, winnerId, phase: "over" };
  const count = 6 + (hasTrait(players[nextId], "extraDie") ? 1 : 0);
  return { ...state, players, currentId: nextId, dice: Array(count).fill("energy") as DieFace[], held: Array(count).fill(false), rollsLeft: 3, phase: "roll", pendingYield: null, turn: state.turn + 1, log: [`Turn ${state.turn + 1}: ${players[nextId].name}.`, ...state.log].slice(0, 18) };
}
function botShouldYield(state: GameState, target: Player, damage: number) { return state.difficulty === "easy" ? target.hp <= 7 || damage >= 3 : state.difficulty === "ruthless" ? target.hp <= 3 : target.hp <= 5 || damage >= 4; }
function resolveDice(state: GameState, continueBot: boolean): GameState {
  const current = state.players[state.currentId]; const counts = state.dice.reduce<Record<string, number>>((a, f) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {}); let players = state.players.map((p) => ({ ...p })); let cityId = state.cityId; const notes: string[] = [];
  let score = 0; ["1", "2", "3"].forEach((f) => { const n = counts[f] ?? 0; if (n >= 3) score += Number(f) + n - 3; if (f === "3" && n === 2 && hasTrait(current, "focus")) score += 1; }); if (score && hasTrait(current, "score")) score++;
  const energy = counts.energy ?? 0, hearts = counts.heart ?? 0, smash = counts.smash ?? 0, inCity = cityId === current.id; const heal = inCity ? 0 : hearts + (hearts > 0 && hasTrait(current, "regen") ? 1 : 0);
  players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + score, energy: p.energy + energy, hp: Math.min(10, p.hp + heal) } : p);
  if (score) notes.push(`${score} VP`); if (energy) notes.push(`${energy} energy`); if (heal) notes.push(`${heal} health`); if (hearts && inCity) notes.push("city blocked healing");
  let pendingYield: GameState["pendingYield"] = null;
  if (smash) {
    const attack = smash + (hasTrait(current, "claws") ? 1 : 0); const targets = inCity ? players.filter((p) => p.id !== current.id && !p.eliminated).map((p) => p.id) : cityId !== null ? [cityId] : [];
    targets.forEach((id) => { players = damagePlayer(players, id, attack); }); if (targets.length) notes.push(`${attack} damage`);
    if (hasTrait(current, "drain") && targets.length) players = players.map((p) => p.id === current.id ? { ...p, hp: Math.min(10, p.hp + 1) } : p);
    if (!inCity && cityId !== null && !players[cityId].eliminated) { const target = players[cityId]; if (!target.bot) pendingYield = { targetId: target.id, attackerId: current.id, continueBot }; else if (botShouldYield(state, target, attack)) { if (hasTrait(target, "tail")) players = damagePlayer(players, current.id, 1); cityId = current.id; players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p); notes.push(`${target.name} yielded`); } }
  }
  if (cityId !== null && players[cityId].eliminated) cityId = null;
  if (cityId === null && !players[current.id].eliminated) { cityId = current.id; players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p); notes.push("entered the city +1 VP"); }
  const winnerId = checkWinner(players); const log = [`${current.name}: ${notes.length ? notes.join(" • ") : "no effect"}.`, ...state.log].slice(0, 18);
  return winnerId !== null ? { ...state, players, cityId, winnerId, phase: "over", log } : { ...state, players, cityId, pendingYield, phase: pendingYield ? "yield" : "shop", log };
}
function botShop(state: GameState) { const bot = state.players[state.currentId]; const choice = state.market.map((id) => CARD_MAP[id]).filter((c) => price(bot, c) <= bot.energy).sort((a, b) => b.weight - a.weight)[0]; if (!choice) return state; const players = applyCard(state.players, bot.id, choice, state.cityId); const refill = refillMarket(state.market.filter((id) => id !== choice.id), state.deck, choice.type === "NOW" ? [...state.discard, choice.id] : state.discard); const winnerId = checkWinner(players); return { ...state, players, ...refill, winnerId, phase: winnerId !== null ? "over" as Phase : state.phase, log: [`${bot.name} bought ${choice.name}.`, ...state.log].slice(0, 18) }; }
function gameReducer(state: GameState, action: Action): GameState {
  if (action.type === "LOAD") return action.state;
  if (action.type === "NEW_MULTI") return makeGame(action.players.map((p) => ({ ...p, bot: false, hp: 10, vp: 0, energy: 0, eliminated: false, cards: [] })), "normal");
  if (action.type === "NEW_GAME") { const roster = shuffle(MONSTERS.map((_, i) => i).filter((i) => i !== action.monster)); return makeGame(Array.from({ length: action.playerCount }, (_, i) => ({ id: i, name: i ? BOT_NAMES[i - 1] : MONSTERS[action.monster], bot: i > 0, hp: 10, vp: 0, energy: 0, eliminated: false, monster: i ? roster[i - 1] : action.monster, cards: [] })), action.difficulty); }
  if (!state.started || state.phase === "over") return state; const current = state.players[state.currentId];
  if (action.type === "ROLL" && !current.bot && ["roll", "resolve"].includes(state.phase) && state.rollsLeft > 0) return { ...state, dice: state.dice.map((f, i) => state.held[i] ? f : randomFace()), rollsLeft: state.rollsLeft - 1, phase: "resolve", rollNonce: state.rollNonce + 1 };
  if (action.type === "TOGGLE_HOLD" && !current.bot && state.phase === "resolve") return { ...state, held: state.held.map((v, i) => i === action.index ? !v : v) };
  if (action.type === "RESOLVE" && !current.bot && state.phase === "resolve") return resolveDice(state, false);
  if ((action.type === "YIELD_CITY" || action.type === "STAY_CITY") && state.phase === "yield" && state.pendingYield) { const pending = state.pendingYield; let players = state.players; let cityId = state.cityId; if (action.type === "YIELD_CITY") { const target = players[pending.targetId]; if (hasTrait(target, "tail")) players = damagePlayer(players, pending.attackerId, 1); players = players.map((p) => p.id === pending.attackerId ? { ...p, vp: p.vp + 1 } : p); cityId = pending.attackerId; } let next: GameState = { ...state, players, cityId, pendingYield: null, phase: "shop", log: [action.type === "YIELD_CITY" ? "The city changed claws." : "The ruler stood firm.", ...state.log].slice(0, 18) }; if (pending.continueBot) next = startNextTurn(botShop(next)); return next; }
  if (action.type === "BUY" && !current.bot && state.phase === "shop") { const card = CARD_MAP[action.cardId]; if (!card || !state.market.includes(card.id) || current.energy < price(current, card)) return state; const players = applyCard(state.players, current.id, card, state.cityId); const refill = refillMarket(state.market.filter((id) => id !== card.id), state.deck, card.type === "NOW" ? [...state.discard, card.id] : state.discard); const winnerId = checkWinner(players); return { ...state, players, ...refill, winnerId, phase: winnerId !== null ? "over" : "shop", log: [`${current.name} bought ${card.name}.`, ...state.log].slice(0, 18) }; }
  if (action.type === "SWEEP_MARKET" && !current.bot && state.phase === "shop" && current.energy >= 2) { const players = state.players.map((p) => p.id === current.id ? { ...p, energy: p.energy - 2 } : p); return { ...state, players, ...refillMarket([], state.deck, [...state.discard, ...state.market]), log: [`${current.name} refreshed the market.`, ...state.log].slice(0, 18) }; }
  if (action.type === "END_TURN" && !current.bot && state.phase === "shop") return startNextTurn(state);
  if (action.type === "BOT_ROLL" && current.bot && state.phase === "roll") return { ...state, dice: action.dice, rollsLeft: 0, phase: "resolve", held: action.dice.map(() => true), rollNonce: state.rollNonce + 1 };
  if (action.type === "BOT_RESOLVE" && current.bot && state.phase === "resolve") { const resolved = resolveDice(state, true); return resolved.phase === "over" || resolved.phase === "yield" ? resolved : startNextTurn(botShop(resolved)); }
  return state;
}
function chooseBotDice(state: GameState, player: Player) { const count = 6 + (hasTrait(player, "extraDie") ? 1 : 0); let dice = Array.from({ length: count }, randomFace); for (let n = 0; n < 2; n++) dice = dice.map((f) => f === "smash" || f === "energy" || (f === "heart" && player.hp < 6 && state.cityId !== player.id) ? f : randomFace()); return dice; }
function monsterStyle(i: number) { return { backgroundPosition: `${(i % 3) * 50}% ${Math.floor(i / 3) * 50}%` }; }
function artStyle(i: number) { return { backgroundPosition: `${(i % 2) * 100}% ${Math.floor(i / 2) * 100}%` }; }
function Avatar({ monster, size = "normal" }: { monster: number; size?: "small" | "normal" | "large" }) { return <span className={`avatar avatar-${size}`} style={monsterStyle(monster)} aria-hidden />; }
const faceLabel = (face: DieFace) => face === "energy" ? "⚡" : face === "smash" ? "POW" : face === "heart" ? "♥" : face;

export default function Home() {
  const [game, rawDispatch] = useReducer(gameReducer, initialState);
  const [playerCount, setPlayerCount] = useState(4), [monster, setMonster] = useState(0); const [difficulty, setDifficulty] = useState<GameState["difficulty"]>("normal");
  const [setupOpen, setSetupOpen] = useState(true), [rulesOpen, setRulesOpen] = useState(false), [soundOn, setSoundOn] = useState(true), [mode, setMode] = useState<"solo" | "multi">("solo");
  const [name, setName] = useState("Player One"), [joinCode, setJoinCode] = useState(""), [room, setRoom] = useState<Room | null>(null), [roomError, setRoomError] = useState(""), [busy, setBusy] = useState(false);
  const revisionRef = useRef(0);
  const current = game.players[game.currentId], cityPlayer = game.cityId === null ? null : game.players[game.cityId], winner = game.winnerId === null ? null : game.players[game.winnerId];
  const localId = room?.playerId ?? 0; const canAct = !!current && !current.bot && (!room || current.id === localId); const canYield = !!game.pendingYield && (!room || game.pendingYield.targetId === localId);
  const play = useCallback((sound: "dice-roll" | "smash-impact" | "energy-zap" | "heal-pulse" | "victory-roar") => { if (!soundOn) return; const audio = new Audio(assetPath(`/sounds/${sound}.mp3`)); audio.volume = .55; void audio.play().catch(() => {}); }, [soundOn]);
  const sync = useCallback(async (next: GameState) => { if (!room) return; const response = await fetch(apiPath(`/api/rooms/${room.code}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: room.token, action: "sync", state: next, revision: revisionRef.current }) }); if (response.ok) { const data = await response.json(); revisionRef.current = data.revision; setRoom((r) => r ? { ...r, revision: data.revision } : r); } }, [room]);
  const act = useCallback((action: Action) => { const next = gameReducer(game, action); rawDispatch({ type: "LOAD", state: next }); if (room) void sync(next); }, [game, room, sync]);

  useEffect(() => { if (!game.started || room || game.phase === "over" || !current?.bot || game.phase !== "roll") return; const timer = window.setTimeout(() => rawDispatch({ type: "BOT_ROLL", dice: chooseBotDice(game, current) }), 650); return () => clearTimeout(timer); }, [game, current, room]);
  useEffect(() => { if (!game.started || room || !current?.bot || game.phase !== "resolve") return; const timer = window.setTimeout(() => rawDispatch({ type: "BOT_RESOLVE" }), 900); return () => clearTimeout(timer); }, [game.started, game.phase, game.currentId, current, room]);
  useEffect(() => { if (!room) return; const roomCode = room.code, roomToken = room.token; const poll = async () => { try { const response = await fetch(apiPath(`/api/rooms/${roomCode}?token=${roomToken}`), { cache: "no-store" }); if (!response.ok) return; const data = await response.json(); if (data.revision > revisionRef.current) { revisionRef.current = data.revision; if (data.gameState) rawDispatch({ type: "LOAD", state: data.gameState }); } setRoom((r) => r ? { ...r, players: data.players, status: data.status, revision: data.revision } : r); } catch {} }; void poll(); const timer = setInterval(poll, 900); return () => clearInterval(timer); }, [room?.code, room?.token]);
  useEffect(() => { if (game.phase === "over" && winner) play("victory-roar"); }, [game.phase, winner, play]);

  const scorePreview = useMemo(() => { if (!game.started || game.phase === "roll") return "Roll, then tap dice to lock them."; const c = game.dice.reduce<Record<string, number>>((a, f) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {}); return `${c.smash ?? 0} POW · ${c.heart ?? 0} HEAL · ${c.energy ?? 0} ENERGY`; }, [game]);
  const startSolo = () => { setRoom(null); rawDispatch({ type: "NEW_GAME", playerCount, monster, difficulty }); setSetupOpen(false); };
  const createRoom = async () => { setBusy(true); setRoomError(""); try { const response = await fetch(apiPath("/api/rooms"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, monster }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); revisionRef.current = 0; setRoom({ ...data, revision: 0, status: "lobby", players: [{ id: 0, name, monster }] }); } catch (e) { setRoomError(e instanceof Error ? e.message : "Could not create room"); } finally { setBusy(false); } };
  const joinRoom = async () => { setBusy(true); setRoomError(""); try { const code = joinCode.trim().toUpperCase(); const response = await fetch(apiPath(`/api/rooms/${code}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, monster }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); revisionRef.current = 0; setRoom({ ...data, revision: 0, status: "lobby", players: [] }); } catch (e) { setRoomError(e instanceof Error ? e.message : "Could not join room"); } finally { setBusy(false); } };
  const startRoom = async () => { if (!room || room.players.length < 2) return; const next = gameReducer(initialState, { type: "NEW_MULTI", players: room.players }); const response = await fetch(apiPath(`/api/rooms/${room.code}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: room.token, action: "start", state: next, revision: revisionRef.current }) }); if (response.ok) { const data = await response.json(); revisionRef.current = data.revision; rawDispatch({ type: "LOAD", state: next }); setRoom({ ...room, revision: data.revision, status: "active" }); setSetupOpen(false); } };
  const roll = () => { play("dice-roll"); act({ type: "ROLL" }); };
  const resolve = () => { const dice = game.dice; if (dice.includes("smash")) play("smash-impact"); else if (dice.includes("energy")) play("energy-zap"); else if (dice.includes("heart")) play("heal-pulse"); act({ type: "RESOLVE" }); };

  return <main className={`game-shell ${game.rollNonce ? "has-action" : ""}`}>
    <header className="topbar"><button className="brand" onClick={() => setSetupOpen(true)}><span>MONSTER-DICE MAYHEM</span><b>KAIJU CLASH</b></button><div className="turn-chip"><i />{game.started ? `TURN ${game.turn} · ${current?.name}` : "READY TO RUMBLE"}</div><nav><button onClick={() => setSoundOn(!soundOn)}>{soundOn ? "🔊 SOUND" : "🔇 MUTED"}</button><button onClick={() => setRulesOpen(true)}>RULES</button><button className="hot" onClick={() => setSetupOpen(true)}>NEW GAME</button></nav></header>
    {room && <div className="room-ribbon"><b>ROOM {room.code}</b><span>{room.status === "active" ? `${room.players.length} MONSTERS CONNECTED` : "LOBBY OPEN"}</span><button onClick={() => navigator.clipboard.writeText(`${location.origin}?room=${room.code}`)}>COPY INVITE</button></div>}
    {game.started && <section className="player-rail">{game.players.map((p) => <article key={p.id} className={`${p.id === game.currentId ? "current" : ""} ${p.id === game.cityId ? "ruler" : ""} ${p.eliminated ? "out" : ""}`}><Avatar monster={p.monster} size="small"/><div><b>{p.name}</b><small>{room ? (p.id === localId ? "YOU" : "ONLINE") : p.bot ? "CPU" : "YOU"}{p.id === game.cityId ? " · TOKYO" : ""}</small></div><strong className="hp">♥ {p.hp}</strong><strong className="vp">★ {p.vp}</strong><strong className="en">⚡ {p.energy}</strong></article>)}</section>}
    <section className="table-grid">
      <article className="panel city-panel"><header><div><span className="eyebrow">BATTLE ZONE</span><h2>TOKYO BAY</h2></div><b className={cityPlayer ? "occupied" : ""}>{cityPlayer ? "OCCUPIED" : "OPEN"}</b></header><div className="city-stage"><div className="sun"/><div className="roads"/><div className="tower t1"/><div className="tower t2"/><div className="tower t3"/><div className="park">TOKYO<br/>PARK</div><div className="arena">TOKYO</div>{cityPlayer ? <div className="city-monster"><Avatar monster={cityPlayer.monster} size="large"/><strong>{cityPlayer.name}</strong><small>+2 VP NEXT TURN</small></div> : <div className="city-empty"><b>THE CITY IS OPEN!</b><span>Resolve a turn to stomp in for +1 VP</span></div>}</div><footer><b>INSIDE attacks everyone.</b><span>Outside attacks the ruler.</span></footer></article>
      <article className="panel dice-panel"><header><div><span className="eyebrow">ACTION CONSOLE</span><h2>{room && !canAct ? "WATCH THE ACTION" : current?.bot ? "CPU ROLL" : "YOUR ROLL"}</h2></div><b>{game.rollsLeft} ROLLS LEFT</b></header><div className="dice-tray">{game.dice.map((face, i) => <button key={`${i}-${game.rollNonce}`} className={`die face-${face} ${game.held[i] ? "held" : ""}`} onClick={() => act({ type: "TOGGLE_HOLD", index: i })} disabled={!canAct || game.phase !== "resolve"}><span>{faceLabel(face)}</span>{game.held[i] && <small>LOCKED</small>}</button>)}</div><div className="score-strip"><span>{scorePreview}</span><b>3× NUMBER = SCORE</b></div><div className="primary-actions"><button className="roll" onClick={roll} disabled={!game.started || !canAct || !["roll", "resolve"].includes(game.phase) || game.rollsLeft <= 0}>{game.phase === "roll" ? "ROLL THE DICE!" : `REROLL · ${game.rollsLeft}`}</button><button className="resolve" onClick={resolve} disabled={!game.started || !canAct || game.phase !== "resolve"}>SCORE & SMASH</button></div>{game.phase === "shop" && canAct && <div className="end-dock"><span>Power up, then pass the action.</span><button onClick={() => act({ type: "END_TURN" })}>END TURN →</button></div>}{game.started && !canAct && <div className="waiting"><i/>Waiting for {current?.name}…</div>}</article>
      <aside className="panel market-panel"><header><div><span className="eyebrow">66-CARD DECK</span><h2>POWER MARKET</h2></div><button onClick={() => act({ type: "SWEEP_MARKET" })} disabled={!canAct || game.phase !== "shop" || (current?.energy ?? 0) < 2}>REFRESH · 2⚡</button></header><div className="market-list">{game.market.map((id) => { const card = CARD_MAP[id]; const cost = current ? price(current, card) : card.cost; const buy = canAct && game.phase === "shop" && (current?.energy ?? 0) >= cost; return <article className="market-card" key={id}><div className="card-art" style={artStyle(card.art)}><span>{card.type}</span></div><div className="card-copy"><header><h3>{card.name}</h3><b>{cost}⚡</b></header><p>{card.description}</p><button onClick={() => { play("energy-zap"); act({ type: "BUY", cardId: id }); }} disabled={!buy}>BUY POWER</button></div></article>; })}{!game.started && <div className="market-empty">Launch a match to reveal three wild powers.</div>}</div></aside>
    </section>
    <section className="lower-grid"><article className="panel log-panel"><span className="eyebrow">LIVE FEED</span><h2>BATTLE LOG</h2><ol>{game.log.slice(0, 5).map((entry, i) => <li key={`${entry}-${i}`}><b>{String(game.turn - i).padStart(2, "0")}</b><span>{entry}</span></li>)}</ol></article><article className="panel loadout-panel"><span className="eyebrow">BIO-MODS</span><h2>YOUR LOADOUT</h2><div className="loadout-list">{(game.players[localId]?.cards ?? []).map((id) => { const card = CARD_MAP[id]; return <article className="loadout-card" key={id}><span aria-hidden>⚙</span><div><b>{card.name}</b><p>{card.description}</p></div><small>KEEP</small></article>; })}</div>{!(game.players[localId]?.cards ?? []).length && <p>Buy KEEP cards to build your monster.</p>}</article></section>

    {setupOpen && <div className="modal-backdrop"><section className="setup-modal"><button className="modal-close" onClick={() => game.started && setSetupOpen(false)} disabled={!game.started}>CLOSE</button><span className="eyebrow">ORIGINAL BROWSER BOARD GAME</span><h1>PICK YOUR MONSTER!</h1><p>Roll. Wreck. Rule Tokyo. First to 20 stars—or last monster standing—wins.</p><div className="mode-tabs"><button className={mode === "solo" ? "active" : ""} onClick={() => { setMode("solo"); setRoom(null); }}>SINGLE PLAYER</button><button className={mode === "multi" ? "active" : ""} onClick={() => setMode("multi")}>MULTIPLAYER</button></div><div className="monster-picker">{MONSTERS.map((n, i) => <button key={n} className={monster === i ? "selected" : ""} onClick={() => setMonster(i)}><Avatar monster={i}/><span>{n}</span></button>)}</div>
      {mode === "solo" ? <div className="setup-options"><label>MONSTERS<select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>{[2,3,4,5,6].map((n) => <option key={n}>{n}</option>)}</select></label><label>CPU LEVEL<select value={difficulty} onChange={(e) => setDifficulty(e.target.value as GameState["difficulty"])}><option value="easy">Easy</option><option value="normal">Normal</option><option value="ruthless">Ruthless</option></select></label><button className="launch" onClick={startSolo}>PLAY SOLO!</button></div> : room ? <div className="lobby"><div className="room-code"><span>ROOM CODE</span><b>{room.code}</b><button onClick={() => navigator.clipboard.writeText(room.code)}>COPY</button></div><div className="lobby-list">{room.players.map((p) => <span key={p.id}><Avatar monster={p.monster} size="small"/><b>{p.name}</b>{p.id === 0 && <small>HOST</small>}</span>)}</div>{room.host ? <button className="launch" disabled={room.players.length < 2} onClick={startRoom}>{room.players.length < 2 ? "WAITING FOR A RIVAL…" : "START ONLINE MATCH!"}</button> : <p className="waiting-copy">The host will launch when everyone is ready.</p>}</div> : <div className="online-setup"><label>YOUR NAME<input value={name} maxLength={22} onChange={(e) => setName(e.target.value)}/></label><div><button className="launch" disabled={busy} onClick={createRoom}>CREATE ROOM</button><span>OR</span><input aria-label="Room code" placeholder="ROOM CODE" value={joinCode} maxLength={6} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}/><button className="join" disabled={busy || joinCode.length < 6} onClick={joinRoom}>JOIN</button></div>{roomError && <p className="error">{roomError}</p>}</div>}<small className="original-note">66 original power cards · 9 original kaiju · real-time rooms · Higgsfield sound design</small></section></div>}
    {rulesOpen && <div className="modal-backdrop"><section className="rules-modal"><button className="modal-close" onClick={() => setRulesOpen(false)}>CLOSE</button><span className="eyebrow">QUICK RULES</span><h2>HOW TO PLAY</h2><div className="rules-grid">{[["01","ROLL","Roll up to three times. Lock any dice you want between rolls."],["02","SCORE","Three matching numbers score that number; extras add 1 VP."],["03","POWER","Hearts heal outside Tokyo. Energy buys cards. POW deals damage."],["04","TOKYO","Enter for 1 VP, then gain 2 VP whenever your next turn starts there."],["05","YIELD","When hit in Tokyo, choose to stay or retreat. The attacker moves in."],["06","WIN","Reach 20 VP or be the last surviving monster."]].map(([n,h,p]) => <article key={n}><b>{n}</b><h3>{h}</h3><p>{p}</p></article>)}</div></section></div>}
    {game.phase === "yield" && game.pendingYield && canYield && <div className="modal-backdrop"><section className="decision-modal"><span className="eyebrow">TOKYO UNDER ATTACK</span><h2>DO YOU YIELD?</h2><p>You survived with {game.players[game.pendingYield.targetId].hp} health. Stay for the bonus or hand over the city.</p><div><button onClick={() => act({ type: "STAY_CITY" })}>STAY & FIGHT</button><button onClick={() => act({ type: "YIELD_CITY" })}>YIELD TOKYO</button></div></section></div>}
    {winner && <div className="modal-backdrop victory"><section className="victory-modal"><div className="confetti">✦ ★ ✦ ★ ✦</div><Avatar monster={winner.monster} size="large"/><span className="eyebrow">MATCH COMPLETE</span><h2>{winner.id === localId ? "YOU RULE TOKYO!" : `${winner.name} WINS!`}</h2><p>{winner.vp} VP · {winner.hp} HP remaining</p><button className="launch" onClick={() => setSetupOpen(true)}>PLAY AGAIN</button></section></div>}
  </main>;
}
