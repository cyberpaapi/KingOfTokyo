"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

type DieFace = "1" | "2" | "3" | "energy" | "smash" | "heart";
type Phase = "roll" | "resolve" | "shop" | "yield" | "over";

type Player = {
  id: number;
  name: string;
  bot: boolean;
  hp: number;
  vp: number;
  energy: number;
  eliminated: boolean;
  monster: number;
  cards: string[];
};

type Card = {
  id: string;
  name: string;
  cost: number;
  type: "KEEP" | "NOW";
  description: string;
  art: number;
  weight: number;
};

type GameState = {
  started: boolean;
  players: Player[];
  currentId: number;
  cityId: number | null;
  dice: DieFace[];
  held: boolean[];
  rollsLeft: number;
  phase: Phase;
  market: string[];
  deck: string[];
  discard: string[];
  log: string[];
  turn: number;
  rollNonce: number;
  winnerId: number | null;
  pendingYield: { targetId: number; attackerId: number; continueBot: boolean } | null;
  difficulty: "easy" | "normal" | "ruthless";
};

type Action =
  | { type: "NEW_GAME"; playerCount: number; monster: number; difficulty: GameState["difficulty"] }
  | { type: "ROLL" }
  | { type: "TOGGLE_HOLD"; index: number }
  | { type: "RESOLVE" }
  | { type: "YIELD_CITY" }
  | { type: "STAY_CITY" }
  | { type: "BUY"; cardId: string }
  | { type: "SWEEP_MARKET" }
  | { type: "END_TURN" }
  | { type: "BOT_ROLL"; dice: DieFace[] }
  | { type: "BOT_RESOLVE" };

const MONSTERS = [
  "Pyroclast",
  "Voltwing",
  "Gravilla",
  "Tempest Coil",
  "Prism Claw",
  "Reactor Jack",
  "Mecha Mako",
  "Verdant Titan",
  "Moonseer",
];

const BOT_NAMES = ["Rumble-9", "HEXAPE", "Neon Fang", "Moss Unit", "Star Talon"];
const FACES: DieFace[] = ["1", "2", "3", "energy", "smash", "heart"];

const CARDS: Card[] = [
  { id: "long-neck", name: "Expanded Core", cost: 5, type: "KEEP", description: "Roll one extra die each turn.", art: 3, weight: 7 },
  { id: "carapace", name: "Battle Carapace", cost: 4, type: "KEEP", description: "Reduce each hit you take by 1.", art: 2, weight: 8 },
  { id: "ion-maw", name: "Ion Maw", cost: 5, type: "KEEP", description: "Your Smash results deal +1 damage.", art: 0, weight: 9 },
  { id: "fast-healer", name: "Rapid Regrowth", cost: 4, type: "KEEP", description: "Heal +1 whenever you heal with hearts.", art: 1, weight: 7 },
  { id: "reactor-core", name: "Pocket Reactor", cost: 5, type: "KEEP", description: "Gain 1 energy at the start of your turn.", art: 3, weight: 8 },
  { id: "score-booster", name: "Crowd Favorite", cost: 6, type: "KEEP", description: "Number sets score +1 victory point.", art: 0, weight: 8 },
  { id: "drain-ray", name: "Drain Ray", cost: 5, type: "KEEP", description: "Heal 1 after dealing Smash damage.", art: 1, weight: 7 },
  { id: "spiked-tail", name: "Spiked Tail", cost: 3, type: "KEEP", description: "Deal 1 damage to an attacker when you yield the city.", art: 2, weight: 6 },
  { id: "nova-burst", name: "Nova Burst", cost: 7, type: "NOW", description: "Gain 2 VP. Every rival loses 2 health.", art: 0, weight: 10 },
  { id: "overcharge", name: "Overcharge", cost: 3, type: "NOW", description: "Gain 2 energy and 1 VP.", art: 3, weight: 6 },
  { id: "repair-swarm", name: "Repair Swarm", cost: 3, type: "NOW", description: "Restore 4 health.", art: 1, weight: 8 },
  { id: "media-frenzy", name: "Media Frenzy", cost: 5, type: "NOW", description: "Gain 2 victory points.", art: 0, weight: 8 },
  { id: "evacuation", name: "Citywide Panic", cost: 5, type: "NOW", description: "Every rival loses 2 health.", art: 2, weight: 8 },
  { id: "metamorphosis", name: "Metamorphosis", cost: 3, type: "NOW", description: "Restore 2 health and gain 2 energy.", art: 1, weight: 7 },
  { id: "shock-market", name: "Grid Dividend", cost: 4, type: "NOW", description: "Gain 4 energy.", art: 3, weight: 5 },
  { id: "city-rupture", name: "City Rupture", cost: 4, type: "NOW", description: "Gain 1 VP and deal 1 damage to the city ruler.", art: 2, weight: 6 },
  { id: "hyper-focus", name: "Hyper Focus", cost: 4, type: "KEEP", description: "Pairs of 3s score 1 VP.", art: 3, weight: 6 },
  { id: "reserve-plating", name: "Reserve Plating", cost: 3, type: "NOW", description: "Restore 2 health and gain 1 VP.", art: 2, weight: 6 },
];

