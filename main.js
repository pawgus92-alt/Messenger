import {
  cleanText,
  hydrate,
  layout,
  parseThread,
  ropePath,
  seedEcho,
  sideOf,
  threadKey,
  tiePath,
  timeLabel,
  togglePin,
  untie,
  validateName,
} from "./model.js";

const STORE = "kromka-v1";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("kromka") : null;

const wire = document.querySelector("#wire");
const stage = document.querySelector("#stage");
const track = document.querySelector("#track");
const knotsEl = document.querySelector("#knots");
const stringEl = document.querySelector("#string");
const pinsEl = document.querySelector("#pins");
const threadTitle = document.querySelector("#thread-title");
const composer = document.querySelector("#composer");
const draft = document.querySelector("#draft");
const composerError = document.querySelector("#composer-error");
const replying = document.querySelector("#replying");
const replyingText = document.querySelector("#replying-text");
const hum = document.querySelector("#hum");
const meName = document.querySelector("#me-name");
const meBtn = document.querySelector("#me-btn");
const seatPanel = document.querySelector("#seat-panel");
const seatList = document.querySelector("#seat-list");
const seatForm = document.querySelector("#seat-form");
const seatError = document.querySelector("#seat-error");
const gate = document.querySelector("#gate");
const gateForm = document.querySelector("#gate-form");
const gateError = document.querySelector("#gate-error");
const known = document.querySelector("#known");
const knownList = document.querySelector("#known-list");
const mapLine = document.querySelector("#map-line");
const mapWindow = document.querySelector("#map-window");
const mapDots = document.querySelector("#map-dots");
const mapHint = document.querySelector("#map-hint");
const toEnd = document.querySelector("#to-end");
const ledge = document.querySelector("#ledge");
const ledgeToggle = document.querySelector("#ledge-toggle");
const live = document.querySelector("#live");

let data = hydrate(readRaw());
let seatKey = sessionStorage.getItem("kromka-seat") || "";
let active = readActive();
let openKnot = null;
let replyTo = null;
let stickToEnd = true;
let pendingFocus = null;
let freshId = null;
let humState = null;
let adding = false;
let renderQueued = false;

function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "null");
  } catch {
    return null;
  }
}

function readActive() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("kromka-active") || "null");
    if (saved?.kind === "self" || saved?.kind === "echo" || saved?.kind === "pair") return saved;
  } catch {
    /* keep the default thread */
  }
  return { kind: "echo" };
}

function saveActive() {
  sessionStorage.setItem("kromka-active", JSON.stringify(active));
}

function unreadSet() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem("kromka-unread") || "[]"));
  } catch {
    return new Set();
  }
}

function writeUnread(set) {
  sessionStorage.setItem("kromka-unread", JSON.stringify([...set]));
}

function currentThread() {
  if (!seatKey) return "";
  if (active.kind === "pair") return threadKey(seatKey, active.key);
  return threadKey(seatKey, active.kind === "self" ? "self" : "echo");
}

function displayOf(key) {
  if (key === "echo") return "Эхо";
  if (key === "self") return "себе";
  return data.seats[key] || data.contacts[key] || key;
}

function commit(mutator) {
  const merged = hydrate(readRaw());
  data = mutator(merged) || merged;
  localStorage.setItem(STORE, JSON.stringify(data));
  channel?.postMessage({ type: "sync" });
}

function sit(result) {
  seatKey = result.key;
  sessionStorage.setItem("kromka-seat", seatKey);
  commit((state) => {
    const next = seedEcho({ ...state, seats: { ...state.seats, [result.key]: result.display } }, result.key);
    return next;
  });
  active = { kind: "echo" };
  saveActive();
  openKnot = null;
  replyTo = null;
  stickToEnd = true;
  seatPanel.hidden = true;
  meBtn.setAttribute("aria-expanded", "false");
  if (gate.open) gate.close();
  render();
  draft.focus();
}

function knotById(id) {
  return data.knots.find((knot) => knot.id === id) || null;
}

function threadKnots() {
  const thread = currentThread();
  return data.knots.filter((knot) => knot.thread === thread);
}

function preview(text) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
}

