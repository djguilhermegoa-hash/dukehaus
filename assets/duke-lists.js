(() => {
  const $ = id => document.getElementById(id);
  const timeZone = "America/Sao_Paulo";
  const dateTime = new Intl.DateTimeFormat("pt-BR", {timeZone, dateStyle: "short", timeStyle: "short"});
  const monthName = new Intl.DateTimeFormat("pt-BR", {timeZone: "UTC", year: "numeric", month: "long"});
  const dateParts = new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"});
  const birthday = panel("birthday");
  const off = panel("off");
  const retry = $("lists-retry");
  const route = new URLSearchParams(location.hash.slice(1));
  const privateRoute = route.has("lista-off");
  const invite = privateRoute ? route.get("lista-off") : null;
  const endpoint = configEndpoint();
  const attempts = new WeakMap();
  let catalog;
  let catalogAt = 0;
  let catalogRequest;

  function panel(id) {
    return {
      card: $(id + "-card"),
      toggle: $(id + "-toggle"),
      panel: $(id + "-panel"),
      availability: $(id + "-availability"),
      form: $(id + "-form")
    };
  }

  function configEndpoint() {
    const configured = window.dukeConfig?.listsEndpoint;
    const value = typeof configured === "string" ? configured.trim() : "";
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value) ? value : "";
  }

  function localDate() {
    const parts = Object.fromEntries(dateParts.formatToParts(new Date()).map(({type, value}) => [type, value]));
    return [parts.year, parts.month, parts.day].join("-");
  }

  function showReference(reference) {
    const month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(reference || "") ? reference : localDate().slice(0, 7);
    const label = monthName.format(new Date(month + "-15T12:00:00Z"));
    $("birthday-reference").textContent = "Mês de referência: " + label + ". Vale o mês do evento escolhido.";
  }

  function displayTime(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? dateTime.format(date) : "";
  }

  function selectOptions(select, values, placeholder = "") {
    const previous = select.value;
    select.replaceChildren();
    if (placeholder) select.append(new Option(placeholder, ""));
    for (const {id, label} of values) select.append(new Option(label, id));
    if (values.some(option => option.id === previous)) select.value = previous;
  }

  function open(panelInfo, shouldOpen, moveFocus = true) {
    panelInfo.toggle.setAttribute("aria-expanded", String(shouldOpen));
    panelInfo.panel.hidden = !shouldOpen;
    if (!shouldOpen || !moveFocus) return;
    const field = panelInfo.form.hidden ? null : panelInfo.form.querySelector(
      "label:not([hidden]) input[name='name']"
    );
    field?.focus();
  }

  function renderBirthday() {
    const options = catalog?.birthdayEvents || [];
    selectOptions(birthday.form.elements.eventId, options.map(event => ({
      id: event.id,
      label: [event.name, displayTime(event.startAt)].filter(Boolean).join(" · ")
    })), "Selecione um evento");
    birthday.form.hidden = options.length === 0;
    if (catalog?.birthdayUnavailable) {
      birthday.availability.textContent = "Não foi possível consultar os eventos agora. Tente novamente mais tarde.";
    } else {
      birthday.availability.textContent = options.length > 0 ? "" :
        "Nenhum evento participante está com inscrições abertas neste momento.";
    }
  }

  function minimumAgeFor(list) {
    return Number.isInteger(list?.minimumAge) && list.minimumAge > 0 ? list.minimumAge : null;
  }

  function renderOffDetails() {
    const lists = catalog?.offLists || [];
    const list = lists.find(item => item.id === off.form.elements.listId.value);
    const whatsapp = off.form.elements.whatsapp;
    const code = off.form.elements.code;
    const age = off.form.elements.minimumAgeAccepted;
    const minimumAge = minimumAgeFor(list);
    const eventDate = displayTime(list?.eventStartAt);
    const entryDate = displayTime(list?.entryUntil);
    $("off-event-name").textContent = list?.eventName || "";
    $("off-event-start").textContent = eventDate;
    $("off-description").textContent = list?.description || "";
    $("off-entry").textContent = entryDate ? "Entrada OFF até " + entryDate + "." : "";
    const policyNotice = list?.notice || "";
    const summaryNotice = $("off-summary-notice");
    summaryNotice.textContent = lists.length === 1 ? policyNotice : "";
    summaryNotice.hidden = !summaryNotice.textContent;
    $("off-notice").textContent = lists.length > 1 ? policyNotice : "";

    const minimumAgeText = minimumAge === null ? "" : String(minimumAge);
    if (age.value !== minimumAgeText) age.checked = false;
    age.value = minimumAgeText;
    age.disabled = minimumAge === null;
    age.required = minimumAge !== null;
    $("off-age").hidden = age.disabled;
    $("off-age-label").textContent = age.disabled ? "" : "Declaro que tenho " + minimumAgeText + " anos ou mais.";

    const purchaseUrl = list?.advancePurchaseUrl;
    const hasAdvancePurchase = typeof purchaseUrl === "string" &&
      /^https:\/\/projetoblippy\.vercel\.app\/e\/[a-z0-9-]+$/.test(purchaseUrl);
    $("off-advance").hidden = !hasAdvancePurchase;
    if (hasAdvancePurchase) $("off-advance-link").href = purchaseUrl;
    else $("off-advance-link").removeAttribute("href");
    const showWhatsapp = ["required", "optional"].includes(list?.whatsapp);
    $("off-whatsapp").hidden = !showWhatsapp;
    whatsapp.disabled = !showWhatsapp;
    whatsapp.required = list?.whatsapp === "required";
    if (!showWhatsapp) whatsapp.value = "";
    $("off-code").hidden = !list?.requiresCode;
    code.disabled = !list?.requiresCode;
    code.required = Boolean(list?.requiresCode);
    if (!list?.requiresCode) code.value = "";
  }

  function renderOff() {
    const lists = catalog?.offLists || [];
    off.card.hidden = !privateRoute && lists.length === 0;
    off.form.hidden = lists.length === 0;
    off.toggle.hidden = lists.length === 0;
    $("off-heading").textContent = lists.length === 1 ? lists[0].title : "LISTA OFF";
    $("off-choice").hidden = lists.length < 2;
    selectOptions(off.form.elements.listId, lists.map(item => ({
      id: item.id,
      label: [item.title, displayTime(item.eventStartAt)].filter(Boolean).join(" · ")
    })));
    renderOffDetails();
    if (!lists.length) {
      off.availability.textContent = "Esta lista está indisponível ou as inscrições foram encerradas.";
    } else {
      off.availability.textContent = "";
    }
  }

  async function api(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const options = {
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      mode: "cors",
      signal: controller.signal
    };
    let url = endpoint;
    if (payload) {
      options.method = "POST";
      options.body = new URLSearchParams({payload: JSON.stringify(payload)});
    } else {
      url += "?action=catalog";
    }
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error("Resposta indisponível");
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean") throw new Error("Resposta inválida");
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readCatalog() {
    if (!endpoint || (privateRoute && !/^[A-Za-z0-9_-]{16,128}$/.test(invite))) {
      birthday.availability.textContent = "As inscrições estão indisponíveis neste momento.";
      off.availability.textContent = privateRoute && invite && !endpoint ?
        "As inscrições estão indisponíveis neste momento." :
        "Este convite está indisponível. Confira o endereço recebido.";
      return false;
    }
    retry.hidden = true;
    if (!catalog) {
      birthday.availability.textContent = "Carregando eventos participantes…";
      off.availability.textContent = "Carregando a lista…";
    }
    try {
      const result = await api(privateRoute ? {action: "catalog", invite} : null);
      if (!result.ok) {
        catalog = null;
        renderBirthday();
        renderOff();
        const availability = privateRoute ? off.availability : birthday.availability;
        availability.textContent = result.message || "As inscrições estão indisponíveis neste momento.";
        retry.hidden = privateRoute && ["NOT_FOUND", "CLOSED"].includes(result.code);
        return false;
      }
      if (!Array.isArray(result.birthdayEvents) || !Array.isArray(result.offLists) || !result.challenge) {
        throw new Error("Lista inválida");
      }
      catalog = result;
      catalogAt = Date.now();
      showReference(catalog.referenceMonth);
      renderBirthday();
      renderOff();
      return true;
    } catch {
      catalog = null;
      renderBirthday();
      renderOff();
      const availability = privateRoute ? off.availability : birthday.availability;
      availability.textContent = "Não foi possível carregar as listas. Tente novamente.";
      retry.hidden = false;
      return false;
    }
  }

  function loadCatalog() {
    if (!catalogRequest) catalogRequest = readCatalog().finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  function bindToggle(panelInfo) {
    panelInfo.toggle.addEventListener("click", () => {
      const shouldOpen = panelInfo.panel.hidden;
      open(panelInfo, shouldOpen);
      if (shouldOpen && endpoint && (!catalogAt || Date.now() - catalogAt > 60 * 1000)) void loadCatalog();
    });
  }

  function setFeedback(form, message, state) {
    const feedback = form.querySelector(".list-feedback");
    feedback.textContent = message;
    feedback.dataset.state = state;
    if (state === "success" || state === "error") feedback.focus();
  }

  function payloadFor(type, fields) {
    const payload = {
      type,
      name: fields.get("name")?.trim(),
      privacyAccepted: fields.has("privacyAccepted"),
      website: fields.get("website") || ""
    };
    if (fields.has("whatsapp")) payload.whatsapp = fields.get("whatsapp");
    if (type === "birthday") {
      payload.eventId = fields.get("eventId");
      payload.birthDate = fields.get("birthDate");
    } else {
      const list = catalog?.offLists.find(item => item.id === fields.get("listId"));
      if (!list) return null;
      payload.listId = list.id;
      payload.eventId = list.eventId;
      const minimumAge = minimumAgeFor(list);
      if (minimumAge !== null) {
        payload.minimumAge = minimumAge;
        payload.minimumAgeAccepted = fields.has("minimumAgeAccepted");
      }
      if (fields.has("code")) payload.code = fields.get("code");
      if (privateRoute) payload.invite = invite;
    }
    return payload;
  }

  async function submit(event, type) {
    event.preventDefault();
    const form = event.currentTarget;
    const fieldset = form.querySelector("fieldset");
    const button = form.querySelector("button[type='submit']");
    if (fieldset.disabled) return;

    const payload = payloadFor(type, new FormData(form));
    if (!catalog?.challenge || !payload) {
      setFeedback(form, "Atualize as listas para conferir se as inscrições continuam abertas.", "error");
      void loadCatalog();
      return;
    }
    const signature = JSON.stringify(payload);
    const previous = attempts.get(form);
    const requestId = previous?.signature === signature ? previous.requestId : crypto.randomUUID();
    attempts.set(form, {requestId, signature});

    fieldset.disabled = true;
    button.textContent = "ENVIANDO…";
    form.setAttribute("aria-busy", "true");
    setFeedback(form, "", "");
    try {
      const result = await api({...payload, requestId, challenge: catalog.challenge});
      if (result.ok && typeof result.registrationId === "string" && result.registrationId) {
        const selectedList = form.elements.listId?.value;
        form.reset();
        if (type === "off") {
          form.elements.listId.value = selectedList;
          renderOffDetails();
        }
        attempts.delete(form);
        setFeedback(form, type === "birthday" ?
          "Pronto! Seu nome está na lista de aniversariantes da Duke Haus. Apresente um documento oficial com foto na entrada." :
          result.message || "Pronto! Sua inscrição na Lista OFF foi registrada.", "success");
      } else if (!result.ok) {
        setFeedback(form, result.message || "Não foi possível registrar sua inscrição.", "error");
        if (["CHALLENGE_EXPIRED", "AGE_DECLARATION"].includes(result.code)) void loadCatalog();
      } else {
        throw new Error("Confirmação incompleta");
      }
    } catch {
      setFeedback(form, "Não foi possível confirmar a inscrição. Aguarde alguns instantes e tente novamente com os mesmos dados.", "error");
    } finally {
      fieldset.disabled = false;
      form.removeAttribute("aria-busy");
      button.textContent = "ENVIAR MEU NOME";
    }
  }

  showReference();
  birthday.form.elements.birthDate.max = localDate();
  bindToggle(birthday);
  bindToggle(off);
  retry.addEventListener("click", () => {
    if (!privateRoute) open(birthday, true, false);
    void loadCatalog();
  });
  off.form.elements.listId.addEventListener("change", () => {
    off.form.elements.code.value = "";
    off.form.elements.minimumAgeAccepted.checked = false;
    renderOffDetails();
    setFeedback(off.form, "", "");
  });
  birthday.form.addEventListener("submit", event => void submit(event, "birthday"));
  off.form.addEventListener("submit", event => void submit(event, "off"));
  if (privateRoute) {
    birthday.card.hidden = true;
    off.card.hidden = false;
    off.toggle.hidden = true;
    open(off, true, false);
  }
  window.addEventListener("hashchange", () => {
    const nextRoute = new URLSearchParams(location.hash.slice(1));
    if (nextRoute.has("lista-off") && nextRoute.get("lista-off") !== invite) location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && endpoint && Date.now() - catalogAt > 60 * 1000) void loadCatalog();
  });
  void loadCatalog().then(() => {
    if (privateRoute) $("listas").scrollIntoView({behavior: "instant"});
  });
})();