const CARD_MAP = Object.fromEntries(CARDS.map((card) => [card.id, card])) as Record<string, Card>;

const initialState: GameState = {
  started: false,
  players: [],
  currentId: 0,
  cityId: null,
  dice: Array(6).fill("energy") as DieFace[],
  held: Array(6).fill(false),
  rollsLeft: 3,
  phase: "roll",
  market: [],
  deck: [],
  discard: [],
  log: [],
  turn: 1,
  rollNonce: 0,
  winnerId: null,
  pendingYield: null,
  difficulty: "normal",
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function randomFace(): DieFace {
  return FACES[Math.floor(Math.random() * FACES.length)];
}

function hasCard(player: Player, cardId: string) {
  return player.cards.includes(cardId);
}

function alive(players: Player[]) {
  return players.filter((player) => !player.eliminated);
}

function checkWinner(players: Player[]): number | null {
  const pointsWinner = players.find((player) => !player.eliminated && player.vp >= 20);
  if (pointsWinner) return pointsWinner.id;
  const survivors = alive(players);
  return survivors.length === 1 ? survivors[0].id : null;
}

function refillMarket(market: string[], deck: string[], discard: string[]) {
  let nextMarket = [...market];
  let nextDeck = [...deck];
  let nextDiscard = [...discard];
  while (nextMarket.length < 3) {
    if (nextDeck.length === 0) {
      nextDeck = shuffle(nextDiscard);
      nextDiscard = [];
    }
    const card = nextDeck.shift();
    if (!card) break;
    nextMarket.push(card);
  }
  return { market: nextMarket, deck: nextDeck, discard: nextDiscard };
}

function damagePlayer(players: Player[], targetId: number, amount: number) {
  return players.map((player) => {
    if (player.id !== targetId || player.eliminated) return player;
    const armor = hasCard(player, "carapace") ? 1 : 0;
    const damage = Math.max(0, amount - armor);
    const hp = Math.max(0, player.hp - damage);
    return { ...player, hp, eliminated: hp === 0 };
  });
}

function applyCard(players: Player[], buyerId: number, card: Card, cityId: number | null) {
  let next = players.map((player) =>
    player.id === buyerId
      ? { ...player, energy: player.energy - card.cost, cards: card.type === "KEEP" ? [...player.cards, card.id] : player.cards }
      : player,
  );
  const updateBuyer = (change: Partial<Player>) => {
    next = next.map((player) => (player.id === buyerId ? { ...player, ...change } : player));
  };
  const buyer = () => next.find((player) => player.id === buyerId)!;

  if (card.id === "nova-burst") {
    updateBuyer({ vp: buyer().vp + 2 });
    next.filter((player) => player.id !== buyerId && !player.eliminated).forEach((player) => {
      next = damagePlayer(next, player.id, 2);
    });
  }
  if (card.id === "overcharge") updateBuyer({ energy: buyer().energy + 2, vp: buyer().vp + 1 });
  if (card.id === "repair-swarm") updateBuyer({ hp: Math.min(10, buyer().hp + 4) });
  if (card.id === "media-frenzy") updateBuyer({ vp: buyer().vp + 2 });
  if (card.id === "evacuation") {
    next.filter((player) => player.id !== buyerId && !player.eliminated).forEach((player) => {
      next = damagePlayer(next, player.id, 2);
    });
  }
  if (card.id === "metamorphosis") updateBuyer({ hp: Math.min(10, buyer().hp + 2), energy: buyer().energy + 2 });
  if (card.id === "shock-market") updateBuyer({ energy: buyer().energy + 4 });
  if (card.id === "city-rupture") {
    updateBuyer({ vp: buyer().vp + 1 });
    if (cityId !== null && cityId !== buyerId) next = damagePlayer(next, cityId, 1);
  }
  if (card.id === "reserve-plating") updateBuyer({ hp: Math.min(10, buyer().hp + 2), vp: buyer().vp + 1 });
  return next;
}

function startNextTurn(state: GameState): GameState {
  const living = alive(state.players);
  if (living.length <= 1) {
    const winnerId = living[0]?.id ?? null;
    return { ...state, phase: "over", winnerId };
  }
  let nextId = state.currentId;
  do {
    nextId = (nextId + 1) % state.players.length;
  } while (state.players[nextId].eliminated);

  let players = state.players.map((player) => {
    if (player.id !== nextId) return player;
    const cityBonus = state.cityId === nextId ? 2 : 0;
    const energyBonus = hasCard(player, "reactor-core") ? 1 : 0;
    return { ...player, vp: player.vp + cityBonus, energy: player.energy + energyBonus };
  });
  const winnerId = checkWinner(players);
  if (winnerId !== null) return { ...state, players, currentId: nextId, winnerId, phase: "over" };
  const nextPlayer = players[nextId];
  const dieCount = 6 + (hasCard(nextPlayer, "long-neck") ? 1 : 0);
  const bonusNotes: string[] = [];
  if (state.cityId === nextId) bonusNotes.push("+2 VP for ruling Neon City");
  if (hasCard(nextPlayer, "reactor-core")) bonusNotes.push("+1 energy from Pocket Reactor");
  const log = [`Turn ${state.turn + 1}: ${nextPlayer.name}${bonusNotes.length ? ` — ${bonusNotes.join(", ")}` : ""}.`, ...state.log].slice(0, 18);
  return {
    ...state,
    players,
    currentId: nextId,
    dice: Array(dieCount).fill("energy") as DieFace[],
    held: Array(dieCount).fill(false),
    rollsLeft: 3,
    phase: "roll",
    pendingYield: null,
    turn: state.turn + 1,
    log,
  };
}

function botShouldYield(state: GameState, target: Player, damage: number) {
  if (state.difficulty === "easy") return target.hp <= 7 || damage >= 3;
  if (state.difficulty === "ruthless") return target.hp <= 3 || (target.hp <= 5 && damage >= 3);
  return target.hp <= 5 || (target.hp <= 7 && damage >= 3);
}

function resolveDice(state: GameState, continueBot: boolean): GameState {
  const current = state.players[state.currentId];
  const counts = state.dice.reduce<Record<string, number>>((totals, face) => {
    totals[face] = (totals[face] ?? 0) + 1;
    return totals;
  }, {});
  let players = state.players.map((player) => ({ ...player }));
  let cityId = state.cityId;
  const notes: string[] = [];

  let numberScore = 0;
  ["1", "2", "3"].forEach((face) => {
    const amount = counts[face] ?? 0;
    if (amount >= 3) numberScore += Number(face) + (amount - 3);
    if (face === "3" && amount === 2 && hasCard(current, "hyper-focus")) numberScore += 1;
  });
  if (numberScore > 0 && hasCard(current, "score-booster")) numberScore += 1;
  const energy = counts.energy ?? 0;
  const hearts = counts.heart ?? 0;
  const smash = counts.smash ?? 0;
  const inCity = cityId === current.id;
  const heal = inCity ? 0 : hearts + (hearts > 0 && hasCard(current, "fast-healer") ? 1 : 0);

  players = players.map((player) =>
    player.id === current.id
      ? { ...player, vp: player.vp + numberScore, energy: player.energy + energy, hp: Math.min(10, player.hp + heal) }
      : player,
  );
  if (numberScore) notes.push(`${numberScore} VP`);
  if (energy) notes.push(`${energy} energy`);
  if (heal) notes.push(`${heal} health`);
  if (hearts && inCity) notes.push("hearts blocked in the city");

  let pendingYield: GameState["pendingYield"] = null;
  if (smash > 0) {
    const attack = smash + (hasCard(current, "ion-maw") ? 1 : 0);
    const targets = inCity
      ? players.filter((player) => player.id !== current.id && !player.eliminated).map((player) => player.id)
      : cityId !== null
        ? [cityId]
        : [];
    targets.forEach((targetId) => {
      players = damagePlayer(players, targetId, attack);
    });
    if (targets.length) notes.push(`${attack} damage to ${inCity ? `${targets.length} rivals` : players[targets[0]].name}`);
    if (hasCard(current, "drain-ray") && targets.length) {
      players = players.map((player) => (player.id === current.id ? { ...player, hp: Math.min(10, player.hp + 1) } : player));
      notes.push("Drain Ray restored 1 health");
    }

    if (!inCity && cityId !== null) {
      const target = players[cityId];
      if (!target.eliminated) {
        if (!target.bot) {
          pendingYield = { targetId: target.id, attackerId: current.id, continueBot };
        } else if (botShouldYield(state, target, attack)) {
          if (hasCard(target, "spiked-tail")) players = damagePlayer(players, current.id, 1);
          cityId = current.id;
          players = players.map((player) => (player.id === current.id ? { ...player, vp: player.vp + 1 } : player));
          notes.push(`${target.name} yielded Neon City; ${current.name} seized it for +1 VP`);
        }
      } else {
        cityId = null;
      }
    }
  }

  if (cityId !== null && players[cityId].eliminated) cityId = null;
  if (cityId === null && !players[current.id].eliminated) {
    cityId = current.id;
    players = players.map((player) => (player.id === current.id ? { ...player, vp: player.vp + 1 } : player));
    notes.push(`${current.name} entered Neon City for +1 VP`);
  }

  const winnerId = checkWinner(players);
  const log = [`${current.name} resolved: ${notes.length ? notes.join(" • ") : "no effect"}.`, ...state.log].slice(0, 18);
  if (winnerId !== null) return { ...state, players, cityId, winnerId, phase: "over", log };
  return { ...state, players, cityId, pendingYield, phase: pendingYield ? "yield" : "shop", log };
}

function botShop(state: GameState): GameState {
  const bot = state.players[state.currentId];
  const affordable = state.market.map((id) => CARD_MAP[id]).filter((card) => card && card.cost <= bot.energy);
  if (!affordable.length) return state;
  affordable.sort((a, b) => b.weight - a.weight || b.cost - a.cost);
  const card = affordable[0];
  let players = applyCard(state.players, bot.id, card, state.cityId);
  let cityId = state.cityId;
  if (cityId !== null && players[cityId].eliminated) cityId = null;
  const market = state.market.filter((id) => id !== card.id);
  const recycled = card.type === "NOW" ? [...state.discard, card.id] : state.discard;
  const refill = refillMarket(market, state.deck, recycled);
  const winnerId = checkWinner(players);
  const log = [`${bot.name} bought ${card.name}.`, ...state.log].slice(0, 18);
  return { ...state, players, cityId, ...refill, log, winnerId, phase: winnerId !== null ? "over" : state.phase };
}

function gameReducer(state: GameState, action: Action): GameState {
  if (action.type === "NEW_GAME") {
    const roster = shuffle(MONSTERS.map((_, index) => index).filter((index) => index !== action.monster));
    const players: Player[] = Array.from({ length: action.playerCount }, (_, index) => ({
      id: index,
      name: index === 0 ? MONSTERS[action.monster] : BOT_NAMES[index - 1],
      bot: index !== 0,
      hp: 10,
      vp: 0,
      energy: 0,
      eliminated: false,
      monster: index === 0 ? action.monster : roster[index - 1],
      cards: [],
    }));
    const deck = shuffle(CARDS.map((card) => card.id));
    return {
      ...initialState,
      started: true,
      players,
      deck: deck.slice(3),
      market: deck.slice(0, 3),
      difficulty: action.difficulty,
      log: [`The reactors are live. ${MONSTERS[action.monster]} takes the first turn.`, "First monster to 20 VP—or last monster standing—wins."],
    };
  }
  if (!state.started || state.phase === "over") return state;
  const current = state.players[state.currentId];

  if (action.type === "ROLL" && !current.bot && state.phase === "roll" && state.rollsLeft > 0) {
    const dice = state.dice.map((face, index) => (state.held[index] ? face : randomFace()));
    return { ...state, dice, rollsLeft: state.rollsLeft - 1, phase: "resolve", rollNonce: state.rollNonce + 1 };
  }
  if (action.type === "TOGGLE_HOLD" && !current.bot && state.phase === "resolve") {
    const held = state.held.map((value, index) => (index === action.index ? !value : value));
    return { ...state, held };
  }
  if (action.type === "RESOLVE" && !current.bot && state.phase === "resolve") return resolveDice(state, false);
  if (action.type === "ROLL" && !current.bot && state.phase === "resolve" && state.rollsLeft > 0) {
    const dice = state.dice.map((face, index) => (state.held[index] ? face : randomFace()));
    return { ...state, dice, rollsLeft: state.rollsLeft - 1, rollNonce: state.rollNonce + 1 };
  }
  if (action.type === "YIELD_CITY" && state.phase === "yield" && state.pendingYield) {
    const pending = state.pendingYield;
    let players = state.players;
    const target = players[pending.targetId];
    if (hasCard(target, "spiked-tail")) players = damagePlayer(players, pending.attackerId, 1);
    players = players.map((player) => (player.id === pending.attackerId ? { ...player, vp: player.vp + 1 } : player));
    let next: GameState = {
      ...state,
      players,
      cityId: pending.attackerId,
      pendingYield: null,
      phase: "shop" as Phase,
      log: [`${target.name} yielded Neon City.`, ...state.log].slice(0, 18),
    };
    const winnerId = checkWinner(players);
    if (winnerId !== null) return { ...next, winnerId, phase: "over" };
    if (pending.continueBot) next = startNextTurn(botShop(next));
    return next;
  }
  if (action.type === "STAY_CITY" && state.phase === "yield" && state.pendingYield) {
    const pending = state.pendingYield;
    let next: GameState = { ...state, pendingYield: null, phase: "shop" as Phase, log: ["The city ruler refused to yield.", ...state.log].slice(0, 18) };
    if (pending.continueBot) next = startNextTurn(botShop(next));
    return next;
  }
  if (action.type === "BUY" && !current.bot && state.phase === "shop") {
    const card = CARD_MAP[action.cardId];
    if (!card || current.energy < card.cost || !state.market.includes(card.id)) return state;
    let players = applyCard(state.players, current.id, card, state.cityId);
    let cityId = state.cityId;
    if (cityId !== null && players[cityId].eliminated) cityId = null;
    const market = state.market.filter((id) => id !== card.id);
    const recycled = card.type === "NOW" ? [...state.discard, card.id] : state.discard;
    const refill = refillMarket(market, state.deck, recycled);
    const winnerId = checkWinner(players);
    return {
      ...state,
      players,
      cityId,
      ...refill,
      winnerId,
      phase: winnerId !== null ? "over" : "shop",
      log: [`${current.name} bought ${card.name}.`, ...state.log].slice(0, 18),
    };
  }
  if (action.type === "SWEEP_MARKET" && !current.bot && state.phase === "shop" && current.energy >= 2) {
    const players = state.players.map((player) => (player.id === current.id ? { ...player, energy: player.energy - 2 } : player));
    const refill = refillMarket([], state.deck, [...state.discard, ...state.market]);
    return { ...state, players, ...refill, log: [`${current.name} swept the market for 2 energy.`, ...state.log].slice(0, 18) };
  }
  if (action.type === "END_TURN" && !current.bot && state.phase === "shop") return startNextTurn(state);
  if (action.type === "BOT_ROLL" && current.bot && state.phase === "roll") {
    return { ...state, dice: action.dice, rollsLeft: 0, phase: "resolve", held: action.dice.map(() => true), rollNonce: state.rollNonce + 1 };
  }
  if (action.type === "BOT_RESOLVE" && current.bot && state.phase === "resolve") {
    const resolved = resolveDice(state, true);
    if (resolved.phase === "over" || resolved.phase === "yield") return resolved;
    return startNextTurn(botShop(resolved));
  }
  return state;
}

function monsterStyle(index: number) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { backgroundPosition: `${col * 50}% ${row * 50}%` };
}

