const DUKE = Object.freeze({
  timezone: 'America/Sao_Paulo',
  site: 'https://dukehaus.com.br/',
  feed: 'https://dukehaus.com.br/data/events.json',
  spreadsheet: 'DUKE HAUS — LISTAS DE CONVIDADOS',
  sheets: {
    config: 'CONFIGURAÇÕES', events: 'EVENTOS',
    birthday: 'ANIVERSARIANTES', off: 'LISTA OFF'
  },
  config: ['ID da lista', 'Ativa', 'Visibilidade', 'Título', 'Descrição',
    'ID do evento', 'Limite de vagas', 'Abre em', 'Encerra em', 'Entrada OFF até',
    'Código de convite', 'WhatsApp', 'Mensagem de confirmação', 'Token privado', 'Link privado',
    'Idade mínima', 'Aviso da lista', 'Link antecipado da Blipy'],
  events: ['ID do evento', 'Nome na Blipy', 'Início na Blipy', 'Fim na Blipy', 'Status na Blipy',
    'Aniversariantes', 'Limite aniversariantes', 'Encerramento aniversariantes',
    'Nome do evento privado', 'Início do evento privado', 'Fim do evento privado'],
  registration: ['ID da inscrição', 'Nome completo', 'WhatsApp', 'Data de nascimento',
    'Nome do evento', 'ID do evento', 'Data do evento', 'Modalidade', 'Enviada em', 'Status',
    'ID da lista', 'ID do envio', 'Assinatura do envio', 'Identidade', 'Mensagem confirmada'],
  challengeAge: 45 * 60 * 1000,
  birthdayMessage: 'Pronto! Seu nome está na lista de aniversariantes da Duke Haus. Apresente um documento oficial com foto na entrada.',
  offMessage: 'Pronto! Seu nome está na Lista OFF da Duke Haus.'
});
const IDADE_DECLARADA = 'Idade mínima declarada';

