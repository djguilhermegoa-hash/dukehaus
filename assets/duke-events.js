(() => {
  const organizer = "https://projetoblippy.vercel.app/organizador/duke-haus";
  const timeZone = "America/Sao_Paulo";
  const dateTime = new Intl.DateTimeFormat("pt-BR", {timeZone, dateStyle: "full", timeStyle: "short"});
  const badgeDate = new Intl.DateTimeFormat("pt-BR", {timeZone, weekday: "short", day: "numeric", month: "short"});
  const heroDate = new Intl.DateTimeFormat("pt-BR", {timeZone, weekday: "short", day: "numeric"});
  const money = new Intl.NumberFormat("pt-BR", {style: "currency", currency: "BRL"});
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cards = document.getElementById("events");
  const controls = document.getElementById("event-controls");
  const previous = document.getElementById("prev-event");
  const next = document.getElementById("next-event");
  const status = document.getElementById("event-status");
  const hero = document.getElementById("hero-events");
  const cacheKey = "dukehaus-events-v1";
  const accents = ["#b8ff30", "#ff49a9", "#dcff54"];
  let feed;
  let fetchedAt = 0;

  function append(parent, tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content) element.textContent = content;
    parent.append(element);
    return element;
  }

  function revealExisting() {
    if (!("IntersectionObserver" in window) || reducedMotion.matches) return;
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }, {threshold: 0.08});
    document.querySelectorAll(".reveal").forEach(element => observer.observe(element));
  }

  function validIsoDate(value) {
    return typeof value === "string" &&
      /T[0-9]{2}:[0-9]{2}.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) &&
      Number.isFinite(Date.parse(value));
  }

  function secureUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== "https:" && url.origin !== location.origin) return null;
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function parseFeed(raw) {
    if (raw?.schemaVersion !== 1 || !validIsoDate(raw.syncedAt) || !Array.isArray(raw.events)) {
      throw new Error("Programação inválida");
    }
    if (!raw.events.every(event => typeof event?.id === "string" && event.id &&
        typeof event.name === "string" && event.name.trim() && validIsoDate(event.startAt) &&
        (event.endAt == null || validIsoDate(event.endAt)))) {
      throw new Error("Evento inválido");
    }
    return raw;
  }

  function currentEvents(source) {
    const seen = new Set();
    const now = Date.now();
    return [...source.events].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).filter(event => {
      if (seen.has(event.id) || Date.parse(event.endAt || event.startAt) <= now) return false;
      if (/^(cancel(?:l)?ed|completed|ended|expired)$/i.test(event.status || "")) return false;
      seen.add(event.id);
      return true;
    });
  }

  function externalLink(parent, className, text, href) {
    const link = append(parent, "a", className, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function renderCard(event, index) {
    const article = append(cards, "article", "event");
    article.style.setProperty("--accent", accents[index % accents.length]);
    const poster = append(article, "div", "poster");
    const flyer = secureUrl(event.flyerUrl);
    if (flyer) {
      const image = append(poster, "img");
      image.alt = `Flyer de ${event.name}`;
      image.loading = index === 0 ? "eager" : "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => {
        image.remove();
        poster.classList.add("event-poster-empty");
      }, {once: true});
      image.src = flyer.href;
    } else {
      poster.classList.add("event-poster-empty");
    }
    const date = new Date(event.startAt);
    append(poster, "span", "event-day", badgeDate.format(date).replaceAll(".", "").toUpperCase());
    const content = append(article, "div", "event-content");
    const start = append(content, "time", "event-date", dateTime.format(date));
    start.dateTime = event.startAt;
    append(content, "h3", "", event.name);
    if (typeof event.description === "string" && event.description.trim()) {
      append(content, "p", "event-desc", event.description);
    }
    const descriptionMedia = secureUrl(event.descriptionMediaUrl);
    if (descriptionMedia && descriptionMedia.href !== flyer?.href) {
      externalLink(content, "event-line event-more", "VER INFORMAÇÕES DO EVENTO", descriptionMedia.href);
    }
    if (event.status === "sold_out") {
      append(content, "p", "event-line", "Ingressos esgotados");
    } else if (Number.isFinite(event.startingPrice) && event.startingPrice >= 0 &&
        (event.currency === "BRL" || event.currency == null)) {
      append(content, "p", "event-line", `Ingressos a partir de ${money.format(event.startingPrice)}`);
    }

    const purchase = secureUrl(event.purchaseUrl);
    const validPurchase = purchase?.origin === "https://projetoblippy.vercel.app" && /^\/e\//.test(purchase.pathname);
    const actions = append(content, "div", "ticket-actions");
    externalLink(actions, "btn btn-green", "COMPRAR INGRESSO", validPurchase ? purchase.href : organizer);
  }

  function updateControls() {
    const max = cards.scrollWidth - cards.clientWidth;
    controls.hidden = max <= 2;
    cards.tabIndex = max > 2 ? 0 : -1;
    if (max > 2) cards.setAttribute("role", "region");
    else cards.removeAttribute("role");
    previous.disabled = cards.scrollLeft <= 2;
    next.disabled = cards.scrollLeft >= max - 2;
  }

  function scrollCards(direction) {
    const [first, second] = cards.children;
    if (!second) return;
    cards.scrollBy({left: direction * (second.offsetLeft - first.offsetLeft),
      behavior: reducedMotion.matches ? "auto" : "smooth"});
  }

  function showMessage(message, withLink = false) {
    status.textContent = message;
    if (withLink) externalLink(status, "", "Ver programação na Blipy", organizer);
  }

  function render(source, stale = false) {
    const events = currentEvents(source);
    cards.replaceChildren();
    hero.replaceChildren();
    cards.dataset.count = events.length;
    cards.hidden = events.length === 0;
    hero.hidden = events.length === 0;
    for (const [index, event] of events.entries()) {
      renderCard(event, index);
      if (index < 2) {
        const item = append(hero, "span");
        append(item, "b", "", `✳ ${heroDate.format(new Date(event.startAt)).replaceAll(".", "").toUpperCase()}`);
        item.append(document.createTextNode(` — ${event.name.toUpperCase()}`));
      }
    }
    if (!events.length) {
      showMessage(stale ? "Não foi possível atualizar a programação agora. " :
        "Ainda não há próximos eventos na programação. ", true);
    } else {
      showMessage(stale ? "Exibindo a última programação disponível. " : "", stale);
    }
    updateControls();
  }

  function cachedFeed() {
    try {
      return parseFeed(JSON.parse(localStorage.getItem(cacheKey)));
    } catch {
      return null;
    }
  }

  async function refresh() {
    fetchedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("data/events.json", {cache: "no-cache", signal: controller.signal});
      if (!response.ok) throw new Error("Programação indisponível");
      feed = parseFeed(await response.json());
      render(feed);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(feed));
      } catch {
        // A programação continua disponível quando o navegador bloqueia armazenamento.
      }
    } catch {
      feed = feed || cachedFeed();
      if (feed) {
        render(feed, true);
      } else {
        cards.hidden = true;
        updateControls();
        showMessage("Não foi possível carregar a programação agora. ", true);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  revealExisting();
  previous.addEventListener("click", () => scrollCards(-1));
  next.addEventListener("click", () => scrollCards(1));
  cards.addEventListener("scroll", updateControls, {passive: true});
  window.addEventListener("resize", updateControls);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - fetchedAt > 30 * 60 * 1000) void refresh();
  });
  if ("ResizeObserver" in window) new ResizeObserver(updateControls).observe(cards);
  showMessage("Carregando a programação…");
  void refresh();
})();