function ingest() {
  const knownIds = new Set(data.knots.map((knot) => knot.id));
  const next = hydrate(readRaw());
  const arrived = next.knots.filter((knot) => !knownIds.has(knot.id) && knot.from !== seatKey && knot.from !== "echo");
  data = next;
  const unread = unreadSet();
  for (const knot of arrived) {
    if (knot.thread === currentThread()) {
      live.textContent = `${displayOf(knot.from)} завязал узел`;
      freshId = knot.id;
      if (stickToEnd) pendingFocus = null;
    } else {
      unread.add(knot.thread);
    }
  }
  writeUnread(unread);
  scheduleRender();
}

function render() {
  document.body.classList.toggle("is-seated", Boolean(seatKey));
  composer.hidden = !seatKey;
  renderChrome();
  renderThread();
  renderPins();
  const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
  if (pendingFocus) {
    const target = track.querySelector(`[data-id="${CSS.escape(pendingFocus)}"]`);
    pendingFocus = null;
    stickToEnd = false;
    target?.scrollIntoView({ inline: "center", block: "nearest" });
  } else if (stickToEnd) {
    stage.scrollLeft = max;
  }
  syncMap();
  toEnd.hidden = stickToEnd || max < 24;
}

function renderChrome() {
  meName.textContent = seatKey ? displayOf(seatKey) : "Сесть";
  wire.replaceChildren();
  if (!seatKey) return;

  wire.append(beadButton({ kind: "echo" }, "Эхо", "orb-echo"));
  wire.append(beadButton({ kind: "self" }, "себе", "orb-self"));

  const people = new Map([...Object.entries(data.seats), ...Object.entries(data.contacts)]);
  people.delete(seatKey);
  const names = [...people.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  for (const [key, label] of names) wire.append(beadButton({ kind: "pair", key }, label, "orb-pair"));

  if (adding) {
    const form = document.createElement("form");
    form.className = "add-form";
    const input = document.createElement("input");
    input.name = "who";
    input.maxLength = 24;
    input.placeholder = "имя";
    input.setAttribute("aria-label", "С кем новая нить");
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Ок";
    form.append(input, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = validateName(input.value);
      if (!result.ok || result.key === seatKey) {
        input.setCustomValidity(result.ok ? "С собой уже есть отдельная нить." : result.reason);
        input.reportValidity();
        return;
      }
      commit((state) => ({ ...state, contacts: { ...state.contacts, [result.key]: result.display } }));
      adding = false;
      openThread({ kind: "pair", key: result.key });
    });
    wire.append(form);
    input.focus();
  } else {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-bead";
    add.append(orb("orb-add"), Object.assign(document.createElement("span"), { textContent: "ещё" }));
    add.addEventListener("click", () => {
      adding = true;
      renderChrome();
    });
    wire.append(add);
  }

  const seats = Object.entries(data.seats).filter(([key]) => key !== seatKey);
  seatList.replaceChildren();
  for (const [key, label] of seats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seat-choice";
    button.textContent = label;
    button.addEventListener("click", () => sit({ key, display: label }));
    seatList.append(button);
  }
  if (!seats.length) {
    const empty = document.createElement("p");
    empty.textContent = "Других имён в этом браузере пока нет.";
    seatList.append(empty);
  }

  const others = Object.keys(data.seats).length < 2 && Object.keys(data.contacts).length === 0;
  mapHint.textContent = others ? "Вторая вкладка — другое имя, общая нить." : "";
}