function artStyle(index: number) {
  return { backgroundPosition: `${(index % 2) * 100}% ${Math.floor(index / 2) * 100}%` };
}

function faceLabel(face: DieFace) {
  if (face === "energy") return "ZAP";
  if (face === "smash") return "HIT";
  if (face === "heart") return "HEAL";
  return face;
}

function chooseBotDice(state: GameState, player: Player): DieFace[] {
  const count = 6 + (hasCard(player, "long-neck") ? 1 : 0);
  let dice = Array.from({ length: count }, randomFace);
  for (let roll = 0; roll < 2; roll += 1) {
    const numberCounts = ["1", "2", "3"].map((face) => ({ face, count: dice.filter((die) => die === face).length })).sort((a, b) => b.count - a.count);
    const targetNumber = numberCounts[0].count >= 2 ? numberCounts[0].face : null;
    dice = dice.map((face) => {
      const keepHeart = face === "heart" && player.hp <= (state.difficulty === "ruthless" ? 4 : 6) && state.cityId !== player.id;
      const keep = face === "smash" || face === "energy" || keepHeart || (targetNumber !== null && face === targetNumber);
      return keep ? face : randomFace();
    });
  }
  return dice;
}

function Avatar({ monster, size = "normal" }: { monster: number; size?: "small" | "normal" | "large" }) {
  return <span className={`avatar avatar-${size}`} style={monsterStyle(monster)} aria-hidden="true" />;
}