/** Execute uma vez no editor vinculado à planilha. Pode ser executada novamente. */
function configurarPlanilha() {
  const spreadsheet = planilhaVinculada_();
  spreadsheet.rename(DUKE.spreadsheet);
  spreadsheet.setSpreadsheetTimeZone(DUKE.timezone);
  spreadsheet.setSpreadsheetLocale('pt_BR');

  // Reaproveita a única aba vazia de uma planilha recém-criada.
  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0 &&
      !spreadsheet.getSheetByName(DUKE.sheets.config)) {
    sheets[0].setName(DUKE.sheets.config);
  }

  const config = prepararAba_(spreadsheet, DUKE.sheets.config, DUKE.config, 15);
  const events = prepararAba_(spreadsheet, DUKE.sheets.events, DUKE.events);
  const birthday = prepararAba_(spreadsheet, DUKE.sheets.birthday, DUKE.registration);
  const off = prepararAba_(spreadsheet, DUKE.sheets.off, [...DUKE.registration, IDADE_DECLARADA], DUKE.registration.length);

  const checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
  const visibility = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pública', 'Privada'], true).setAllowInvalid(false).build();
  const whatsapp = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Oculto', 'Opcional', 'Obrigatório'], true).setAllowInvalid(false).build();

  coluna_(config, 2).setDataValidation(checkbox);
  coluna_(config, 3).setDataValidation(visibility);
  coluna_(config, 12).setDataValidation(whatsapp);
  for (const column of [1, 6, 10, 11, 14]) coluna_(config, column).setNumberFormat('@');
  for (const column of [8, 9]) coluna_(config, column).setNumberFormat('dd/MM/yyyy HH:mm');
  config.getRange(1, 10).setNote('Use uma data e hora de Brasília completas. Também pode digitar HH:mm em texto; um horário anterior à abertura do evento será no dia seguinte.');
  config.getRange(1, 11).setNote('Opcional. O código diferencia maiúsculas de minúsculas.');
  config.getRange(1, 14).setNote('Preenchido pelo menu Duke Haus > Gerar links privados. Limpe o token para girar o link.');
  config.getRange(1, 16).setNote('Informe uma idade inteira (por exemplo, 25). Em branco, não há declaração de idade.');
  config.getRange(1, 17).setNote('Texto curto mostrado no formulário, por exemplo sobre consumação mínima.');
  config.getRange(1, 18).setNote('URL HTTPS individual do evento na Blipy para oferecer compra antecipada.');
  config.hideColumns(14);
  coluna_(config, 16).setNumberFormat('0');
  coluna_(off, 16).setNumberFormat('0');

  // Ausência de regra significa benefício habilitado para eventos da Blipy.
  coluna_(events, 6).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Sim', 'Não'], true).setAllowInvalid(false).build());
  coluna_(events, 1).setNumberFormat('@');
  for (const column of [3, 4, 8, 10, 11]) coluna_(events, column).setNumberFormat('dd/MM/yyyy HH:mm');
  events.getRange(1, 6).setNote('Em branco ou Sim habilita o benefício. Selecione Não para excluir um evento.');
  events.getRange(1, 9).setNote('Para festa fora da Blipy, use um ID exclusivo começando com privado- e preencha as três últimas colunas.');

  for (const sheet of [birthday, off]) {
    for (const column of [1, 2, 3, 5, 6, 8, 10, 11, 12, 13, 14, 15]) {
      coluna_(sheet, column).setNumberFormat('@');
    }
    coluna_(sheet, 4).setNumberFormat('dd/MM/yyyy');
    for (const column of [7, 9]) coluna_(sheet, column).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.hideColumns(12, 4);
  }

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('DUKE_SHEET_ID', spreadsheet.getId());
  if (!properties.getProperty('DUKE_SIGNATURE_KEY')) {
    properties.setProperty('DUKE_SIGNATURE_KEY', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'espelharEventos_')) {
    ScriptApp.newTrigger('espelharEventos_').timeBased().everyMinutes(30).create();
  }
  try {
    espelharEventos_();
  } catch (error) {
    // O site pode ainda não estar publicado. A rotina automática tentará novamente.
    console.warn('Configuração concluída. A programação ainda não foi carregada.');
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Duke Haus')
    .addItem('Atualizar eventos agora', 'atualizarEventos')
    .addItem('Gerar links privados', 'gerarLinksPrivados')
    .addToUi();
}

function atualizarEventos() {
  planilhaVinculada_();
  espelharEventos_();
}