function orb(className) {
  const node = document.createElement("i");
  node.className = `orb ${className}`;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function beadButton(next, label, orbClass) {
  const selected =
    active.kind === next.kind && (next.kind !== "pair" || active.key === next.key);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bead";
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", selected ? "true" : "false");
  const thread = threadKey(seatKey, next.kind === "pair" ? next.key : next.kind === "self" ? "self" : "echo");
  if (unreadSet().has(thread)) button.classList.add("is-unread");
  button.append(orb(orbClass));
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  button.addEventListener("click", () => openThread(next));
  return button;
}

function openThread(next) {
  active = next;
  saveActive();
  openKnot = null;
  replyTo = null;
  stickToEnd = true;
  const unread = unreadSet();
  unread.delete(currentThread());
  writeUnread(unread);
  adding = false;
  ledge.classList.remove("is-open");
  ledgeToggle.setAttribute("aria-expanded", "false");
  render();
  draft.focus();
}

function renderThread() {
  const thread = currentThread();
  const knots = threadKnots();
  const narrow = stage.clientWidth < 800;
  const placed = layout(knots, { gap: narrow ? 210 : 260, dayGap: narrow ? 156 : 188, now: Date.now() });
  const height = Math.max(stage.clientHeight, 320);
  const y = narrow
    ? Math.max(150, Math.round(height * 0.4))
    : Math.max(190, Math.min(height - 230, Math.round(height * 0.5)));

  threadTitle.textContent = titleFor(knots.length);
  track.style.width = `${Math.max(placed.width, stage.clientWidth)}px`;
  track.style.height = `${height}px`;

  stringEl.setAttribute("viewBox", `0 0 ${Math.max(placed.width, stage.clientWidth)} ${height}`);
  stringEl.setAttribute("width", String(Math.max(placed.width, stage.clientWidth)));
  stringEl.setAttribute("height", String(height));
  stringEl.replaceChildren();
  const shadow = path("rope-shadow", ropePath(placed.ropeXs, y + 6));
  const rope = path("rope", ropePath(placed.ropeXs, y));
  const peg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  peg.setAttribute("class", "peg");
  peg.setAttribute("cx", String(placed.ropeXs[0]));
  peg.setAttribute("cy", String(y));
  peg.setAttribute("r", "5");
  stringEl.append(shadow, rope, peg);

  const positions = new Map();
  knotsEl.replaceChildren();
  for (const item of placed.items) {
    if (item.type === "day") {
      const day = document.createElement("div");
      day.className = "day";
      day.style.left = `${item.x}px`;
      day.style.top = `${y}px`;
      day.textContent = item.label;
      knotsEl.append(day);
      continue;
    }
    positions.set(item.knot.id, item.x);
    knotsEl.append(renderKnot(item.knot, item.x, y));
  }
  for (const knot of knots) {
    if (!knot.replyTo || !positions.has(knot.replyTo) || !positions.has(knot.id)) continue;
    stringEl.append(path("tie", tiePath(positions.get(knot.replyTo), positions.get(knot.id), y, sideOf(knot, seatKey))));
  }

  composer.style.left = `${placed.composerX}px`;
  composer.style.top = `${y}px`;
  draft.placeholder = placeholderFor();
  if (replyTo && knotById(replyTo)) {
    replying.hidden = false;
    replyingText.textContent = `к узлу: ${preview(knotById(replyTo).text)}`;
  } else {
    replyTo = null;
    replying.hidden = true;
  }
  renderHum();
  renderMapDots(placed, knots);
}

function path(className, d) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("class", className);
  node.setAttribute("d", d);
  return node;
}

function titleFor(count) {
  if (active.kind === "echo") return "нить с эхом";
  if (active.kind === "self") return "нить с собой";
  const name = displayOf(active.key);
  return count ? `нить · ${name}` : `нить · ${name} · ещё прямая`;
}

function placeholderFor() {
  if (active.kind === "echo") return "Ответить Эху…";
  if (active.kind === "self") return "Узел для себя…";
  return `Завязать для ${displayOf(active.key)}…`;
}

