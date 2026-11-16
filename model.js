export const RESERVED = new Set(["эхо", "себе"]);
export const TEXT_LIMIT = 500;
export const GAP = 250;
export const DAY_GAP = 92;
export const ORIGIN = 120;
export const PEG = 36;

export const ECHO_LINES = [
  "Это не лента сообщений. Время идёт вправо — вдоль нити, а не вниз по облачкам.",
  "Твои узлы висят под нитью. Чужие — над ней. Вы держите одну верёвку с двух сторон.",
  "Нажми узел, если хочешь приколоть его к кромке слева или привязать к нему ответ.",
  "Левая полка — не чат «Избранное». Туда попадает только то, что ты приколол.",
  "Открой вторую вкладку и сядь под другим именем. Нить между двумя именами общая для обоих.",
];

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function emptyState() {
  return {
    seats: {},
    contacts: {},
    knots: [],
    deleted: [],
    pins: {},
    seatPinRev: {},
  };
}

export function norm(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function validateName(raw) {
  const display = String(raw || "")
    .replace(/[|]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (display.length < 1 || display.length > 24) {
    return { ok: false, reason: "Имя — от 1 до 24 символов." };
  }
  if (!/\p{L}/u.test(display)) {
    return { ok: false, reason: "В имени нужна хотя бы одна буква." };
  }
  if (RESERVED.has(norm(display))) {
    return { ok: false, reason: "Это имя держит сама нить." };
  }
  return { ok: true, display, key: norm(display) };
}

export function cleanText(raw) {
  const text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return { ok: false, reason: "Пустую нить не завязать." };
  if ([...text].length > TEXT_LIMIT) return { ok: false, reason: "Узел короче 500 знаков." };
  return { ok: true, text };
}

export function threadKey(seatKey, other) {
  if (other === "echo") return `echo:${seatKey}`;
  if (other === "self") return `self:${seatKey}`;
  return `pair:${[seatKey, norm(other)].sort().join("|")}`;
}

export function parseThread(thread, seatKey) {
  if (thread.startsWith("echo:")) return { kind: "echo" };
  if (thread.startsWith("self:")) return { kind: "self" };
  const [a, b] = thread.slice("pair:".length).split("|");
  const other = a === seatKey ? b : a;
  return { kind: "pair", key: other };
}

export function dayStamp(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function dayLabel(at, now = Date.now()) {
  const d = new Date(at);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (d.getFullYear() !== new Date(now).getFullYear()) return `${base} ${d.getFullYear()}`;
  return base;
}

export function timeLabel(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function sideOf(knot, seatKey) {
  if (knot.from === seatKey) return "me";
  return "them";
}

function cloneKnot(knot) {
  return {
    id: String(knot.id),
    thread: String(knot.thread),
    from: String(knot.from),
    text: String(knot.text),
    at: Number(knot.at),
    replyTo: knot.replyTo ? String(knot.replyTo) : null,
  };
}

function validKnot(knot) {
  return Boolean(
    knot &&
      typeof knot.id === "string" &&
      typeof knot.thread === "string" &&
      typeof knot.from === "string" &&
      typeof knot.text === "string" &&
      Number.isFinite(knot.at),
  );
}

export function mergeState(a, b) {
  const left = a || emptyState();
  const right = b || emptyState();
  const seats = { ...(left.seats || {}), ...(right.seats || {}) };
  const contacts = { ...(left.contacts || {}), ...(right.contacts || {}) };
  const deleted = [...new Set([...(left.deleted || []), ...(right.deleted || [])])];
  const gone = new Set(deleted);
  const map = new Map();
  for (const knot of [...(left.knots || []), ...(right.knots || [])]) {
    if (!validKnot(knot) || gone.has(knot.id) || map.has(knot.id)) continue;
    map.set(knot.id, cloneKnot(knot));
  }
  const knots = [...map.values()].sort((p, q) => p.at - q.at || p.id.localeCompare(q.id));
  const pinSeats = new Set([
    ...Object.keys(left.pins || {}),
    ...Object.keys(right.pins || {}),
    ...Object.keys(left.seatPinRev || {}),
    ...Object.keys(right.seatPinRev || {}),
  ]);
  const pins = {};
  const seatPinRev = {};
  for (const seat of pinSeats) {
    const ra = left.seatPinRev?.[seat] || 0;
    const rb = right.seatPinRev?.[seat] || 0;
    const source = rb >= ra ? right : left;
    pins[seat] = [...(source.pins?.[seat] || [])].filter((id) => map.has(id));
    seatPinRev[seat] = Math.max(ra, rb);
  }
  return { seats, contacts, knots, deleted, pins, seatPinRev };
}

export function hydrate(raw) {
  if (!raw || typeof raw !== "object") return emptyState();
  return mergeState(emptyState(), raw);
}

export function seedEcho(state, seatKey, now = Date.now()) {
  const thread = threadKey(seatKey, "echo");
  if (state.knots.some((knot) => knot.thread === thread)) return state;
  const knots = ECHO_LINES.map((text, index) => ({
    id: `echo-${seatKey}-${index}`,
    thread,
    from: "echo",
    text,
    at: now - (ECHO_LINES.length - index) * 12 * 60 * 1000,
    replyTo: null,
  }));
  return {
    ...state,
    knots: [...state.knots, ...knots].sort((p, q) => p.at - q.at || p.id.localeCompare(q.id)),
  };
}

export function layout(knots, { gap = GAP, dayGap = DAY_GAP, origin = ORIGIN, now = Date.now() } = {}) {
  const items = [];
  const ropeXs = [PEG];
  let x = origin;
  let lastDay = "";
  for (const knot of knots) {
    const day = dayStamp(knot.at);
    if (day !== lastDay) {
      items.push({ type: "day", x, label: dayLabel(knot.at, now), at: knot.at });
      ropeXs.push(x);
      x += dayGap;
      lastDay = day;
    }
    items.push({ type: "knot", knot, x });
    ropeXs.push(x);
    x += gap;
  }
  const composerX = knots.length ? x : origin;
  ropeXs.push(composerX);
  const width = composerX + 320;
  return { items, ropeXs, composerX, width };
}

export function ropePath(xs, y) {
  if (!xs.length) return "";
  const point = (x, py) => `${x.toFixed(1)} ${py.toFixed(1)}`;
  let d = `M ${point(xs[0], y)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x1 = xs[i];
    const x2 = xs[i + 1];
    const mid = (x1 + x2) / 2;
    const droop = Math.min(34, Math.max(12, (x2 - x1) * 0.12));
    d += ` Q ${point(mid, y + droop)} ${point(x2, y)}`;
  }
  return d;
}

export function tiePath(x1, x2, y, side) {
  const mid = (x1 + x2) / 2;
  const amp = side === "me" ? 16 : -16;
  return `M ${x1.toFixed(1)} ${y.toFixed(1)} Q ${mid.toFixed(1)} ${(y + amp).toFixed(1)} ${x2.toFixed(1)} ${y.toFixed(1)}`;
}

export function togglePin(state, seatKey, knotId) {
  const rev = (state.seatPinRev?.[seatKey] || 0) + 1;
  const current = new Set(state.pins?.[seatKey] || []);
  if (current.has(knotId)) current.delete(knotId);
  else current.add(knotId);
  return {
    ...state,
    pins: { ...state.pins, [seatKey]: [...current] },
    seatPinRev: { ...state.seatPinRev, [seatKey]: rev },
  };
}

export function untie(state, knotId) {
  return {
    ...state,
    knots: state.knots.filter((knot) => knot.id !== knotId),
    deleted: [...new Set([...(state.deleted || []), knotId])],
  };
}