export default function Home() {
  const [game, dispatch] = useReducer(gameReducer, initialState);
  const [playerCount, setPlayerCount] = useState(4);
  const [monster, setMonster] = useState(0);
  const [difficulty, setDifficulty] = useState<GameState["difficulty"]>("normal");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const current = game.players[game.currentId];
  const cityPlayer = game.cityId === null ? null : game.players[game.cityId];
  const winner = game.winnerId === null ? null : game.players[game.winnerId];

  const playTone = (frequency: number, duration = 0.08) => {
    if (!soundOn || typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = audioRef.current ?? new AudioCtx();
    audioRef.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  };

  useEffect(() => {
    if (!game.started || game.phase === "over" || !current?.bot || game.phase !== "roll") return;
    const timer = window.setTimeout(() => dispatch({ type: "BOT_ROLL", dice: chooseBotDice(game, current) }), 720);
    return () => window.clearTimeout(timer);
  }, [game, current]);

  useEffect(() => {
    if (!game.started || !current?.bot || game.phase !== "resolve") return;
    const timer = window.setTimeout(() => dispatch({ type: "BOT_RESOLVE" }), 980);
    return () => window.clearTimeout(timer);
  }, [game.started, game.phase, game.currentId, current]);

  const scorePreview = useMemo(() => {
    if (!game.started || game.phase === "roll") return null;
    const counts = game.dice.reduce<Record<string, number>>((totals, face) => ({ ...totals, [face]: (totals[face] ?? 0) + 1 }), {});
    return `${counts.smash ?? 0} HIT · ${counts.heart ?? 0} HEAL · ${counts.energy ?? 0} ZAP`;
  }, [game.started, game.phase, game.dice]);

  const startGame = () => {
    dispatch({ type: "NEW_GAME", playerCount, monster, difficulty });
    setSetupOpen(false);
    playTone(120, 0.16);
    if (typeof window !== "undefined" && !window.localStorage.getItem("kaiju-clash-tutorial")) setTutorialStep(0);
  };

  const handleRoll = () => {
    playTone(180 + Math.random() * 80, 0.1);
    dispatch({ type: "ROLL" });
  };

  const finishTutorial = () => {
    setTutorialStep(null);
    if (typeof window !== "undefined") window.localStorage.setItem("kaiju-clash-tutorial", "seen");
  };

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setSetupOpen(true)} aria-label="Open new game setup">
          <span className="brand-kicker">NEON TABLETOP</span>
          <span className="brand-title">KAIJU CLASH</span>
        </button>
        <div className="turn-chip" aria-live="polite">
          <span className="turn-dot" />
          {game.started ? `TURN ${game.turn} // ${current?.name ?? "—"}` : "READY ROOM"}
        </div>
        <nav className="top-actions" aria-label="Game controls">
          <button className="icon-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "Mute sound" : "Enable sound"}>
            {soundOn ? "SOUND ON" : "SOUND OFF"}
          </button>
          <button className="icon-button" onClick={() => setRulesOpen(true)}>HOW TO PLAY</button>
          <button className="new-game-button" onClick={() => setSetupOpen(true)}>NEW GAME</button>
        </nav>
      </header>

      {game.started && (
        <section className="player-rail" aria-label="Player standings">
          {game.players.map((player) => (
            <article key={player.id} className={`player-card ${player.id === game.currentId ? "is-current" : ""} ${player.id === game.cityId ? "is-city" : ""} ${player.eliminated ? "is-out" : ""}`}>
              <Avatar monster={player.monster} size="small" />
              <div className="player-copy">
                <span className="player-name">{player.name}</span>
                <span className="player-role">{player.bot ? "CPU" : "YOU"}{player.id === game.cityId ? " · CITY" : ""}</span>
              </div>
              <div className="player-stats">
                <span className="stat stat-hp"><b>{player.hp}</b> HP</span>
                <span className="stat stat-vp"><b>{player.vp}</b> VP</span>
                <span className="stat stat-en"><b>{player.energy}</b> EN</span>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="table-grid">
        <article className="city-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">BATTLE ZONE</span><h2>NEON CITY</h2></div>
            <span className={`city-status ${cityPlayer ? "occupied" : ""}`}>{cityPlayer ? "OCCUPIED" : "OPEN"}</span>
          </div>
          <div className="city-stage">
            <div className="city-grid-lines" />
            <div className="city-silhouette"><i /><i /><i /><i /><i /></div>
            {cityPlayer ? (
              <div className="city-monster">
                <Avatar monster={cityPlayer.monster} size="large" />
                <span className="city-name">{cityPlayer.name}</span>
                <span className="city-bonus">+2 VP next turn</span>
              </div>
            ) : (
              <div className="city-empty"><span>NO RULER</span><small>Finish a turn to enter for +1 VP</small></div>
            )}
          </div>
          <div className="city-rule"><b>Inside attacks everyone.</b><span>Outside attacks the ruler.</span></div>
        </article>

        <article className="dice-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">ACTION CONSOLE</span><h2>{current?.bot ? "CPU ROLL" : "YOUR ROLL"}</h2></div>
            <span className="roll-counter">{game.rollsLeft} REROLLS</span>
          </div>
          <div className="dice-tray" aria-label="Dice tray">
            {game.dice.map((face, index) => (
              <button
                key={`${index}-${game.rollNonce}`}
                className={`die die-${face} ${game.held[index] ? "is-held" : ""} ${game.phase === "resolve" ? "rolled" : ""}`}
                onClick={() => dispatch({ type: "TOGGLE_HOLD", index })}
                disabled={!game.started || current?.bot || game.phase !== "resolve"}
                aria-pressed={game.held[index]}
                aria-label={`${faceLabel(face)} die ${game.held[index] ? "held" : "not held"}`}
              >
                <span>{faceLabel(face)}</span>
                {game.held[index] && <small>LOCKED</small>}
              </button>
            ))}
          </div>
          <div className="resolve-strip">
            <span>{scorePreview ?? "Roll, then tap dice to lock them."}</span>
            <span>3× number = score</span>
          </div>
          <div className="primary-actions">
            <button className="roll-button" onClick={handleRoll} disabled={!game.started || current?.bot || !["roll", "resolve"].includes(game.phase) || game.rollsLeft <= 0}>
              {game.phase === "roll" ? "ROLL DICE" : game.rollsLeft > 0 ? `REROLL · ${game.rollsLeft}` : "NO REROLLS"}
            </button>
            <button className="resolve-button" onClick={() => { playTone(320, 0.12); dispatch({ type: "RESOLVE" }); }} disabled={!game.started || current?.bot || game.phase !== "resolve"}>
              SCORE & ATTACK
            </button>
          </div>
          {game.phase === "shop" && !current?.bot && (
            <div className="end-turn-dock">
              <span>Buy any cards you want, then continue.</span>
              <button onClick={() => dispatch({ type: "END_TURN" })}>END TURN</button>
            </div>
          )}
          {current?.bot && game.phase !== "over" && <div className="cpu-thinking"><span /> CPU calculating best move…</div>}
        </article>

        <aside className="market-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">POWER MARKET</span><h2>UPGRADES</h2></div>
            <button className="sweep-button" onClick={() => dispatch({ type: "SWEEP_MARKET" })} disabled={!game.started || current?.bot || game.phase !== "shop" || (current?.energy ?? 0) < 2}>SWEEP · 2 EN</button>
          </div>
          <div className="market-list">
            {game.market.map((cardId) => {
              const card = CARD_MAP[cardId];
              const canBuy = game.phase === "shop" && !current?.bot && (current?.energy ?? 0) >= card.cost;
              return (
                <article className="market-card" key={card.id}>
                  <div className="card-art" style={artStyle(card.art)}><span>{card.type}</span></div>
                  <div className="card-body">
                    <div className="card-title-row"><h3>{card.name}</h3><b>{card.cost} EN</b></div>
                    <p>{card.description}</p>
                    <button onClick={() => { playTone(520, 0.09); dispatch({ type: "BUY", cardId }); }} disabled={!canBuy}>BUY POWER</button>
                  </div>
                </article>
              );
            })}
            {!game.started && <div className="market-placeholder">Start a match to reveal the power market.</div>}
          </div>
        </aside>
      </section>

      <section className="lower-grid">
        <article className="log-panel panel">
          <div className="panel-heading compact"><div><span className="eyebrow">LIVE FEED</span><h2>BATTLE LOG</h2></div></div>
          <ol>{game.log.slice(0, 5).map((entry, index) => <li key={`${entry}-${index}`}><span>{String(game.turn - index).padStart(2, "0")}</span>{entry}</li>)}</ol>
        </article>
        <article className="loadout-panel panel">
          <div className="panel-heading compact"><div><span className="eyebrow">ACTIVE BIO-MODS</span><h2>YOUR LOADOUT</h2></div></div>
          <div className="loadout-list">
            {(game.players[0]?.cards ?? []).length ? game.players[0].cards.map((id) => <span key={id}>{CARD_MAP[id].name}</span>) : <p>No permanent powers yet. Buy KEEP cards from the market.</p>}
          </div>
        </article>
      </section>

      {setupOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <button className="modal-close" onClick={() => game.started && setSetupOpen(false)} disabled={!game.started} aria-label="Close setup">CLOSE</button>
            <span className="eyebrow">ORIGINAL MONSTER-DICE SHOWDOWN</span>
            <h1 id="setup-title">CHOOSE YOUR CHAMPION</h1>
            <p className="setup-lede">Roll. Wreck. Rule Neon City. Reach 20 victory points or become the last kaiju standing.</p>
            <div className="monster-picker" role="radiogroup" aria-label="Choose a monster">
              {MONSTERS.map((name, index) => (
                <button key={name} className={monster === index ? "selected" : ""} onClick={() => setMonster(index)} role="radio" aria-checked={monster === index}>
                  <Avatar monster={index} size="normal" /><span>{name}</span>
                </button>
              ))}
            </div>
            <div className="setup-options">
              <label><span>MONSTERS</span><select value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} players</option>)}</select></label>
              <label><span>CPU LEVEL</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as GameState["difficulty"])}><option value="easy">Easy</option><option value="normal">Normal</option><option value="ruthless">Ruthless</option></select></label>
              <button className="launch-button" onClick={startGame}>{game.started ? "RESTART MATCH" : "LAUNCH MATCH"}</button>
            </div>
            <small className="original-note">Original art, names, writing, and interface. Familiar monster-dice strategy, rebuilt for the browser.</small>
          </section>
        </div>
      )}

      {rulesOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <button className="modal-close" onClick={() => setRulesOpen(false)}>CLOSE</button>
            <span className="eyebrow">FIELD MANUAL</span><h2 id="rules-title">HOW TO PLAY</h2>
            <div className="rules-grid">
              <article><b>01</b><h3>Roll up to three times</h3><p>After each roll, lock any dice you want and reroll the rest. You may score early.</p></article>
              <article><b>02</b><h3>Resolve every symbol</h3><p>Three matching numbers score their value; extras add 1 VP. ZAP earns energy. HEAL restores health outside the city. HIT deals damage.</p></article>
              <article><b>03</b><h3>Rule Neon City</h3><p>Enter an empty city for 1 VP. Start your turn there for 2 VP. The ruler attacks every rival but cannot heal with dice.</p></article>
              <article><b>04</b><h3>Choose when to yield</h3><p>When attacked in the city, you may stay or yield. The attacker immediately enters and gains 1 VP.</p></article>
              <article><b>05</b><h3>Buy powers</h3><p>Spend energy after scoring. KEEP cards stay active; NOW cards trigger instantly. Spend 2 energy to replace all market cards.</p></article>
              <article><b>06</b><h3>Win the clash</h3><p>Reach 20 VP or eliminate every rival. At 0 health, a monster is out for the match.</p></article>
            </div>
          </section>
        </div>
      )}

      {game.phase === "yield" && game.pendingYield && (
        <div className="modal-backdrop" role="presentation">
          <section className="decision-modal" role="alertdialog" aria-modal="true" aria-labelledby="yield-title">
            <span className="eyebrow">CITY UNDER ATTACK</span><h2 id="yield-title">DO YOU YIELD?</h2>
            <p>You survived the hit with {game.players[game.pendingYield.targetId].hp} HP. Stay for the city bonus, or retreat so the attacker takes control.</p>
            <div><button className="danger-button" onClick={() => dispatch({ type: "STAY_CITY" })}>STAY & FIGHT</button><button className="secondary-button" onClick={() => dispatch({ type: "YIELD_CITY" })}>YIELD CITY</button></div>
          </section>
        </div>
      )}

      {winner && (
        <div className="modal-backdrop victory-backdrop" role="presentation">
          <section className="victory-modal" role="dialog" aria-modal="true" aria-labelledby="victory-title">
            <Avatar monster={winner.monster} size="large" />
            <span className="eyebrow">MATCH COMPLETE</span><h2 id="victory-title">{winner.id === 0 ? "YOU RULE THE CITY" : `${winner.name} WINS`}</h2>
            <p>{winner.vp} VP · {winner.hp} HP remaining</p>
            <button className="launch-button" onClick={() => setSetupOpen(true)}>PLAY AGAIN</button>
          </section>
        </div>
      )}

      {tutorialStep !== null && (
        <div className="tutorial-card" role="status" aria-live="polite">
          <span>QUICK START · {tutorialStep + 1}/3</span>
          <h3>{["Roll your dice", "Lock the good results", "Score, shop, survive"][tutorialStep]}</h3>
          <p>{[
            "Use up to three rolls. Every die can produce numbers, energy, attacks, or healing.",
            "After a roll, tap any die to lock it. Rerolls only change unlocked dice.",
            "Resolve your dice, buy powers with energy, then end the turn. Reach 20 VP to win.",
          ][tutorialStep]}</p>
          <div><button onClick={finishTutorial}>SKIP</button><button onClick={() => tutorialStep === 2 ? finishTutorial() : setTutorialStep(tutorialStep + 1)}>{tutorialStep === 2 ? "GOT IT" : "NEXT"}</button></div>
        </div>
      )}
    </main>
  );
}