function renderKnot(knot, x, y) {
  const side = sideOf(knot, seatKey);
  const article = document.createElement("article");
  article.className = "knot";
  if (openKnot === knot.id) article.classList.add("is-open");
  if ((data.pins[seatKey] || []).includes(knot.id)) article.classList.add("is-pinned");
  if (freshId === knot.id) article.classList.add("is-new");
  article.dataset.id = knot.id;
  article.dataset.side = side;
  article.dataset.from = knot.from;
  article.style.left = `${x}px`;
  article.style.top = `${y}px`;

  const node = document.createElement("button");
  node.type = "button";
  node.className = "node";
  node.setAttribute("aria-expanded", openKnot === knot.id ? "true" : "false");
  node.setAttribute("aria-label", `${speaker(knot)}, ${timeLabel(knot.at)}`);

  const tag = document.createElement("div");
  tag.className = "tag";
  const who = document.createElement("button");
  who.type = "button";
  who.className = "who-row";
  const name = document.createElement("span");
  name.textContent = speaker(knot);
  const time = document.createElement("time");
  time.dateTime = new Date(knot.at).toISOString();
  time.textContent = timeLabel(knot.at);
  who.append(name, time);
  const text = document.createElement("p");
  text.className = "text";
  text.textContent = knot.text;
  tag.append(who, text);

  if (knot.replyTo) {
    const note = document.createElement("p");
    note.className = "reply-note";
    const parent = knotById(knot.replyTo);
    note.textContent = parent ? `привязано к «${preview(parent.text)}»` : "привязано к уже развязанному узлу";
    tag.append(note);
  }

  const actions = document.createElement("div");
  actions.className = "tag-actions";
  actions.append(
    actionButton(article.classList.contains("is-pinned") ? "Снять" : "Приколоть", () => {
      commit((state) => togglePin(state, seatKey, knot.id));
      openKnot = knot.id;
      render();
    }),
    actionButton("Привязать", () => {
      replyTo = knot.id;
      openKnot = knot.id;
      render();
      draft.focus();
    }),
  );
  if (knot.from === seatKey) {
    actions.append(
      actionButton("Развязать", () => {
        commit((state) => untie(state, knot.id));
        if (openKnot === knot.id) openKnot = null;
        if (replyTo === knot.id) replyTo = null;
        render();
      }),
    );
  }
  tag.append(actions);
  article.append(node, tag);

  const toggle = () => {
    openKnot = openKnot === knot.id ? null : knot.id;
    render();
  };
  node.addEventListener("click", toggle);
  who.addEventListener("click", toggle);
  text.addEventListener("click", () => {
    if (!article.classList.contains("is-open")) toggle();
  });
  return article;
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function speaker(knot) {
  if (knot.from === "echo") return "Эхо";
  if (knot.from === seatKey) return "ты";
  return displayOf(knot.from);
}

function renderPins() {
  const pinned = new Set(data.pins[seatKey] || []);
  const cards = threadKnots().filter((knot) => pinned.has(knot.id));
  pinsEl.replaceChildren();
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "ledge-empty";
    empty.textContent = "Гвозди свободны. Открой узел и приколи его сюда.";
    pinsEl.append(empty);
    return;
  }
  for (const knot of cards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pin";
    const who = document.createElement("span");
    who.className = "pin-who";
    who.textContent = `${speaker(knot)} · ${timeLabel(knot.at)}`;
    const text = document.createElement("span");
    text.className = "pin-text";
    text.textContent = knot.text;
    button.append(who, text);
    button.addEventListener("click", () => {
      openKnot = knot.id;
      pendingFocus = knot.id;
      ledge.classList.remove("is-open");
      ledgeToggle.setAttribute("aria-expanded", "false");
      render();
    });
    pinsEl.append(button);
  }
}

function renderMapDots(placed, knots) {
  mapDots.replaceChildren();
  const width = Math.max(placed.width, stage.clientWidth);
  for (const item of placed.items) {
    if (item.type !== "knot") continue;
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "map-dot";
    dot.dataset.side = sideOf(item.knot, seatKey);
    dot.dataset.from = item.knot.from;
    dot.style.left = `${(item.x / width) * 100}%`;
    dot.setAttribute("aria-label", `${speaker(item.knot)}, ${timeLabel(item.knot.at)}`);
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      openKnot = item.knot.id;
      pendingFocus = item.knot.id;
      render();
    });
    mapDots.append(dot);
  }
  mapLine.dataset.width = String(width);
  mapLine.dataset.count = String(knots.length);
}

function syncMap() {
  const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
  const view = stage.clientWidth / Math.max(stage.scrollWidth, 1);
  const start = max === 0 ? 0 : stage.scrollLeft / stage.scrollWidth;
  mapWindow.style.left = `${start * 100}%`;
  mapWindow.style.width = `${Math.max(view * 100, 6)}%`;
  toEnd.hidden = stickToEnd || max < 24;
}

function renderHum() {
  if (humState && humState.thread === currentThread() && humState.from !== seatKey && humState.until > Date.now()) {
    hum.textContent = `${displayOf(humState.from)} держит нить…`;
  } else {
    hum.textContent = active.kind === "self" ? "только твоя сторона" : "";
  }
}

function scrub(clientX) {
  const rect = mapLine.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
  stage.scrollLeft = ratio * max;
}

meBtn.addEventListener("click", () => {
  if (!seatKey) {
    openGate();
    return;
  }
  const open = seatPanel.hidden;
  seatPanel.hidden = !open;
  meBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) seatForm.elements.name.focus();
});

seatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateName(seatForm.elements.name.value);
  seatError.textContent = result.ok ? "" : result.reason;
  if (!result.ok) return;
  seatForm.reset();
  sit(result);
});

