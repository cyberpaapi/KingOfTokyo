"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import cardData from "./cards.json";

type DieFace = "1" | "2" | "3" | "energy" | "smash" | "heart";
type Phase = "roll" | "resolve" | "shop" | "yield" | "over";
type Ability = "acidAttack" | "alienMetabolism" | "alphaMonster" | "armorPlating" | "backgroundDweller" | "burrowing" | "camouflage" | "completeDestruction" | "dedicatedNews" | "eaterOfDead" | "energyHoarder" | "evenBigger" | "extraHead" | "fireBreathing" | "freezeTime" | "friendOfChildren" | "giantBrain" | "gourmet" | "healingRay" | "herbivore" | "herdCuller" | "itHasAChild" | "jets" | "madeInLab" | "metamorph" | "mimic" | "batteryMonster" | "novaBreath" | "omnivore" | "opportunist" | "parasiticTentacles" | "plotTwist" | "poisonQuills" | "poisonSpit" | "psychicProbe" | "rapidHealing" | "regeneration" | "underdog" | "shrinkRay" | "smokeCloud" | "solarPowered" | "spikedTail" | "stretchy" | "telepath" | "urbavore" | "makingStronger" | "wings";
type Instant = { vp?: number; heal?: number; energy?: number; damageAll?: number; damageSelf?: number; loseVpAll?: number; drainEnergyAll?: boolean; takeTokyo?: boolean; extraTurn?: boolean };
type Player = { id: number; name: string; bot: boolean; hp: number; maxHp: number; vp: number; energy: number; eliminated: boolean; monster: number; cards: string[]; poison: number; shrink: number; battery: number; smoke: number; mimicCard: string | null; reborn: boolean };
type Card = { id: string; name: string; cost: number; type: "KEEP" | "DISCARD"; description: string; art: number; weight: number; ability?: Ability; instant?: Instant };
type GameState = { started: boolean; players: Player[]; currentId: number; cityId: number | null; dice: DieFace[]; held: boolean[]; rollsLeft: number; phase: Phase; market: string[]; deck: string[]; discard: string[]; log: string[]; turn: number; rollNonce: number; winnerId: number | null; pendingYield: { targetId: number; attackerId: number; damage: number; continueBot: boolean } | null; difficulty: "easy" | "normal" | "ruthless"; extraTurn: { playerId: number; diePenalty: number } | null };
type Member = { id: number; name: string; monster: number };
type Room = { code: string; token: string; playerId: number; host: boolean; revision: number; status: "lobby" | "active"; players: Member[] };
type RoomView = Omit<Room, "token"> & { gameState?: GameState | null };
type Action =
  | { type: "NEW_GAME"; playerCount: number; monster: number; difficulty: GameState["difficulty"] }
  | { type: "NEW_MULTI"; players: Member[] }
  | { type: "LOAD"; state: GameState }
  | { type: "ROLL" } | { type: "TOGGLE_HOLD"; index: number } | { type: "RESOLVE" }
  | { type: "YIELD_CITY" } | { type: "STAY_CITY" } | { type: "BUY"; cardId: string }
  | { type: "SWEEP_MARKET" } | { type: "END_TURN" } | { type: "BOT_ROLL"; dice: DieFace[] } | { type: "BOT_RESOLVE" }
  | { type: "USE_POWER"; cardId: string } | { type: "SELL_KEEP"; cardId: string } | { type: "SET_MIMIC"; cardId: string };