function gerarLinksPrivados() {
  const spreadsheet = planilhaVinculada_();
  const sheet = spreadsheet.getSheetByName(DUKE.sheets.config);
  const site = PropertiesService.getScriptProperties().getProperty('DUKE_SITE_URL') || DUKE.site;
  if (!/^https:\/\/[a-z\d.-]+(?::\d+)?(?:\/[^?#\s]*)?$/i.test(site)) {
    throw new Error('DUKE_SITE_URL deve ser o endereço HTTPS completo do site sem parâmetros ou fragmento.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = linhas_(sheet, DUKE.config.length);
    if (rows.length < 1) return;
    const tokens = new Set();
    const links = rows.map(row => {
      if (!slug_(row[0]) || normalizarTexto_(row[2]) !== 'privada') return ['', ''];
      const token = conviteValido_(row[13]) && !tokens.has(row[13])
        ? row[13] : Utilities.getUuid() + Utilities.getUuid();
      tokens.add(token);
      return [token, site + '#lista-off=' + encodeURIComponent(token)];
    });
    sheet.getRange(2, 14, links.length, 2).setValues(links);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return respostaJson_(() => {
    const parameters = e && e.parameter || {};
    if (parameters.action !== 'catalog') erroPublico_('INVALID_REQUEST', 'Solicitação inválida.');
    return catalogo_('');
  });
}

function doPost(e) {
  return respostaJson_(() => {
    const body = e && e.parameter && e.parameter.payload;
    if (typeof body !== 'string' || body.length > 6000) erroPublico_('INVALID_REQUEST', 'Solicitação inválida.');
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      erroPublico_('INVALID_REQUEST', 'Solicitação inválida.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      erroPublico_('INVALID_REQUEST', 'Solicitação inválida.');
    }
    if (payload.action === 'catalog') {
      if (!conviteValido_(payload.invite)) erroPublico_('NOT_FOUND', 'Lista indisponível.');
      return catalogo_(payload.invite);
    }
    return inscrever_(payload);
  });
}

function respostaJson_(operation) {
  let result;
  try {
    result = operation();
  } catch (error) {
    if (error && error.publicCode) {
      result = { ok: false, code: error.publicCode, message: error.message };
    } else {
      console.error('Falha interna no serviço de listas.');
      result = { ok: false, code: 'UNAVAILABLE', message: 'Não foi possível confirmar agora. Tente novamente.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function erroPublico_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

function catalogo_(invite) {
  const spreadsheet = abrirPlanilha_();
  const now = Date.now();
  const feed = carregarProgramacao_();
  const rules = regrasEventos_(spreadsheet);
  const lists = lerListasOff_(spreadsheet);
  const birthdayEvents = invite || !feed ? [] : [...feed.values()]
    .filter(event => abertoAniversario_(event, rules.get(event.id), now))
    .filter(event => event.start > now)
    .sort((a, b) => a.start - b.start)
    .map(event => ({ id: event.id, name: event.name, startAt: new Date(event.start).toISOString() }));

  const offLists = [];
  for (const list of lists.values()) {
    if (invite ? list.visibility !== 'privada' || !stringsIguais_(list.invite, invite) : list.visibility !== 'publica') continue;
    const event = eventoDaLista_(list.eventId, feed, rules);
    if (!listaAberta_(list, event, now)) continue;
    const entry = limiteEntrada_(list, event);
    offLists.push({
      id: list.id, title: list.title, description: list.description,
      eventId: event.id, eventName: event.name, eventStartAt: new Date(event.start).toISOString(),
      whatsapp: list.whatsapp, requiresCode: Boolean(list.code),
      minimumAge: list.minimumAge, notice: list.notice, advancePurchaseUrl: list.advancePurchaseUrl,
      entryUntil: entry == null ? null : new Date(entry).toISOString()
    });
  }
  offLists.sort((a, b) => a.eventStartAt.localeCompare(b.eventStartAt) || a.title.localeCompare(b.title, 'pt-BR'));
  if (invite && offLists.length === 0) erroPublico_('NOT_FOUND', 'Lista indisponível.');
  return {
    ok: true, referenceMonth: dataLocal_(now, 'yyyy-MM'),
    challenge: criarDesafio_(now), birthdayUnavailable: !feed, birthdayEvents, offLists
  };
}

function inscrever_(payload) {
  const input = dadosInscricao_(payload);
  const timestamp = Date.now();
  const nonce = verificarDesafio_(payload.challenge, timestamp);
  const signature = assinatura_(JSON.stringify(input));
  const spreadsheet = abrirPlanilha_();
  const feed = carregarProgramacao_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) erroPublico_('BUSY', 'Muitos envios ao mesmo tempo. Tente novamente em instantes.');
  try {
    limitarEnvios_(nonce);
    const birthday = spreadsheet.getSheetByName(DUKE.sheets.birthday);
    const off = spreadsheet.getSheetByName(DUKE.sheets.off);
    const all = [...linhas_(birthday, DUKE.registration.length), ...linhas_(off, DUKE.registration.length)];

    const previous = all.find(row => row[11] === input.requestId);
    if (previous) {
      if (rowAtiva_(previous) && stringsIguais_(previous[12], signature)) {
        return { ok: true, registrationId: previous[0], message: previous[14] };
      }
      erroPublico_('DUPLICATE', 'Este envio já foi utilizado. Confira os dados e inicie um novo envio.');
    }

    const now = Date.now();
    const rules = regrasEventos_(spreadsheet);
    const event = eventoDaLista_(input.eventId, feed, rules);
    let capacity, message, sheet, modality, phone;
    let declaredAge = '';
    if (input.type === 'birthday') {
      const rule = rules.get(input.eventId);
      const liveEvent = feed && feed.get(input.eventId);
      if (!feed) erroPublico_('FEED_UNAVAILABLE', 'A programação está temporariamente indisponível.');
      if (!abertoAniversario_(liveEvent, rule, now)) erroPublico_('CLOSED', 'As inscrições para este evento estão encerradas.');
      if (input.birthDate.substring(5, 7) !== dataLocal_(liveEvent.start, 'MM')) {
        erroPublico_('BIRTH_MONTH', 'Seu aniversário deve ser no mesmo mês do evento escolhido.');
      }
      capacity = rule ? rule.birthdayLimit : null;
      message = DUKE.birthdayMessage;
      sheet = birthday;
      modality = 'ANIVERSARIANTES';
      phone = input.whatsapp;
    } else {
      const list = lerListasOff_(spreadsheet).get(input.listId);
      if (!list || list.eventId !== input.eventId || (list.visibility === 'privada' && !stringsIguais_(list.invite, input.invite))) {
        erroPublico_('NOT_FOUND', 'Lista indisponível.');
      }
      if (!event && !feed) erroPublico_('FEED_UNAVAILABLE', 'A programação está temporariamente indisponível.');
      if (!listaAberta_(list, event, now)) erroPublico_('CLOSED', 'As inscrições para esta lista estão encerradas.');
      if (list.minimumAge != null && input.declaredAge !== list.minimumAge) {
        erroPublico_('AGE_DECLARATION', 'Para esta lista, declare que você tem ' + list.minimumAge + ' anos ou mais.');
      }
      if (list.code && !stringsIguais_(list.code, input.code)) erroPublico_('INVALID_CODE', 'Confira o código de convite.');
      if (list.whatsapp === 'required' && !input.whatsapp) erroPublico_('INVALID_WHATSAPP', 'Informe um WhatsApp válido com DDD.');
      capacity = list.limit;
      message = list.message || DUKE.offMessage;
      sheet = off;
      modality = 'LISTA OFF';
      phone = list.whatsapp === 'hidden' ? '' : input.whatsapp;
      declaredAge = list.minimumAge == null ? '' : list.minimumAge;
    }

    const entries = all.filter(row => row[5] === input.eventId && rowAtiva_(row));
    const identity = assinatura_(normalizarTexto_(input.name).replace(/[^\p{L}\p{N}]/gu, ''));
    if (entries.some(row => mesmaPessoa_(row, identity, phone, input.birthDate))) {
      erroPublico_('DUPLICATE', 'Este nome já consta em uma lista para o evento.');
    }
    const used = entries.filter(row => row[7] === modality && row[10] === input.listId).length;
    if (capacity != null && used >= capacity) erroPublico_('FULL', 'As vagas desta lista acabaram.');

    const registrationId = Utilities.getUuid();
    const birth = input.birthDate ? Utilities.parseDate(input.birthDate + ' 12:00', DUKE.timezone, 'yyyy-MM-dd HH:mm') : '';
    const row = [
      registrationId, literal_(input.name), literal_(phone), birth,
      literal_(event.name), literal_(event.id), new Date(event.start), modality, new Date(now), 'CONFIRMADA',
      literal_(input.listId), input.requestId, signature, identity, literal_(message)
    ];
    if (input.type === 'off') row.push(declaredAge);
    const rowNumber = proximaLinha_(sheet);
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    if (sheet.getRange(rowNumber, 1).getValue() !== registrationId) {
      throw new Error('Falha ao conferir a inscrição na planilha.');
    }
    return { ok: true, registrationId, message };
  } finally {
    lock.releaseLock();
  }
}

function dadosInscricao_(payload) {
  const requestId = campo_(payload.requestId, 100);
  const type = payload.type;
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId) || (type !== 'birthday' && type !== 'off') ||
      payload.privacyAccepted !== true || campo_(payload.website, 200)) {
    erroPublico_('INVALID_REQUEST', 'Confira os dados do formulário e tente novamente.');
  }
  const name = campo_(payload.name, 150).replace(/\s+/g, ' ').normalize('NFC');
  if (name.length < 2 || !/\p{L}/u.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
    erroPublico_('INVALID_NAME', 'Informe seu nome completo.');
  }
  const eventId = identificadorEvento_(payload.eventId);
  const listId = type === 'off' ? slug_(payload.listId) : '';
  if (!eventId || (type === 'off' && !listId)) erroPublico_('NOT_FOUND', 'Selecione um evento disponível.');

  const rawPhone = campo_(payload.whatsapp, 40);
  const whatsapp = telefone_(rawPhone);
  if ((type === 'birthday' || rawPhone) && !whatsapp) {
    erroPublico_('INVALID_WHATSAPP', 'Informe um WhatsApp válido com DDD.');
  }
  const birthDate = type === 'birthday' ? campo_(payload.birthDate, 12) : '';
  if (type === 'birthday' && (!dataNascimentoValida_(birthDate) || birthDate > dataLocal_(Date.now(), 'yyyy-MM-dd'))) {
    erroPublico_('INVALID_BIRTH_DATE', 'Informe uma data de nascimento válida.');
  }
  const input = {
    requestId, type, name, eventId, listId, whatsapp, birthDate,
    code: type === 'off' ? campo_(payload.code, 160) : '',
    invite: type === 'off' ? campo_(payload.invite, 120) : ''
  };
  // Mantém a assinatura de envios antigos que não declaram uma idade mínima.
  if (type === 'off' && payload.minimumAgeAccepted === true &&
      Number.isSafeInteger(payload.minimumAge) && payload.minimumAge > 0) {
    input.declaredAge = payload.minimumAge;
  }
  return input;
}

function regrasEventos_(spreadsheet) {
  const rules = new Map();
  for (const row of linhas_(spreadsheet.getSheetByName(DUKE.sheets.events), DUKE.events.length)) {
    const id = identificadorEvento_(row[0]);
    if (!id) continue;
    if (rules.has(id)) {
      rules.set(id, { birthdayEnabled: false, manual: null });
      continue;
    }
    const birthdayLimit = limite_(row[6]);
    const birthdayDeadline = horario_(row[7]);
    const start = horario_(row[9]);
    const end = horario_(row[10]);
    const name = textoConfiguracao_(row[8], 200);
    const validManual = id.startsWith('privado-') && name && Number.isFinite(start) &&
      Number.isFinite(end) && end > start;
    rules.set(id, {
      birthdayEnabled: !['nao', 'false'].includes(normalizarTexto_(row[5])) &&
        !Number.isNaN(birthdayLimit) && !Number.isNaN(birthdayDeadline),
      birthdayLimit, birthdayDeadline,
      manual: validManual ? { id, name, start, end, status: 'scheduled' } : null
    });
  }
  return rules;
}

function lerListasOff_(spreadsheet) {
  const lists = new Map();
  const inviteCounts = new Map();
  const rows = linhas_(spreadsheet.getSheetByName(DUKE.sheets.config), DUKE.config.length);
  for (const row of rows) {
    const id = slug_(row[0]);
    if (!id) continue;
    if (lists.has(id)) {
      lists.set(id, null);
      continue;
    }
    const visibility = normalizarTexto_(row[2]);
    const title = textoConfiguracao_(row[3], 150);
    const eventId = identificadorEvento_(row[5]);
    const limit = limite_(row[6]);
    const opens = horario_(row[7]);
    const closes = horario_(row[8]);
    const entryValue = horaEntradaConfigurada_(row[9]);
    const code = textoConfiguracao_(row[10], 160);
    const whatsapp = { '': 'hidden', oculto: 'hidden', opcional: 'optional', obrigatorio: 'required' }[normalizarTexto_(row[11])];
    const invite = conviteValido_(row[13]) ? row[13] : '';
    const minimumAge = idadeMinima_(row[15]);
    const advancePurchaseUrl = textoConfiguracao_(row[17], 300);
    if (visibility === 'privada' && invite) inviteCounts.set(invite, (inviteCounts.get(invite) || 0) + 1);
    const valid = (row[1] === true || normalizarTexto_(row[1]) === 'sim') &&
      (visibility === 'publica' || (visibility === 'privada' && invite)) && title && eventId &&
      typeof whatsapp === 'string' && ![limit, opens, closes, entryValue, minimumAge].some(Number.isNaN) &&
      (opens == null || closes == null || opens < closes);
    lists.set(id, valid ? {
      id, visibility, title, eventId, limit, opens, closes, entryValue, code, whatsapp, invite, minimumAge,
      description: textoConfiguracao_(row[4], 1600), message: textoConfiguracao_(row[12], 500),
      notice: textoConfiguracao_(row[16], 500),
      advancePurchaseUrl: /^https:\/\/projetoblippy\.vercel\.app\/e\/[A-Za-z0-9_-]+\/?$/.test(advancePurchaseUrl)
        ? advancePurchaseUrl : null
    } : null);
  }
  return new Map([...lists].filter(([, list]) => list &&
    (list.visibility !== 'privada' || inviteCounts.get(list.invite) === 1)));
}

function eventoDaLista_(id, feed, rules) {
  return (feed && feed.get(id)) || (rules.get(id) && rules.get(id).manual) || null;
}

function abertoAniversario_(event, rule, now) {
  if (!event || event.status === 'sold_out' || (rule && !rule.birthdayEnabled)) return false;
  const latest = event.end == null ? event.start : event.end;
  const cutoff = !rule || rule.birthdayDeadline == null ? event.start : rule.birthdayDeadline;
  return now < Math.min(cutoff, latest);
}

function listaAberta_(list, event, now) {
  if (!event || (list.opens != null && now < list.opens)) return false;
  const hardLimit = event.end == null ? event.start : event.end;
  const entry = limiteEntrada_(list, event);
  const deadline = list.closes == null ? event.start : list.closes;
  return now < Math.min(hardLimit, deadline, entry == null ? Infinity : entry);
}

function limiteEntrada_(list, event) {
  if (typeof list.entryValue !== 'string') return list.entryValue;
  const day = dataLocal_(event.start, 'yyyy-MM-dd');
  const time = horario_(day + ' ' + list.entryValue);
  return time >= event.start ? time : time + 24 * 60 * 60 * 1000;
}

function rowAtiva_(row) {
  return normalizarTexto_(row[9]) === 'confirmada';
}

function mesmaPessoa_(row, identity, phone, birthDate) {
  if (!stringsIguais_(row[13], identity)) return false;
  const oldPhone = telefone_(String(row[2] || '').replace(/^'/, ''));
  const oldBirth = row[3] instanceof Date ? dataLocal_(row[3].getTime(), 'yyyy-MM-dd') : '';
  if (oldBirth && birthDate) return oldBirth === birthDate || (phone && oldPhone === phone);
  return !oldPhone || !phone || oldPhone === phone;
}

function criarDesafio_(now) {
  const token = now + '.' + Utilities.getUuid();
  return token + '.' + assinatura_(token);
}

function verificarDesafio_(token, now) {
  const match = typeof token === 'string' && token.match(/^(\d{13})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/i);
  if (!match || !stringsIguais_(assinatura_(match[1] + '.' + match[2]), match[3])) {
    erroPublico_('CHALLENGE_EXPIRED', 'Atualize o formulário e tente novamente.');
  }
  const age = now - Number(match[1]);
  if (age > DUKE.challengeAge || age < 0) erroPublico_('CHALLENGE_EXPIRED', 'O formulário expirou. Atualize e envie novamente.');
  if (age < 2000) erroPublico_('TOO_FAST', 'Aguarde um instante e envie novamente.');
  return match[2];
}

/** Use somente enquanto o bloqueio de inscrição estiver adquirido. */
function limitarEnvios_(nonce) {
  const cache = CacheService.getScriptCache();
  const minute = Math.floor(Date.now() / 60000);
  const globalKey = 'submit:' + minute;
  const challengeKey = globalKey + ':' + nonce;
  const counters = cache.getAll([globalKey, challengeKey]);
  const total = Number(counters[globalKey] || 0);
  const perChallenge = Number(counters[challengeKey] || 0);
  if (total >= 90 || perChallenge >= 8) {
    erroPublico_('RATE_LIMIT', 'Muitas tentativas recentes. Aguarde um minuto e tente novamente.');
  }
  cache.putAll({ [globalKey]: String(total + 1), [challengeKey]: String(perChallenge + 1) }, 70);
}

function assinatura_(value) {
  const key = PropertiesService.getScriptProperties().getProperty('DUKE_SIGNATURE_KEY');
  if (!key) throw new Error('Execute a configuração da planilha.');
  return Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8)
    .map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function stringsIguais_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function carregarProgramacao_() {
  const cache = CacheService.getScriptCache();
  const url = PropertiesService.getScriptProperties().getProperty('DUKE_EVENT_FEED_URL') || DUKE.feed;
  const cacheKey = 'programacao-v1:' + assinatura_(url).slice(0, 24);
  try {
    const cached = cache.get(cacheKey);
    if (cached) return new Map(JSON.parse(cached));

    if (!/^https:\/\//i.test(url)) throw new Error('A programação deve ser acessível via HTTPS.');
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() !== 200) {
      console.error('A programação do site retornou HTTP ' + response.getResponseCode() + '.');
      return null;
    }
    const data = JSON.parse(response.getContentText());
    if (data.schemaVersion !== 1 || !Array.isArray(data.events)) throw new Error('Programação inválida.');
    const events = new Map();
    for (const item of data.events) {
      if (!item || typeof item !== 'object') throw new Error('Evento inválido.');
      const id = identificadorEvento_(item.id);
      const name = textoConfiguracao_(item.name, 200);
      const start = instanteIso_(item.startAt);
      const end = item.endAt == null ? null : instanteIso_(item.endAt);
      if (!id || !name || !Number.isFinite(start) || (end != null && (!Number.isFinite(end) || end <= start)) || events.has(id)) {
        throw new Error('Evento inválido ou duplicado na programação.');
      }
      if (['canceled', 'cancelled', 'completed'].includes(item.status)) continue;
      if (!['scheduled', 'unknown', 'sold_out'].includes(item.status)) throw new Error('Status de evento desconhecido.');
      events.set(id, { id, name, start, end, status: item.status });
    }
    const snapshot = JSON.stringify([...events]);
    if (snapshot.length < 20000) cache.put(cacheKey, snapshot, 90);
    return events;
  } catch (error) {
    console.error('Não foi possível ler a programação do site.');
    return null;
  }
}

function espelharEventos_() {
  const feed = carregarProgramacao_();
  if (!feed) throw new Error('A programação do site está indisponível.');
  const spreadsheet = abrirPlanilha_();
  const sheet = spreadsheet.getSheetByName(DUKE.sheets.events);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = linhas_(sheet, DUKE.events.length);
    const seen = new Set();
    const mirror = current.map(row => {
      const id = identificadorEvento_(row[0]);
      if (!id || id.startsWith('privado-')) return row.slice(1, 5);
      seen.add(id);
      const event = feed.get(id);
      if (!event) return [row[1], row[2], row[3], 'Fora da programação'];
      return colunasEspelho_(event);
    });
    if (mirror.length) sheet.getRange(2, 2, mirror.length, 4).setValues(mirror);
    for (const event of feed.values()) {
      if (!seen.has(event.id)) {
        sheet.getRange(proximaLinha_(sheet), 1, 1, 5).setValues([[literal_(event.id), ...colunasEspelho_(event)]]);
      }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function colunasEspelho_(event) {
  const statuses = { scheduled: 'Programado', sold_out: 'Esgotado', unknown: 'Sem status informado' };
  return [literal_(event.name), new Date(event.start), event.end == null ? '' : new Date(event.end), statuses[event.status]];
}

function planilhaVinculada_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Abra a planilha e acesse Extensões > Apps Script.');
  return spreadsheet;
}

function abrirPlanilha_() {
  const id = PropertiesService.getScriptProperties().getProperty('DUKE_SHEET_ID');
  if (!id) throw new Error('Execute configurarPlanilha no projeto vinculado.');
  return SpreadsheetApp.openById(id);
}

function prepararAba_(spreadsheet, name, headers, colunasExistentes = headers.length) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const columns = sheet.getMaxColumns();
  if (columns < headers.length) sheet.insertColumnsAfter(columns, headers.length - columns);
  const range = sheet.getRange(1, 1, 1, headers.length);
  if (sheet.getLastRow() > 0 && !range.getValues()[0].every((label, i) =>
    label === headers[i] || (i >= colunasExistentes && label === ''))) {
    throw new Error('Os cabeçalhos da aba ' + name + ' foram alterados. Revise a integração antes de continuar.');
  }
  range.setValues([headers]).setFontWeight('bold').setBackground('#181818').setFontColor('#ffffff').setWrap(true);
  sheet.setFrozenRows(1);
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  return sheet;
}

function coluna_(sheet, column) {
  return sheet.getRange(2, column, sheet.getMaxRows() - 1, 1);
}

function linhas_(sheet, width) {
  if (!sheet) throw new Error('Execute configurarPlanilha.');
  const lastRow = sheet.getLastRow();
  return lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
}

function proximaLinha_(sheet) {
  const next = Math.max(2, sheet.getLastRow() + 1);
  if (next >= sheet.getMaxRows()) sheet.insertRowsBefore(sheet.getMaxRows(), 200);
  return next;
}

function dataLocal_(value, format) {
  return Utilities.formatDate(new Date(value), DUKE.timezone, format);
}

function campo_(value, limit) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit) erroPublico_('INVALID_REQUEST', 'Confira os dados informados.');
  return value.trim();
}

function textoConfiguracao_(value, limit) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function normalizarTexto_(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function extrairIdentificador_(value, pattern) {
  return typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : '';
}

function identificadorEvento_(value) {
  return extrairIdentificador_(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
}

function slug_(value) {
  return extrairIdentificador_(value, /^[a-z0-9][a-z0-9_-]{0,99}$/);
}

function conviteValido_(value) {
  return typeof value === 'string' && /^[a-f0-9-]{72}$/i.test(value);
}

function telefone_(value) {
  if (!/^[+\d ().-]*$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return '+' + digits;
  if (/^55[1-9]\d[2-9]\d{7,8}$/.test(digits)) return '+' + digits;
  if (/^[1-9]\d[2-9]\d{7,8}$/.test(digits)) return '+55' + digits;
  return '';
}

function dataNascimentoValida_(date) {
  if (!/^(?:19|20)\d\d-\d\d-\d\d$/.test(date)) return false;
  const stamp = Date.parse(date + 'T12:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().substring(0, 10) === date;
}

function instanteIso_(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? Date.parse(value) : NaN;
}

function horario_(value) {
  if (value === '' || value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return NaN;
  const iso = instanteIso_(value);
  if (Number.isFinite(iso)) return iso;
  let local = value.trim();
  const br = local.match(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d)$/);
  if (br) local = br[3] + '-' + br[2] + '-' + br[1] + ' ' + br[4];
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(local)) return NaN;
  try {
    const parsed = Utilities.parseDate(local, DUKE.timezone, 'yyyy-MM-dd HH:mm').getTime();
    return dataLocal_(parsed, 'yyyy-MM-dd HH:mm') === local ? parsed : NaN;
  } catch (error) {
    return NaN;
  }
}

function horaEntradaConfigurada_(value) {
  if (value instanceof Date && dataLocal_(value.getTime(), 'yyyy') < '1901') {
    return dataLocal_(value.getTime(), 'HH:mm');
  }
  if (typeof value === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value.trim())) return value.trim().padStart(5, '0');
  return horario_(value);
}

function limite_(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
}

function idadeMinima_(value) {
  if (typeof value === 'number') return limite_(value);
  const text = textoConfiguracao_(value, 30);
  if (!text) return null;
  return /^\d+$/.test(text) ? limite_(text) : NaN;
}

function literal_(value) {
  return /^[=+\-@']/.test(value) ? "'" + value : value;
}