document.addEventListener("pointerdown", (event) => {
  if (seatPanel.hidden) return;
  if (event.target.closest(".me-wrap")) return;
  seatPanel.hidden = true;
  meBtn.setAttribute("aria-expanded", "false");
});

gateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = validateName(gateForm.elements.name.value);
  gateError.textContent = result.ok ? "" : result.reason;
  if (!result.ok) return;
  sit(result);
});

gate.addEventListener("cancel", (event) => {
  if (!seatKey) event.preventDefault();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = cleanText(draft.value);
  composerError.textContent = result.ok ? "" : result.reason;
  if (!result.ok || !seatKey) return;
  const id = crypto.randomUUID();
  const thread = currentThread();
  const parent = replyTo;
  commit((state) => ({
    ...state,
    knots: [
      ...state.knots,
      { id, thread, from: seatKey, text: result.text, at: Date.now(), replyTo: parent },
    ].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)),
  }));
  draft.value = "";
  replyTo = null;
  openKnot = id;
  freshId = id;
  stickToEnd = true;
  render();
  draft.focus();
});

draft.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

draft.addEventListener("input", () => {
  composerError.textContent = "";
  channel?.postMessage({ type: "typing", from: seatKey, thread: currentThread(), until: Date.now() + 1600 });
});

document.querySelector("#reply-clear").addEventListener("click", () => {
  replyTo = null;
  render();
  draft.focus();
});

toEnd.addEventListener("click", () => {
  stickToEnd = true;
  stage.scrollLeft = stage.scrollWidth;
  render();
});

ledgeToggle.addEventListener("click", () => {
  const open = !ledge.classList.contains("is-open");
  ledge.classList.toggle("is-open", open);
  ledgeToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

stage.addEventListener("scroll", () => {
  const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
  stickToEnd = max - stage.scrollLeft < 48;
  syncMap();
}, { passive: true });

stage.addEventListener("wheel", (event) => {
  if (event.target.closest(".text, #pins")) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  stage.scrollLeft += event.deltaY;
  event.preventDefault();
}, { passive: false });

let drag = null;
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("button, textarea, input, a, .tag")) return;
  drag = { x: event.clientX, left: stage.scrollLeft };
  stage.classList.add("is-dragging");
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  stage.scrollLeft = drag.left - (event.clientX - drag.x);
});
stage.addEventListener("pointerup", () => {
  drag = null;
  stage.classList.remove("is-dragging");
});
stage.addEventListener("pointercancel", () => {
  drag = null;
  stage.classList.remove("is-dragging");
});

mapLine.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".map-dot")) return;
  scrub(event.clientX);
  mapLine.setPointerCapture(event.pointerId);
});
mapLine.addEventListener("pointermove", (event) => {
  if (!mapLine.hasPointerCapture(event.pointerId)) return;
  scrub(event.clientX);
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest("textarea, input")) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (event.key === "ArrowRight") stage.scrollLeft += 120;
  if (event.key === "ArrowLeft") stage.scrollLeft -= 120;
  if (event.key === "Escape") {
    openKnot = null;
    replyTo = null;
    seatPanel.hidden = true;
    render();
  }
});

window.addEventListener("resize", () => {
  if (seatKey) render();
});

channel?.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "typing") {
    humState = message;
    renderHum();
    window.setTimeout(renderHum, 1700);
    return;
  }
  if (message?.type === "sync") ingest();
});

window.addEventListener("storage", (event) => {
  if (event.key === STORE) ingest();
});

function openGate() {
  const seats = Object.entries(data.seats);
  known.hidden = seats.length === 0;
  knownList.replaceChildren();
  for (const [key, label] of seats) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => sit({ key, display: label }));
    knownList.append(button);
  }
  if (!gate.open) gate.showModal();
  gateForm.elements.name.focus();
}

function boot() {
  data = hydrate(readRaw());
  seatKey = sessionStorage.getItem("kromka-seat") || "";
  if (!seatKey || !data.seats[seatKey]) {
    seatKey = "";
    openGate();
    return;
  }
  commit((state) => seedEcho(state, seatKey));
  if (active.kind === "pair" && !data.seats[active.key] && !data.contacts[active.key]) active = { kind: "echo" };
  render();
}

boot();