const MONSTERS = ["Pyroclast", "Voltwing", "Gravilla", "Tempest Coil", "Prism Claw", "Reactor Jack", "Mecha Mako", "Verdant Titan", "Moonseer"];
const BOT_NAMES = ["Rumble-9", "HEXAPE", "Neon Fang", "Moss Unit", "Star Talon"];
const FACES: DieFace[] = ["1", "2", "3", "energy", "smash", "heart"];
const CARDS = cardData as Card[];
const CARD_MAP = Object.fromEntries(CARDS.map((card) => [card.id, card])) as Record<string, Card>;
const initialState: GameState = { started: false, players: [], currentId: 0, cityId: null, dice: Array(6).fill("energy") as DieFace[], held: Array(6).fill(false), rollsLeft: 3, phase: "roll", market: [], deck: [], discard: [], log: [], turn: 1, rollNonce: 0, winnerId: null, pendingYield: null, difficulty: "normal", extraTurn: null };
const ROOM_API_ORIGIN = "https://kaiju-clash-neon-city.alphacodeai.chatgpt.site";
const ROOM_SESSION_KEY = "kaiju-clash-room-v2";
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
function hasAbility(player: Player, ability: Ability) { return player.cards.some((id) => CARD_MAP[id]?.ability === ability) || CARD_MAP[player.mimicCard ?? ""]?.ability === ability; }
function abilityCount(player: Player, ability: Ability) { return player.cards.filter((id) => CARD_MAP[id]?.ability === ability).length + (CARD_MAP[player.mimicCard ?? ""]?.ability === ability ? 1 : 0); }
function normalizeState(state: GameState): GameState {
  return { ...state, extraTurn: state.extraTurn ?? null, pendingYield: state.pendingYield ? { ...state.pendingYield, damage: state.pendingYield.damage ?? 0 } : null, players: state.players.map((p) => ({ ...p, maxHp: p.maxHp ?? 10, poison: p.poison ?? 0, shrink: p.shrink ?? 0, battery: p.battery ?? 0, smoke: p.smoke ?? 0, mimicCard: p.mimicCard ?? null, reborn: p.reborn ?? false })) };
}
function alive(players: Player[]) { return players.filter((player) => !player.eliminated); }
function checkWinner(players: Player[]) { const points = players.find((p) => !p.eliminated && p.vp >= 20); const living = alive(players); return points?.id ?? (living.length === 1 ? living[0].id : null); }
function price(player: Player, card: Card) { return Math.max(1, card.cost - (hasAbility(player, "alienMetabolism") ? 1 : 0)); }
function refillMarket(market: string[], deck: string[], discard: string[]) { const nextMarket = [...market]; let nextDeck = [...deck], nextDiscard = [...discard]; while (nextMarket.length < 3) { if (!nextDeck.length) { nextDeck = shuffle(nextDiscard); nextDiscard = []; } const card = nextDeck.shift(); if (!card) break; nextMarket.push(card); } return { market: nextMarket, deck: nextDeck, discard: nextDiscard }; }
function damagePlayer(players: Player[], id: number, amount: number, defend = true) {
  const target = players.find((p) => p.id === id); if (!target || target.eliminated || amount <= 0) return players;
  let damage = amount, energy = target.energy;
  if (defend && hasAbility(target, "wings") && energy >= 2) { energy -= 2; damage = 0; }
  if (damage === 1 && hasAbility(target, "armorPlating")) damage = 0;
  if (damage > 0 && hasAbility(target, "camouflage")) damage -= Array.from({ length: damage }, randomFace).filter((face) => face === "heart").length;
  damage = Math.max(0, damage); let wasEliminated = false;
  let next = players.map((p) => { if (p.id !== id) return p; const hp = Math.max(0, p.hp - damage); const strongerEnergy = damage >= 2 && hasAbility(p, "makingStronger") ? 1 : 0; if (hp === 0 && hasAbility(p, "itHasAChild") && !p.reborn) return { ...p, hp: 10, maxHp: 10, vp: 0, energy: 0, cards: [], poison: 0, shrink: 0, battery: 0, smoke: 0, mimicCard: null, reborn: true, eliminated: false }; wasEliminated = hp === 0 && !p.eliminated; return { ...p, hp, energy: energy + strongerEnergy, eliminated: hp === 0 }; });
  if (wasEliminated) next = next.map((p) => !p.eliminated && hasAbility(p, "eaterOfDead") ? { ...p, vp: p.vp + 3 } : p);
  return next;
}
function applyCard(players: Player[], buyerId: number, card: Card, cityId: number | null) {
  const buyerBefore = players.find((p) => p.id === buyerId)!;
  let next = players.map((p) => p.id === buyerId ? { ...p, energy: p.energy - price(buyerBefore, card), cards: card.type === "KEEP" ? [...p.cards, card.id] : p.cards } : p);
  if (card.ability === "evenBigger") next = next.map((p) => p.id === buyerId ? { ...p, maxHp: 12, hp: Math.min(12, p.hp + 2) } : p);
  if (card.ability === "batteryMonster") next = next.map((p) => p.id === buyerId ? { ...p, battery: 6 } : p);
  if (card.ability === "smokeCloud") next = next.map((p) => p.id === buyerId ? { ...p, smoke: 3 } : p);
  if (hasAbility(next.find((p) => p.id === buyerId)!, "dedicatedNews")) next = next.map((p) => p.id === buyerId ? { ...p, vp: p.vp + 1 } : p);
  const instant = card.instant;
  if (!instant) return { players: next, cityId, extraTurn: null as GameState["extraTurn"] };
  next = next.map((p) => p.id === buyerId ? { ...p, vp: p.vp + (instant.vp ?? 0), hp: Math.min(p.maxHp, p.hp + (instant.heal ?? 0)), energy: p.energy + (instant.energy ?? 0) + ((instant.energy ?? 0) > 0 && hasAbility(p, "friendOfChildren") ? 1 : 0) } : p);
  if (instant.loseVpAll) next = next.map((p) => p.id === buyerId ? p : { ...p, vp: Math.max(0, p.vp - instant.loseVpAll!) });
  if (instant.drainEnergyAll) next = next.map((p) => p.id === buyerId ? p : { ...p, energy: p.energy - Math.floor(p.energy / 2) });
  if (instant.damageAll) next.filter((p) => p.id !== buyerId && !p.eliminated).forEach((p) => { next = damagePlayer(next, p.id, instant.damageAll!); });
  if (instant.damageSelf) next = damagePlayer(next, buyerId, instant.damageSelf, false);
  return { players: next, cityId: instant.takeTokyo ? buyerId : cityId, extraTurn: instant.extraTurn ? { playerId: buyerId, diePenalty: 0 } : null };
}
function makeGame(players: Player[], difficulty: GameState["difficulty"]): GameState { const deck = shuffle(CARDS.map((c) => c.id)); return { ...initialState, started: true, players, deck: deck.slice(3), market: deck.slice(0, 3), difficulty, log: [`${players[0].name} takes the first turn.`, "Reach 20 VP or become the last monster standing."] }; }
function startNextTurn(state: GameState): GameState {
  const outgoing = state.players[state.currentId]; const fewestVp = Math.min(...alive(state.players).map((p) => p.vp));
  let players = state.players.map((p) => p.id === outgoing.id ? { ...p, vp: p.vp + (hasAbility(p, "energyHoarder") ? Math.floor(p.energy / 6) : 0) + (hasAbility(p, "underdog") && p.vp === fewestVp ? 1 : 0), energy: p.energy === 0 && hasAbility(p, "solarPowered") ? 1 + (hasAbility(p, "friendOfChildren") ? 1 : 0) : p.energy } : p);
  const poisoned = players.find((p) => p.id === outgoing.id); if (poisoned?.poison) players = damagePlayer(players, outgoing.id, poisoned.poison, false);
  const living = alive(players); if (living.length <= 1) return { ...state, players, phase: "over", winnerId: living[0]?.id ?? null };
  let nextId = state.extraTurn?.playerId ?? state.currentId; if (!state.extraTurn) do nextId = (nextId + 1) % players.length; while (players[nextId].eliminated);
  const penalty = state.extraTurn?.diePenalty ?? 0;
  players = players.map((p) => { if (p.id !== nextId) return p; const batteryTake = Math.min(2, p.battery); const battery = p.battery - batteryTake; const cards = battery === 0 && p.battery > 0 ? p.cards.filter((id) => CARD_MAP[id]?.ability !== "batteryMonster") : p.cards; return { ...p, cards, battery, energy: p.energy + batteryTake, vp: p.vp + (state.cityId === nextId ? 2 + (hasAbility(p, "urbavore") ? 1 : 0) : 0) }; });
  const winnerId = checkWinner(players); if (winnerId !== null) return { ...state, players, currentId: nextId, winnerId, phase: "over" };
  const count = Math.max(1, 6 + abilityCount(players[nextId], "extraHead") - players[nextId].shrink - penalty);
  return { ...state, players, currentId: nextId, dice: Array(count).fill("energy") as DieFace[], held: Array(count).fill(false), rollsLeft: 3 + (hasAbility(players[nextId], "giantBrain") ? 1 : 0), phase: "roll", pendingYield: null, extraTurn: null, turn: state.turn + 1, log: [`Turn ${state.turn + 1}: ${players[nextId].name}.`, ...state.log].slice(0, 18) };
}
function botShouldYield(state: GameState, target: Player, damage: number) { return state.difficulty === "easy" ? target.hp <= 7 || damage >= 3 : state.difficulty === "ruthless" ? target.hp <= 3 : target.hp <= 5 || damage >= 4; }
function resolveDice(state: GameState, continueBot: boolean): GameState {
  const current = state.players[state.currentId]; const counts = state.dice.reduce<Record<string, number>>((a, f) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {}); let players = state.players.map((p) => ({ ...p })); let cityId = state.cityId; const notes: string[] = [];
  let score = 0; ["1", "2", "3"].forEach((f) => { const n = counts[f] ?? 0; if (n >= 3) score += Number(f) + n - 3; });
  if ((counts["1"] ?? 0) >= 3 && hasAbility(current, "gourmet")) score += 2;
  if ((counts["1"] ?? 0) && (counts["2"] ?? 0) && (counts["3"] ?? 0) && hasAbility(current, "omnivore")) score += 2;
  if (FACES.every((face) => (counts[face] ?? 0) > 0) && hasAbility(current, "completeDestruction")) score += 9;
  const energy = counts.energy ?? 0, hearts = counts.heart ?? 0, smash = counts.smash ?? 0, inCity = cityId === current.id;
  let shrink = current.shrink, poison = current.poison, usableHearts = inCity ? 0 : hearts;
  if (!inCity) { const shrinkRemoved = Math.min(shrink, usableHearts); shrink -= shrinkRemoved; usableHearts -= shrinkRemoved; const poisonRemoved = Math.min(poison, usableHearts); poison -= poisonRemoved; usableHearts -= poisonRemoved; }
  const heal = usableHearts + (usableHearts > 0 && hasAbility(current, "regeneration") ? 1 : 0);
  players = players.map((p) => p.id === current.id ? { ...p, shrink, poison, vp: p.vp + score, energy: p.energy + energy + (energy > 0 && hasAbility(p, "friendOfChildren") ? 1 : 0), hp: Math.min(p.maxHp, p.hp + heal) } : p);
  if (score) notes.push(`${score} VP`); if (energy) notes.push(`${energy + (hasAbility(current, "friendOfChildren") ? 1 : 0)} energy`); if (heal) notes.push(`${heal} health`); if (hearts && inCity) notes.push("Tokyo blocked healing");
  let pendingYield: GameState["pendingYield"] = null; let dealtDamage = false;
  const attack = smash + (hasAbility(current, "acidAttack") ? 1 : 0) + (inCity && hasAbility(current, "burrowing") ? 1 : 0) + (smash > 0 && hasAbility(current, "spikedTail") ? 1 : 0) + (inCity && smash > 0 && hasAbility(current, "urbavore") ? 1 : 0);
  if (attack > 0) {
    const targets = hasAbility(current, "novaBreath") ? players.filter((p) => p.id !== current.id && !p.eliminated).map((p) => p.id) : inCity ? players.filter((p) => p.id !== current.id && !p.eliminated).map((p) => p.id) : cityId !== null ? [cityId] : [];
    const before = Object.fromEntries(players.map((p) => [p.id, p.hp])); targets.forEach((id) => { players = damagePlayer(players, id, attack); });
    const damagedTargets = targets.filter((id) => (players.find((p) => p.id === id)?.hp ?? 0) < before[id]); dealtDamage = damagedTargets.length > 0;
    if (damagedTargets.length && hasAbility(current, "poisonSpit")) players = players.map((p) => damagedTargets.includes(p.id) ? { ...p, poison: p.poison + 1 } : p);
    if (damagedTargets.length && hasAbility(current, "shrinkRay")) players = players.map((p) => damagedTargets.includes(p.id) ? { ...p, shrink: p.shrink + 1 } : p);
    if (dealtDamage && hasAbility(current, "alphaMonster")) players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p);
    if (dealtDamage && hasAbility(current, "fireBreathing") && players.length > 2) { const left = (current.id - 1 + players.length) % players.length, right = (current.id + 1) % players.length; [...new Set([left, right])].filter((id) => id !== current.id).forEach((id) => { players = damagePlayer(players, id, 1); }); }
    if (targets.length) notes.push(`${attack} attack`);
    if (!inCity && cityId !== null && !players[cityId].eliminated && damagedTargets.includes(cityId)) { const target = players[cityId]; const damage = before[cityId] - target.hp; if (!target.bot) pendingYield = { targetId: target.id, attackerId: current.id, damage, continueBot }; else if (botShouldYield(state, target, damage)) { if (hasAbility(target, "jets")) players = players.map((p) => p.id === target.id ? { ...p, hp: Math.min(p.maxHp, p.hp + damage) } : p); if (hasAbility(target, "burrowing")) players = damagePlayer(players, current.id, 1); cityId = current.id; players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p); notes.push(`${target.name} yielded`); } }
  }
  if ((counts["2"] ?? 0) >= 3 && hasAbility(current, "poisonQuills")) { players.filter((p) => p.id !== current.id && !p.eliminated).forEach((p) => { const before = players.find((x) => x.id === p.id)!.hp; players = damagePlayer(players, p.id, 2); if (players.find((x) => x.id === p.id)!.hp < before) dealtDamage = true; }); notes.push("Poison Quills struck"); }
  if (!dealtDamage && hasAbility(current, "herbivore")) { players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p); notes.push("Herbivore +1 VP"); }
  const extraTurn = (counts["1"] ?? 0) >= 3 && hasAbility(current, "freezeTime") ? { playerId: current.id, diePenalty: 1 } : state.extraTurn;
  if (cityId !== null && players[cityId].eliminated) cityId = null;
  if (cityId === null && !players[current.id].eliminated) { cityId = current.id; players = players.map((p) => p.id === current.id ? { ...p, vp: p.vp + 1 } : p); notes.push("entered the city +1 VP"); }
  const winnerId = checkWinner(players); const log = [`${current.name}: ${notes.length ? notes.join(" • ") : "no effect"}.`, ...state.log].slice(0, 18);
  return winnerId !== null ? { ...state, players, cityId, winnerId, phase: "over", log } : { ...state, players, cityId, pendingYield, extraTurn, phase: pendingYield ? "yield" : "shop", log };
}
function botShop(state: GameState) { const bot = state.players[state.currentId]; const choice = state.market.map((id) => CARD_MAP[id]).filter((c) => price(bot, c) <= bot.energy).sort((a, b) => b.weight - a.weight)[0]; if (!choice) return state; const applied = applyCard(state.players, bot.id, choice, state.cityId); const refill = refillMarket(state.market.filter((id) => id !== choice.id), state.deck, choice.type === "DISCARD" ? [...state.discard, choice.id] : state.discard); const winnerId = checkWinner(applied.players); return { ...state, players: applied.players, cityId: applied.cityId, extraTurn: applied.extraTurn ?? state.extraTurn, ...refill, winnerId, phase: winnerId !== null ? "over" as Phase : state.phase, log: [`${bot.name} bought ${choice.name}.`, ...state.log].slice(0, 18) }; }
function gameReducer(state: GameState, action: Action): GameState {
  if (action.type === "LOAD") return normalizeState(action.state);
  if (action.type === "NEW_MULTI") return makeGame(action.players.map((p) => ({ ...p, bot: false, hp: 10, maxHp: 10, vp: 0, energy: 0, eliminated: false, cards: [], poison: 0, shrink: 0, battery: 0, smoke: 0, mimicCard: null, reborn: false })), "normal");
  if (action.type === "NEW_GAME") { const roster = shuffle(MONSTERS.map((_, i) => i).filter((i) => i !== action.monster)); return makeGame(Array.from({ length: action.playerCount }, (_, i) => ({ id: i, name: i ? BOT_NAMES[i - 1] : MONSTERS[action.monster], bot: i > 0, hp: 10, maxHp: 10, vp: 0, energy: 0, eliminated: false, monster: i ? roster[i - 1] : action.monster, cards: [], poison: 0, shrink: 0, battery: 0, smoke: 0, mimicCard: null, reborn: false })), action.difficulty); }
  if (!state.started || state.phase === "over") return state; const current = state.players[state.currentId];
  if (action.type === "ROLL" && !current.bot && ["roll", "resolve"].includes(state.phase) && state.rollsLeft > 0) { const rolled: GameState = { ...state, dice: state.dice.map((f, i) => state.held[i] ? f : randomFace()), rollsLeft: state.rollsLeft - 1, phase: "resolve", rollNonce: state.rollNonce + 1 }; const canBuyReroll = (hasAbility(current, "telepath") && current.energy >= 1) || (hasAbility(current, "smokeCloud") && current.smoke > 0); return rolled.rollsLeft === 0 && !canBuyReroll ? resolveDice(rolled, false) : rolled; }
  if (action.type === "TOGGLE_HOLD" && !current.bot && state.phase === "resolve") return { ...state, held: state.held.map((v, i) => i === action.index ? !v : v) };
  if (action.type === "RESOLVE" && !current.bot && state.phase === "resolve") return resolveDice(state, false);
  if ((action.type === "YIELD_CITY" || action.type === "STAY_CITY") && state.phase === "yield" && state.pendingYield) { const pending = state.pendingYield; let players = state.players; let cityId = state.cityId; if (action.type === "YIELD_CITY") { const target = players[pending.targetId]; if (hasAbility(target, "jets")) players = players.map((p) => p.id === target.id ? { ...p, hp: Math.min(p.maxHp, p.hp + pending.damage) } : p); if (hasAbility(target, "burrowing")) players = damagePlayer(players, pending.attackerId, 1); players = players.map((p) => p.id === pending.attackerId ? { ...p, vp: p.vp + 1 } : p); cityId = pending.attackerId; } let next: GameState = { ...state, players, cityId, pendingYield: null, phase: "shop", log: [action.type === "YIELD_CITY" ? "The city changed claws." : "The ruler stood firm.", ...state.log].slice(0, 18) }; if (pending.continueBot) next = startNextTurn(botShop(next)); return next; }
  if (action.type === "BUY" && !current.bot && state.phase === "shop") { const card = CARD_MAP[action.cardId]; const fromMarket = state.market.includes(action.cardId), fromLab = hasAbility(current, "madeInLab") && state.deck[0] === action.cardId; if (!card || (!fromMarket && !fromLab) || current.energy < price(current, card)) return state; const applied = applyCard(state.players, current.id, card, state.cityId); const refill = fromMarket ? refillMarket(state.market.filter((id) => id !== card.id), state.deck, card.type === "DISCARD" ? [...state.discard, card.id] : state.discard) : { market: state.market, deck: state.deck.slice(1), discard: card.type === "DISCARD" ? [...state.discard, card.id] : state.discard }; const winnerId = checkWinner(applied.players); return { ...state, players: applied.players, cityId: applied.cityId, extraTurn: applied.extraTurn ?? state.extraTurn, ...refill, winnerId, phase: winnerId !== null ? "over" : "shop", log: [`${current.name} bought ${card.name}.`, ...state.log].slice(0, 18) }; }
  if (action.type === "USE_POWER" && current.id === state.currentId && current.cards.includes(action.cardId)) {
    const card = CARD_MAP[action.cardId];
    if (card.ability === "rapidHealing" && current.energy >= 2 && current.hp < current.maxHp) return { ...state, players: state.players.map((p) => p.id === current.id ? { ...p, energy: p.energy - 2, hp: Math.min(p.maxHp, p.hp + 1 + (hasAbility(p, "regeneration") ? 1 : 0)) } : p) };
    if (card.ability === "telepath" && state.phase === "resolve" && current.energy >= 1) return { ...state, rollsLeft: state.rollsLeft + 1, players: state.players.map((p) => p.id === current.id ? { ...p, energy: p.energy - 1 } : p) };
    if (card.ability === "smokeCloud" && state.phase === "resolve" && current.smoke > 0) { const smoke = current.smoke - 1; return { ...state, rollsLeft: state.rollsLeft + 1, players: state.players.map((p) => p.id === current.id ? { ...p, smoke, cards: smoke ? p.cards : p.cards.filter((id) => id !== action.cardId) } : p), discard: smoke ? state.discard : [...state.discard, action.cardId] }; }
  }
  if (action.type === "SELL_KEEP" && state.phase === "shop" && current.cards.includes(action.cardId) && hasAbility(current, "metamorph")) { const sold = CARD_MAP[action.cardId]; if (!sold || sold.type !== "KEEP") return state; return { ...state, players: state.players.map((p) => p.id === current.id ? { ...p, cards: p.cards.filter((id) => id !== action.cardId), energy: p.energy + sold.cost, maxHp: sold.ability === "evenBigger" ? 10 : p.maxHp, hp: sold.ability === "evenBigger" ? Math.min(10, p.hp) : p.hp, smoke: sold.ability === "smokeCloud" ? 0 : p.smoke, mimicCard: sold.ability === "mimic" ? null : p.mimicCard } : p), discard: [...state.discard, action.cardId] }; }
  if (action.type === "SET_MIMIC" && state.phase === "shop" && hasAbility(current, "mimic") && (!current.mimicCard || current.energy >= 1) && CARD_MAP[action.cardId]?.type === "KEEP" && CARD_MAP[action.cardId]?.ability !== "mimic" && state.players.some((p) => p.id !== current.id && p.cards.includes(action.cardId))) return { ...state, players: state.players.map((p) => p.id === current.id ? { ...p, energy: p.energy - (p.mimicCard ? 1 : 0), mimicCard: action.cardId } : p), log: [`${current.name}'s Mimic copied ${CARD_MAP[action.cardId].name}.`, ...state.log].slice(0, 18) };
  if (action.type === "SWEEP_MARKET" && !current.bot && state.phase === "shop" && current.energy >= 2) { const players = state.players.map((p) => p.id === current.id ? { ...p, energy: p.energy - 2 } : p); return { ...state, players, ...refillMarket([], state.deck, [...state.discard, ...state.market]), log: [`${current.name} refreshed the market.`, ...state.log].slice(0, 18) }; }
  if (action.type === "END_TURN" && !current.bot && state.phase === "shop") return startNextTurn(state);
  if (action.type === "BOT_ROLL" && current.bot && state.phase === "roll") return { ...state, dice: action.dice, rollsLeft: 0, phase: "resolve", held: action.dice.map(() => true), rollNonce: state.rollNonce + 1 };
  if (action.type === "BOT_RESOLVE" && current.bot && state.phase === "resolve") { const resolved = resolveDice(state, true); return resolved.phase === "over" || resolved.phase === "yield" ? resolved : startNextTurn(botShop(resolved)); }
  return state;
}
function chooseBotDice(state: GameState, player: Player) { const count = Math.max(1, 6 + abilityCount(player, "extraHead") - player.shrink); let dice = Array.from({ length: count }, randomFace); for (let n = 0; n < 2 + (hasAbility(player, "giantBrain") ? 1 : 0); n++) dice = dice.map((f) => f === "smash" || f === "energy" || (f === "heart" && player.hp < 6 && state.cityId !== player.id) ? f : randomFace()); return dice; }
function monsterStyle(i: number) { return { backgroundPosition: `${(i % 3) * 50}% ${Math.floor(i / 3) * 50}%` }; }
function artStyle(i: number) { return { backgroundPosition: `${(i % 2) * 100}% ${Math.floor(i / 2) * 100}%` }; }
function Avatar({ monster, size = "normal" }: { monster: number; size?: "small" | "normal" | "large" }) { return <span className={`avatar avatar-${size}`} style={monsterStyle(monster)} aria-hidden />; }
const faceLabel = (face: DieFace) => face === "energy" ? "⚡" : face === "smash" ? "POW" : face === "heart" ? "♥" : face;

export default function Home() {
  const [game, rawDispatch] = useReducer(gameReducer, initialState);
  const [playerCount, setPlayerCount] = useState(4), [monster, setMonster] = useState(0); const [difficulty, setDifficulty] = useState<GameState["difficulty"]>("normal");
  const [setupOpen, setSetupOpen] = useState(true), [rulesOpen, setRulesOpen] = useState(false), [soundOn, setSoundOn] = useState(true), [mode, setMode] = useState<"solo" | "multi">("solo");
  const [name, setName] = useState("Player One"), [joinCode, setJoinCode] = useState(""), [room, setRoom] = useState<Room | null>(null), [roomError, setRoomError] = useState(""), [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<"online" | "reconnecting">("online");
  const revisionRef = useRef(0), gameRef = useRef(game), mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const roomCode = room?.code, roomToken = room?.token;
  const current = game.players[game.currentId], cityPlayer = game.cityId === null ? null : game.players[game.cityId], winner = game.winnerId === null ? null : game.players[game.winnerId];
  const localId = room?.playerId ?? 0; const canAct = !!current && !current.bot && (!room || current.id === localId); const canYield = !!game.pendingYield && (!room || game.pendingYield.targetId === localId);
  const play = useCallback((sound: "dice-roll" | "smash-impact" | "energy-zap" | "heal-pulse" | "victory-roar") => { if (!soundOn) return; const audio = new Audio(assetPath(`/sounds/${sound}.mp3`)); audio.volume = .55; void audio.play().catch(() => {}); }, [soundOn]);
  const applyRoomView = useCallback((data: RoomView, token: string) => {
    revisionRef.current = data.revision;
    const nextRoom: Room = { code: data.code, token, playerId: data.playerId, host: data.host, revision: data.revision, status: data.status, players: data.players };
    setRoom(nextRoom); setMode("multi"); setConnection("online");
    const self = data.players.find((p) => p.id === data.playerId); if (self) { setName(self.name); setMonster(self.monster); }
    if (data.gameState) { const next = normalizeState(data.gameState); gameRef.current = next; rawDispatch({ type: "LOAD", state: next }); setSetupOpen(false); }
  }, []);
  const fetchLatest = useCallback(async (activeRoom: Room) => {
    const response = await fetch(apiPath(`/api/rooms/${activeRoom.code}?token=${encodeURIComponent(activeRoom.token)}`), { cache: "no-store" });
    if (!response.ok) throw new Error("Room session expired");
    const data = await response.json() as RoomView; applyRoomView(data, activeRoom.token);
  }, [applyRoomView]);
  const sync = useCallback(async (next: GameState) => {
    if (!room) return; setConnection("reconnecting");
    const response = await fetch(apiPath(`/api/rooms/${room.code}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: room.token, action: "sync", state: next, revision: revisionRef.current }) });
    if (response.ok) { const data = await response.json(); revisionRef.current = data.revision; setRoom((r) => r ? { ...r, revision: data.revision } : r); setConnection("online"); return; }
    await fetchLatest(room);
  }, [room, fetchLatest]);
  const act = useCallback((action: Action) => {
    const next = gameReducer(gameRef.current, action); if (next === gameRef.current) return;
    gameRef.current = next; rawDispatch({ type: "LOAD", state: next });
    if (room) mutationQueueRef.current = mutationQueueRef.current.then(() => sync(next)).catch(() => { setConnection("reconnecting"); });
  }, [room, sync]);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    const restore = async () => {
      const invite = new URLSearchParams(location.search).get("room")?.toUpperCase(); if (invite) { setMode("multi"); setJoinCode(invite); }
      const saved = localStorage.getItem(ROOM_SESSION_KEY); if (!saved) return;
      try {
        const session = JSON.parse(saved) as Pick<Room, "code" | "token" | "playerId" | "host">;
        if (invite && invite !== session.code) return;
        setBusy(true);
        const response = await fetch(apiPath(`/api/rooms/${session.code}?token=${encodeURIComponent(session.token)}`), { cache: "no-store" });
        if (!response.ok) throw new Error("Saved room expired");
        applyRoomView(await response.json() as RoomView, session.token);
      } catch { localStorage.removeItem(ROOM_SESSION_KEY); }
      finally { setBusy(false); }
    };
    void restore();
  }, [applyRoomView]);
  useEffect(() => { if (room) localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify({ code: room.code, token: room.token, playerId: room.playerId, host: room.host })); }, [room]);
  useEffect(() => { if (!game.started || room || game.phase === "over" || !current?.bot || game.phase !== "roll") return; const timer = window.setTimeout(() => rawDispatch({ type: "BOT_ROLL", dice: chooseBotDice(game, current) }), 650); return () => clearTimeout(timer); }, [game, current, room]);
  useEffect(() => { if (!game.started || room || !current?.bot || game.phase !== "resolve") return; const timer = window.setTimeout(() => rawDispatch({ type: "BOT_RESOLVE" }), 300); return () => clearTimeout(timer); }, [game.started, game.phase, game.currentId, current, room]);
  useEffect(() => {
    if (!roomCode || !roomToken) return; let cancelled = false;
    const watch = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(apiPath(`/api/rooms/${roomCode}?token=${encodeURIComponent(roomToken)}&since=${revisionRef.current}&wait=15000`), { cache: "no-store" });
          if (!response.ok) throw new Error("Room unavailable");
          const data = await response.json() as RoomView;
          if (data.revision > revisionRef.current) applyRoomView(data, roomToken);
          else { setRoom((r) => r ? { ...r, players: data.players, status: data.status } : r); setConnection("online"); }
        } catch { if (!cancelled) { setConnection("reconnecting"); await new Promise((resolve) => setTimeout(resolve, 700)); } }
      }
    };
    void watch(); return () => { cancelled = true; };
  }, [roomCode, roomToken, applyRoomView]);
  useEffect(() => { if (game.phase === "over" && winner) play("victory-roar"); }, [game.phase, winner, play]);

  const scorePreview = useMemo(() => { if (!game.started || game.phase === "roll") return "Roll, then tap dice to lock them."; const c = game.dice.reduce<Record<string, number>>((a, f) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {}); return `${c.smash ?? 0} POW · ${c.heart ?? 0} HEAL · ${c.energy ?? 0} ENERGY`; }, [game]);
  const startSolo = () => { localStorage.removeItem(ROOM_SESSION_KEY); setRoom(null); const next = gameReducer(initialState, { type: "NEW_GAME", playerCount, monster, difficulty }); gameRef.current = next; rawDispatch({ type: "LOAD", state: next }); setSetupOpen(false); };
  const createRoom = async () => { setBusy(true); setRoomError(""); try { const response = await fetch(apiPath("/api/rooms"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, monster }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); revisionRef.current = 0; setRoom({ ...data, revision: 0, status: "lobby", players: [{ id: 0, name, monster }] }); setConnection("online"); } catch (e) { setRoomError(e instanceof Error ? e.message : "Could not create room"); } finally { setBusy(false); } };
  const joinRoom = async () => { setBusy(true); setRoomError(""); try { const code = joinCode.trim().toUpperCase(); const response = await fetch(apiPath(`/api/rooms/${code}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, monster }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); applyRoomView(data as RoomView, data.token); setConnection("online"); } catch (e) { setRoomError(e instanceof Error ? e.message : "Could not join room"); } finally { setBusy(false); } };
  const startRoom = async () => { if (!room || room.players.length < 2) return; const next = gameReducer(initialState, { type: "NEW_MULTI", players: room.players }); const response = await fetch(apiPath(`/api/rooms/${room.code}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: room.token, action: "start", state: next, revision: revisionRef.current }) }); if (response.ok) { const data = await response.json(); revisionRef.current = data.revision; gameRef.current = next; rawDispatch({ type: "LOAD", state: next }); setRoom({ ...room, revision: data.revision, status: "active" }); setSetupOpen(false); } else { setRoomError("The lobby changed. Try starting again."); await fetchLatest(room); } };
  const roll = () => { play("dice-roll"); act({ type: "ROLL" }); };
  const resolve = () => { const dice = game.dice; if (dice.includes("smash")) play("smash-impact"); else if (dice.includes("energy")) play("energy-zap"); else if (dice.includes("heart")) play("heal-pulse"); act({ type: "RESOLVE" }); };
  const localPlayer = game.players[localId];
  const labCardId = current && canAct && game.phase === "shop" && hasAbility(current, "madeInLab") ? game.deck[0] : undefined;
  const marketCardIds = labCardId ? [...game.market, labCardId] : game.market;
  const mimicOptions = game.players.flatMap((p) => p.id === localId ? [] : p.cards.map((id) => ({ id, owner: p.name, card: CARD_MAP[id] }))).filter((option) => option.card?.type === "KEEP" && option.card.ability !== "mimic");

  return <main className={`game-shell ${game.rollNonce ? "has-action" : ""}`}>
    <header className="topbar"><button className="brand" onClick={() => setSetupOpen(true)}><span>MONSTER-DICE MAYHEM</span><b>KAIJU CLASH</b></button><div className="turn-chip"><i />{game.started ? `TURN ${game.turn} · ${current?.name}` : "READY TO RUMBLE"}</div><nav><button onClick={() => setSoundOn(!soundOn)}>{soundOn ? "🔊 SOUND" : "🔇 MUTED"}</button><button onClick={() => setRulesOpen(true)}>RULES</button><button className="hot" onClick={() => setSetupOpen(true)}>NEW GAME</button></nav></header>
    {room && <div className="room-ribbon"><b>ROOM {room.code}</b><span className={`connection ${connection}`}>{connection === "online" ? "● LIVE" : "● RECONNECTING"} · {room.status === "active" ? `${room.players.length} MONSTERS` : "LOBBY OPEN"}</span><button onClick={() => navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room.code}`)}>COPY INVITE</button></div>}
    {game.started && <section className="player-rail">{game.players.map((p) => <article key={p.id} className={`${p.id === game.currentId ? "current" : ""} ${p.id === game.cityId ? "ruler" : ""} ${p.eliminated ? "out" : ""}`}><Avatar monster={p.monster} size="small"/><div><b>{p.name}</b><small>{room ? (p.id === localId ? "YOU" : "ONLINE") : p.bot ? "CPU" : "YOU"}{p.id === game.cityId ? " · TOKYO" : ""}</small>{(p.poison > 0 || p.shrink > 0 || p.smoke > 0) && <span className="token-strip">{p.poison > 0 && <i className="token poison">POISON ×{p.poison}</i>}{p.shrink > 0 && <i className="token shrink">SHRINK ×{p.shrink}</i>}{p.smoke > 0 && <i className="token smoke">SMOKE ×{p.smoke}</i>}</span>}</div><strong className="hp">♥ {p.hp}/{p.maxHp}</strong><strong className="vp">★ {p.vp}</strong><strong className="en">⚡ {p.energy}</strong></article>)}</section>}
    <section className="table-grid">
      <article className="panel city-panel"><header><div><span className="eyebrow">BATTLE ZONE</span><h2>TOKYO BAY</h2></div><b className={cityPlayer ? "occupied" : ""}>{cityPlayer ? "OCCUPIED" : "OPEN"}</b></header><div className="city-stage"><div className="sun"/><div className="roads"/><div className="tower t1"/><div className="tower t2"/><div className="tower t3"/><div className="park">TOKYO<br/>PARK</div><div className="arena">TOKYO</div>{cityPlayer ? <div className="city-monster"><Avatar monster={cityPlayer.monster} size="large"/><strong>{cityPlayer.name}</strong><small>+2 VP NEXT TURN</small></div> : <div className="city-empty"><b>THE CITY IS OPEN!</b><span>Resolve a turn to stomp in for +1 VP</span></div>}</div><footer><b>INSIDE attacks everyone.</b><span>Outside attacks the ruler.</span></footer></article>
      <article className="panel dice-panel"><header><div><span className="eyebrow">ACTION CONSOLE</span><h2>{room && !canAct ? "WATCH THE ACTION" : current?.bot ? "CPU ROLL" : "YOUR ROLL"}</h2></div><b>{game.rollsLeft} ROLLS LEFT</b></header><div className="dice-tray">{game.dice.map((face, i) => <button key={`${i}-${game.rollNonce}`} className={`die face-${face} ${game.held[i] ? "held" : ""}`} onClick={() => act({ type: "TOGGLE_HOLD", index: i })} disabled={!canAct || game.phase !== "resolve"}><span>{faceLabel(face)}</span>{game.held[i] && <small>LOCKED</small>}</button>)}</div><div className="score-strip"><span>{scorePreview}</span><b>3× NUMBER = SCORE</b></div><div className="primary-actions"><button className="roll" onClick={roll} disabled={!game.started || !canAct || !["roll", "resolve"].includes(game.phase) || game.rollsLeft <= 0}>{game.phase === "roll" ? "ROLL THE DICE!" : `REROLL · ${game.rollsLeft}`}</button><button className="resolve" onClick={resolve} disabled={!game.started || !canAct || game.phase !== "resolve"}>SCORE & SMASH</button></div>{game.phase === "shop" && canAct && <div className="end-dock"><span>Power up, then pass the action.</span><button onClick={() => act({ type: "END_TURN" })}>END TURN →</button></div>}{game.started && !canAct && <div className="waiting"><i/>Waiting for {current?.name}…</div>}</article>
      <aside className="panel market-panel"><header><div><span className="eyebrow">66-CARD DECK</span><h2>POWER MARKET</h2></div><button onClick={() => act({ type: "SWEEP_MARKET" })} disabled={!canAct || game.phase !== "shop" || (current?.energy ?? 0) < 2}>REFRESH · 2⚡</button></header><div className="market-list">{marketCardIds.map((id) => { const card = CARD_MAP[id]; const cost = current ? price(current, card) : card.cost; const buy = canAct && game.phase === "shop" && (current?.energy ?? 0) >= cost; const fromLab = id === labCardId; return <article className={`market-card ${fromLab ? "lab-card" : ""}`} key={id}><div className="card-art" style={artStyle(card.art)}><span>{fromLab ? "LAB TOP CARD" : card.type}</span></div><div className="card-copy"><header><h3>{card.name}</h3><b>{cost}⚡</b></header><p>{card.description}</p><button onClick={() => { play("energy-zap"); act({ type: "BUY", cardId: id }); }} disabled={!buy}>{fromLab ? "BUY FROM LAB" : "BUY POWER"}</button></div></article>; })}{!game.started && <div className="market-empty">Launch a match to reveal three wild powers.</div>}</div></aside>
    </section>
    <section className="lower-grid"><article className="panel log-panel"><span className="eyebrow">LIVE FEED</span><h2>BATTLE LOG</h2><ol>{game.log.slice(0, 5).map((entry, i) => <li key={`${entry}-${i}`}><b>{String(game.turn - i).padStart(2, "0")}</b><span>{entry}</span></li>)}</ol></article><article className="panel loadout-panel"><span className="eyebrow">BIO-MODS</span><h2>YOUR LOADOUT</h2>
      {localPlayer && (localPlayer.poison > 0 || localPlayer.shrink > 0 || localPlayer.smoke > 0 || localPlayer.mimicCard) && <div className="token-bank">{localPlayer.poison > 0 && <b className="token poison">POISON ×{localPlayer.poison}</b>}{localPlayer.shrink > 0 && <b className="token shrink">SHRINK ×{localPlayer.shrink}</b>}{localPlayer.smoke > 0 && <b className="token smoke">SMOKE ×{localPlayer.smoke}</b>}{localPlayer.mimicCard && <b className="token mimic">MIMIC: {CARD_MAP[localPlayer.mimicCard]?.name}</b>}</div>}
      <div className="loadout-list">{(localPlayer?.cards ?? []).map((id) => { const card = CARD_MAP[id]; const activeTurn = canAct && current?.id === localId; return <article className="loadout-card" key={id}><span aria-hidden>⚙</span><div><b>{card.name}</b><p>{card.description}</p>
        <div className="card-controls">{card.ability === "rapidHealing" && <button disabled={!activeTurn || (localPlayer?.energy ?? 0) < 2 || (localPlayer?.hp ?? 0) >= (localPlayer?.maxHp ?? 10)} onClick={() => act({ type: "USE_POWER", cardId: id })}>HEAL · 2⚡</button>}{card.ability === "telepath" && <button disabled={!activeTurn || game.phase !== "resolve" || (localPlayer?.energy ?? 0) < 1} onClick={() => act({ type: "USE_POWER", cardId: id })}>EXTRA REROLL · 1⚡</button>}{card.ability === "smokeCloud" && <button disabled={!activeTurn || game.phase !== "resolve" || (localPlayer?.smoke ?? 0) < 1} onClick={() => act({ type: "USE_POWER", cardId: id })}>SPEND SMOKE · {localPlayer?.smoke ?? 0}</button>}{localPlayer && hasAbility(localPlayer, "metamorph") && game.phase === "shop" && activeTurn && <button onClick={() => act({ type: "SELL_KEEP", cardId: id })}>METAMORPH · +{card.cost}⚡</button>}</div>
        {card.ability === "mimic" && <label className="mimic-picker">MIMIC TOKEN<select value={localPlayer?.mimicCard ?? ""} disabled={!activeTurn || game.phase !== "shop"} onChange={(event) => event.target.value && act({ type: "SET_MIMIC", cardId: event.target.value })}><option value="">Choose rival power…</option>{mimicOptions.map((option) => <option key={`${option.owner}-${option.id}`} value={option.id}>{option.owner}: {option.card.name}</option>)}</select></label>}</div><small>KEEP</small></article>; })}</div>{!(localPlayer?.cards ?? []).length && <p>Buy KEEP cards to build your monster.</p>}</article></section>

    {setupOpen && <div className="modal-backdrop"><section className="setup-modal"><button className="modal-close" onClick={() => game.started && setSetupOpen(false)} disabled={!game.started}>CLOSE</button><span className="eyebrow">ORIGINAL BROWSER BOARD GAME</span><h1>PICK YOUR MONSTER!</h1><p>Roll. Wreck. Rule Tokyo. First to 20 stars—or last monster standing—wins.</p><div className="mode-tabs"><button className={mode === "solo" ? "active" : ""} onClick={() => { setMode("solo"); setRoom(null); }}>SINGLE PLAYER</button><button className={mode === "multi" ? "active" : ""} onClick={() => setMode("multi")}>MULTIPLAYER</button></div><div className="monster-picker">{MONSTERS.map((n, i) => <button key={n} className={monster === i ? "selected" : ""} onClick={() => setMonster(i)}><Avatar monster={i}/><span>{n}</span></button>)}</div>
      {mode === "solo" ? <div className="setup-options"><label>MONSTERS<select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>{[2,3,4,5,6].map((n) => <option key={n}>{n}</option>)}</select></label><label>CPU LEVEL<select value={difficulty} onChange={(e) => setDifficulty(e.target.value as GameState["difficulty"])}><option value="easy">Easy</option><option value="normal">Normal</option><option value="ruthless">Ruthless</option></select></label><button className="launch" onClick={startSolo}>PLAY SOLO!</button></div> : room ? <div className="lobby"><div className="room-code"><span>ROOM CODE</span><b>{room.code}</b><button onClick={() => navigator.clipboard.writeText(room.code)}>COPY</button></div><div className="lobby-list">{room.players.map((p) => <span key={p.id}><Avatar monster={p.monster} size="small"/><b>{p.name}</b>{p.id === 0 && <small>HOST</small>}</span>)}</div>{room.host ? <button className="launch" disabled={room.players.length < 2} onClick={startRoom}>{room.players.length < 2 ? "WAITING FOR A RIVAL…" : "START ONLINE MATCH!"}</button> : <p className="waiting-copy">The host will launch when everyone is ready.</p>}</div> : <div className="online-setup"><label>YOUR NAME<input value={name} maxLength={22} onChange={(e) => setName(e.target.value)}/></label><div><button className="launch" disabled={busy} onClick={createRoom}>CREATE ROOM</button><span>OR</span><input aria-label="Room code" placeholder="ROOM CODE" value={joinCode} maxLength={6} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}/><button className="join" disabled={busy || joinCode.length < 6} onClick={joinRoom}>JOIN</button></div>{roomError && <p className="error">{roomError}</p>}</div>}<small className="original-note">66 original power cards · 9 original kaiju · real-time rooms · Higgsfield sound design</small></section></div>}
    {rulesOpen && <div className="modal-backdrop"><section className="rules-modal"><button className="modal-close" onClick={() => setRulesOpen(false)}>CLOSE</button><span className="eyebrow">QUICK RULES</span><h2>HOW TO PLAY</h2><div className="rules-grid">{[["01","ROLL","Roll up to three times. Lock any dice you want between rolls."],["02","SCORE","Three matching numbers score that number; extras add 1 VP."],["03","POWER","Hearts heal outside Tokyo. Energy buys cards. POW deals damage."],["04","TOKYO","Enter for 1 VP, then gain 2 VP whenever your next turn starts there."],["05","YIELD","When hit in Tokyo, choose to stay or retreat. The attacker moves in."],["06","WIN","Reach 20 VP or be the last surviving monster."]].map(([n,h,p]) => <article key={n}><b>{n}</b><h3>{h}</h3><p>{p}</p></article>)}</div></section></div>}
    {game.phase === "yield" && game.pendingYield && canYield && <div className="modal-backdrop"><section className="decision-modal"><span className="eyebrow">TOKYO UNDER ATTACK</span><h2>DO YOU YIELD?</h2><p>You survived with {game.players[game.pendingYield.targetId].hp} health. Stay for the bonus or hand over the city.</p><div><button onClick={() => act({ type: "STAY_CITY" })}>STAY & FIGHT</button><button onClick={() => act({ type: "YIELD_CITY" })}>YIELD TOKYO</button></div></section></div>}
    {winner && <div className="modal-backdrop victory"><section className="victory-modal"><div className="confetti">✦ ★ ✦ ★ ✦</div><Avatar monster={winner.monster} size="large"/><span className="eyebrow">MATCH COMPLETE</span><h2>{winner.id === localId ? "YOU RULE TOKYO!" : `${winner.name} WINS!`}</h2><p>{winner.vp} VP · {winner.hp} HP remaining</p><button className="launch" onClick={() => setSetupOpen(true)}>PLAY AGAIN</button></section></div>}
  </main>;
}
