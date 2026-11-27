import { strict as assert } from 'node:assert';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const feed = [
  { id: 'nov-27', name: 'Festa sexta', startAt: '2026-11-27T23:00:00-03:00', endAt: '2026-11-28T05:00:00-03:00', status: 'scheduled' },
  { id: 'nov-28', name: 'Festa sábado', startAt: '2026-11-28T23:00:00-03:00', endAt: '2026-11-29T05:00:00-03:00', status: 'scheduled' },
  { id: 'dez-01', name: 'Festa dezembro', startAt: '2026-12-01T23:00:00-03:00', endAt: null, status: 'unknown' },
  { id: 'cancelada', name: 'Festa cancelada', startAt: '2026-11-28T23:00:00-03:00', endAt: null, status: 'cancelled' }
];

function harness() {
  let now = Date.parse('2026-11-26T01:00:00Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  const props = new Map([['DUKE_SIGNATURE_KEY', 'local-only'], ['DUKE_SHEET_ID', 'fixture']]);
  const cached = new Map();
  const sheets = new Map();
  let held = false;
  let failFlush = false;
  let fetchStatus = 200;
  let lastWrite;
  let sourceEvents = feed;
  let trigger;
  let title;
  let timezone;
  let locale;
  const triggers = [];
  const logs = [];
  const passThroughRangeMethods = ['setFontWeight', 'setBackground', 'setFontColor',
    'setWrap', 'createFilter', 'setDataValidation', 'setNumberFormat', 'setNote'];

  class FakeSheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
      this.maximumRows = 1000;
      this.maximumColumns = 26;
    }

    getLastRow() {
      let last = this.rows.length;
      while (last > 0 && !this.rows[last - 1].some(value => value !== '' && value != null)) last--;
      return last;
    }

    getMaxRows() { return this.maximumRows; }
    getMaxColumns() { return this.maximumColumns; }
    insertColumnsAfter(column, count) {
      assert.equal(column, this.maximumColumns);
      this.maximumColumns += count;
    }
    insertRowsBefore(row, count) {
      this.rows.splice(row - 1, 0, ...Array.from({ length: count }, () => []));
      this.maximumRows += count;
    }
    setFrozenRows() {}
    hideColumns() {}
    getFilter() { return null; }
    setName(name) {
      sheets.delete(this.name);
      this.name = name;
      sheets.set(name, this);
    }
    getRange(row, column, height = 1, width = 1) {
      assert.ok(column + width - 1 <= this.maximumColumns, 'intervalo dentro da grade');
      const read = () => Array.from({ length: height }, (_, rowOffset) =>
        Array.from({ length: width }, (_, columnOffset) =>
          this.rows[row + rowOffset - 1]?.[column + columnOffset - 1] ?? ''));
      const range = {
        getValues: read,
        getValue: () => read()[0][0],
        setValues: (values) => {
          assert.equal(values.length, height);
          if (row > 1 && ['ANIVERSARIANTES', 'LISTA OFF'].includes(this.name)) {
            assert.equal(held, true, 'registro deve ser escrito com lock');
            lastWrite = values[0];
          }
          values.forEach((entries, rowOffset) => {
            assert.equal(entries.length, width);
            while (this.rows.length < row + rowOffset) this.rows.push([]);
            entries.forEach((entry, columnOffset) => {
              this.rows[row + rowOffset - 1][column + columnOffset - 1] =
                typeof entry === 'string' && entry.startsWith("'") ? entry.slice(1) : entry;
            });
          });
          return range;
        }
      };
      for (const method of passThroughRangeMethods) range[method] = () => range;
      return range;
    }
  }

  function insert(name) {
    const sheet = new FakeSheet(name);
    sheets.set(name, sheet);
    return sheet;
  }

  const workbook = {
    getId: () => 'fixture',
    getSheetByName: name => sheets.get(name),
    getSheets: () => [...sheets.values()],
    insertSheet: insert,
    rename: value => { title = value; },
    setSpreadsheetTimeZone: value => { timezone = value; },
    setSpreadsheetLocale: value => { locale = value; }
  };

  function formatDate(date, zone, format) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(({ type, value }) => [type, value]));
    return format.replace(/yyyy|MM|dd|HH|mm/g, key =>
      ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute }[key]));
  }

  const lock = {
    tryLock: () => { if (held) return false; held = true; return true; },
    waitLock: () => assert.equal(lock.tryLock(), true),
    releaseLock: () => { held = false; }
  };

  const bucket = {
    get: key => cached.get(key),
    put: (key, value) => cached.set(key, value),
    getAll: keys => Object.fromEntries(keys.map(key => [key, cached.get(key)])),
    putAll: values => Object.entries(values).forEach(([key, value]) => cached.set(key, value))
  };
  const validation = {
    requireCheckbox: () => validation, requireValueInList: () => validation,
    setAllowInvalid: () => validation, build: () => validation
  };
  const schedule = {
    timeBased: () => schedule,
    everyMinutes: minutes => { assert.equal(minutes, 30); return schedule; },
    create: () => triggers.push({ getHandlerFunction: () => trigger })
  };

  const context = createContext({
    Date: ClockDate,
    console: { warn: message => logs.push(message), error: message => logs.push(message) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => workbook,
      openById: id => { assert.equal(id, 'fixture'); return workbook; },
      newDataValidation: () => validation,
      flush: () => { if (failFlush) throw Error('fixture: write completed before lost acknowledgement'); }
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: name => { trigger = name; return schedule; }
    },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => bucket },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => props.get(key),
        setProperty: (key, value) => props.set(key, value)
      })
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      formatDate,
      parseDate: (value, zone) => {
        // As datas de configuração usadas pelo fixture estão em BRT (UTC-03).
        assert.equal(zone, 'America/Sao_Paulo');
        return new ClockDate(value.replace(' ', 'T') + ':00-03:00');
      },
      computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()],
      getUuid: randomUUID
    },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => fetchStatus,
        getContentText: () => JSON.stringify({ schemaVersion: 1, events: sourceEvents })
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: output => ({
        setMimeType(type) {
          assert.equal(type, 'application/json');
          return output;
        }
      })
    }
  });

  runInContext(code, context);
  insert('Página1');
  context.configurarPlanilha();
  const config = sheets.get('CONFIGURAÇÕES').rows;
  const eventRules = sheets.get('EVENTOS').rows;

  return {
    context, config, eventRules, workbook, triggers, logs,
    setup: () => ({ title, timezone, locale }),
    registrations: name => sheets.get(name).rows.slice(1),
    write: () => lastWrite,
    clock: time => { now = Date.parse(time); },
    wait: (delay = 2500) => { now += delay; },
    changeFeed: (events, status = 200) => { sourceEvents = events; fetchStatus = status; cached.clear(); },
    setBusy: isBusy => { held = isBusy; },
    setFlushFailure: failure => { failFlush = failure; },
    get: (parameters = { action: 'catalog' }) => JSON.parse(context.doGet({ parameter: parameters })),
    post: data => JSON.parse(context.doPost({ parameter: { payload: JSON.stringify(data) } }))
  };
}

function publicList(options = {}) {
  const {
    id = 'sexta-off', active = true, visibility = 'Pública', eventId = 'nov-27', limit = 1,
    opens = '2026-11-25 18:00', closes = '2026-11-27 22:00', entry = '00:30',
    code = 'CONVIDADO', whatsapp = 'Opcional', token = '', message = 'Nome confirmado na lista de teste.',
    minimumAge = '', notice = '', advanceUrl = ''
  } = options;
  return [id, active, visibility, 'Festa teste OFF', 'Descrição da lista', eventId, limit,
    opens, closes, entry, code, whatsapp, message, token, '', minimumAge, notice, advanceUrl];
}

function birthday(challenge, overrides = {}) {
  return {
    requestId: randomUUID(), type: 'birthday', eventId: 'nov-27', name: 'Ana da Silva',
    whatsapp: '(11) 91234-5678', birthDate: '1995-11-05', website: '', privacyAccepted: true,
    challenge, ...overrides
  };
}

function off(challenge, overrides = {}) {
  return {
    requestId: randomUUID(), type: 'off', eventId: 'nov-27', listId: 'sexta-off',
    name: 'Joana Santos', whatsapp: '', code: 'CONVIDADO', website: '', privacyAccepted: true,
    challenge, ...overrides
  };
}

test('prepara planilha privada, Brasília, gatilho único e dois eventos de novembro no catálogo', () => {
  const app = harness();
  assert.deepEqual(app.setup(), {
    title: 'DUKE HAUS — LISTAS DE CONVIDADOS', timezone: 'America/Sao_Paulo', locale: 'pt_BR'
  });
  assert.deepEqual(app.workbook.getSheets().map(sheet => sheet.name),
    ['CONFIGURAÇÕES', 'EVENTOS', 'ANIVERSARIANTES', 'LISTA OFF']);
  assert.equal(app.triggers.length, 1);
  app.context.configurarPlanilha();
  assert.equal(app.triggers.length, 1);
  const result = app.get();
  assert.equal(result.referenceMonth, '2026-11');
  assert.deepEqual(result.birthdayEvents.map(event => event.id), ['nov-27', 'nov-28', 'dez-01']);
  assert.deepEqual(result.offLists, []);
});

test('valida mês do evento em Brasília, grava telefone/data e repete a confirmação sem nova linha', () => {
  const app = harness();
  const { challenge } = app.get();
  app.wait();
  assert.equal(app.post(birthday(challenge, { birthDate: '1995-10-05' })).code, 'BIRTH_MONTH');
  assert.equal(app.post(birthday(challenge, { birthDate: '1995-11-31' })).code, 'INVALID_BIRTH_DATE');
  assert.equal(app.post(birthday(challenge, { whatsapp: '123' })).code, 'INVALID_WHATSAPP');
  const input = birthday(challenge, { name: "=EXEMPLO de teste" });
  const first = app.post(input);
  assert.equal(first.ok, true);
  assert.equal(app.write()[1], "'=EXEMPLO de teste");
  assert.equal(app.registrations('ANIVERSARIANTES')[0][2], '+5511912345678');
  assert.equal(app.registrations('ANIVERSARIANTES')[0][0], first.registrationId);
  assert.deepEqual(app.post(input), first);
  assert.equal(app.post({ ...input, name: 'Outra Pessoa' }).code, 'DUPLICATE');
  assert.equal(app.post({ ...input, requestId: randomUUID() }).code, 'DUPLICATE');
  assert.equal(app.registrations('ANIVERSARIANTES').length, 1);

  const december = app.post(birthday(challenge, { eventId: 'dez-01', birthDate: '1995-12-05' }));
  assert.equal(december.ok, true, 'o mês do evento prevalece antes da virada do mês');
});

test('respeita limites, regras e encerramento dos aniversariantes', () => {
  const app = harness();
  const firstRule = app.eventRules.find(row => row[0] === 'nov-27');
  firstRule[6] = 1;
  firstRule[7] = '2026-11-27 22:20';
  const secondRule = app.eventRules.find(row => row[0] === 'nov-28');
  secondRule[5] = 'Não';

  const catalog = app.get();
  assert.deepEqual(catalog.birthdayEvents.map(event => event.id), ['nov-27', 'dez-01']);
  app.wait();
  assert.equal(app.post(birthday(catalog.challenge, { eventId: 'nov-28' })).code, 'CLOSED');
  assert.equal(app.post(birthday(catalog.challenge)).ok, true);
  assert.equal(app.post(birthday(catalog.challenge, { name: 'Pessoa Outra', whatsapp: '+5511912345679' })).code, 'FULL');
  app.clock('2026-11-27T22:20:00-03:00');
  assert.equal(app.get().birthdayEvents.some(event => event.id === 'nov-27'), false);
});

test('Lista OFF pública e privada, código somente no servidor e horário da porta no dia seguinte', () => {
  const app = harness();
  app.config.push(publicList(), publicList({ id: 'privada', visibility: 'Privada', code: 'SECRETO' }));
  app.context.gerarLinksPrivados();
  const privateRow = app.config[2];
  const invite = privateRow[13];
  assert.match(privateRow[14], /^https:\/\/dukehaus\.com\.br\/#lista-off=/);
  assert.ok(!privateRow[14].includes('SECRETO'));
  const publicEntries = app.get().offLists;
  assert.deepEqual(publicEntries.map(entry => entry.id), ['sexta-off']);
  assert.deepEqual(app.get({ action: 'catalog', invite }).offLists, publicEntries);
  assert.equal(publicEntries[0].entryUntil, '2026-11-28T03:30:00.000Z');
  assert.equal(app.post({ action: 'catalog', invite: 'x' }).code, 'NOT_FOUND');
  const privateCatalog = app.post({ action: 'catalog', invite });
  assert.equal(privateCatalog.offLists[0].id, 'privada');
  assert.deepEqual(privateCatalog.birthdayEvents, []);
  assert.equal(privateCatalog.offLists[0].requiresCode, true);
  assert.ok(!JSON.stringify(privateCatalog).includes('SECRETO'));
  assert.ok(!JSON.stringify(privateCatalog).includes(invite));

  app.wait();
  const input = off(privateCatalog.challenge, { listId: 'privada', invite });
  assert.equal(app.post({ ...input, invite: '' }).code, 'NOT_FOUND');
  assert.equal(app.post(input).code, 'INVALID_CODE');
  assert.equal(app.post({ ...input, code: 'SECRETO' }).ok, true);
  assert.equal(app.registrations('LISTA OFF').length, 1);
});

test('última vaga exige lock e é atribuída uma só vez; sucesso depende da confirmação', () => {
  const app = harness();
  app.config.push(publicList({ whatsapp: 'Obrigatório' }));
  const { challenge } = app.get();
  app.wait();
  assert.equal(app.post(off(challenge)).code, 'INVALID_WHATSAPP');
  const input = off(challenge, { whatsapp: '+5511912345678' });

  app.setBusy(true);
  assert.equal(app.post(input).code, 'BUSY');
  app.setBusy(false);
  assert.equal(app.registrations('LISTA OFF').length, 0);

  app.setFlushFailure(true);
  assert.equal(app.post(input).ok, false);
  assert.equal(app.registrations('LISTA OFF').length, 1);
  app.setFlushFailure(false);
  assert.equal(app.post(input).registrationId, app.registrations('LISTA OFF')[0][0]);
  assert.equal(app.post(off(challenge, { name: 'Outra Pessoa', whatsapp: '+5511912345679' })).code, 'FULL');
  assert.equal(app.registrations('LISTA OFF').length, 1);
  assert.ok(app.logs.every(log => !log.includes('Joana Santos') && !log.includes('912345678')));
});

test('fechamento, desativação e indisponibilidade da programação preservam lista manual privada', () => {
  const app = harness();
  app.config.push(publicList(), publicList({ id: 'inativa', active: false }));
  app.config.push(publicList({ id: 'manual', eventId: 'privado-1', visibility: 'Privada', whatsapp: 'Oculto', code: '' }));
  app.eventRules.push(['privado-1', '', '', '', '', '', '', '', 'Festa particular',
    '2026-11-27 23:00', '2026-11-28 05:00']);
  app.context.gerarLinksPrivados();
  const invite = app.config[3][13];

  assert.deepEqual(app.get().offLists.map(item => item.id), ['sexta-off']);
  app.clock('2026-11-27T22:00:00-03:00');
  const closed = app.get();
  assert.deepEqual(closed.offLists, []);
  app.wait();
  assert.equal(app.post(off(closed.challenge)).code, 'CLOSED');

  app.clock('2026-11-27T21:30:00-03:00');
  app.changeFeed([], 503);
  const privateCatalog = app.post({ action: 'catalog', invite });
  assert.equal(privateCatalog.birthdayUnavailable, true);
  assert.equal(privateCatalog.offLists[0].eventName, 'Festa particular');
  app.wait();
  assert.equal(app.post(birthday(privateCatalog.challenge)).code, 'FEED_UNAVAILABLE');
  assert.equal(app.post(off(privateCatalog.challenge, {
    eventId: 'privado-1', listId: 'manual', invite, whatsapp: '+5511912345678', code: ''
  })).ok, true);
  assert.equal(app.registrations('LISTA OFF')[0][2], '');
});

test('defesas anti-automação, janela expirada e catálogo com programação atualizada', () => {
  const app = harness();
  const { challenge } = app.get();
  assert.equal(app.post(birthday(challenge)).code, 'TOO_FAST');
  app.wait();
  assert.equal(app.post(birthday(challenge, { website: 'spam.test' })).code, 'INVALID_REQUEST');
  assert.equal(app.post(birthday(challenge, { privacyAccepted: false })).code, 'INVALID_REQUEST');
  for (let i = 0; i < 8; i++) {
    assert.equal(app.post(birthday(challenge, { birthDate: '1990-01-01' })).code, 'BIRTH_MONTH');
  }
  assert.equal(app.post(birthday(challenge)).code, 'RATE_LIMIT');
  app.wait(46 * 60 * 1000);
  assert.equal(app.post(birthday(challenge)).code, 'CHALLENGE_EXPIRED');
  app.changeFeed([feed[1]]);
  assert.deepEqual(app.get().birthdayEvents.map(item => item.id), ['nov-28']);
  app.context.atualizarEventos();
  assert.equal(app.eventRules.find(row => row[0] === 'nov-27')[4], 'Fora da programação');
});

test('Lista OFF até 00h30 exige declaração de 25+, exibe aviso/link e só registra o limite declarado', () => {
  const app = harness();
  const officialLink = 'https://projetoblippy.vercel.app/e/ferias-proibidas-noite-sem-regras';
  app.config.push(publicList({
    limit: null, closes: '28/11/2026 00:30', code: '', minimumAge: 25,
    notice: 'Essa Lista OFF tem consumação mínima de R$ 30.', advanceUrl: officialLink
  }));
  app.clock('2026-11-28T00:20:00-03:00');
  const catalog = app.get();
  assert.equal(catalog.offLists[0].minimumAge, 25);
  assert.equal(catalog.offLists[0].notice, 'Essa Lista OFF tem consumação mínima de R$ 30.');
  assert.equal(catalog.offLists[0].advancePurchaseUrl, officialLink);
  assert.equal(catalog.offLists[0].entryUntil, '2026-11-28T03:30:00.000Z');
  app.wait();
  const input = off(catalog.challenge, { code: '' });
  assert.equal(app.post(input).code, 'AGE_DECLARATION');
  assert.equal(app.post({ ...input, minimumAge: 24, minimumAgeAccepted: true }).code, 'AGE_DECLARATION');
  assert.equal(app.post({ ...input, minimumAge: 25, minimumAgeAccepted: 'true' }).code, 'AGE_DECLARATION');
  assert.equal(app.registrations('LISTA OFF').length, 0);
  const accepted = { ...input, minimumAge: 25, minimumAgeAccepted: true };
  const receipt = app.post(accepted);
  assert.equal(receipt.ok, true);
  assert.equal(app.registrations('LISTA OFF')[0][3], '');
  assert.equal(app.registrations('LISTA OFF')[0][15], 25);
  assert.deepEqual(app.post(accepted), receipt);
  app.clock('2026-11-28T00:30:00-03:00');
  assert.deepEqual(app.get().offLists, []);
  assert.equal(app.post(off(catalog.challenge, { minimumAge: 25, minimumAgeAccepted: true })).code, 'CLOSED');
});

test('atualização da planilha preserva cabeçalhos originais, regras e recibo de envios anteriores', () => {
  const app = harness();
  app.config.push(publicList().slice(0, 15));
  const catalog = app.get();
  assert.equal(catalog.offLists[0].minimumAge, null);
  app.wait();
  const input = off(catalog.challenge);
  const receipt = app.post(input);
  assert.equal(receipt.ok, true);
  const configSheet = app.workbook.getSheetByName('CONFIGURAÇÕES');
  const offSheet = app.workbook.getSheetByName('LISTA OFF');
  for (const sheet of [configSheet, offSheet]) {
    sheet.maximumColumns = 15;
    sheet.rows.forEach(row => { row.length = Math.min(row.length, 15); });
  }
  const oldRows = offSheet.rows.map(row => row.slice());
  app.context.configurarPlanilha();
  assert.deepEqual(app.config[0].slice(15),
    ['Idade mínima', 'Aviso da lista', 'Link antecipado da Blipy']);
  assert.equal(offSheet.rows[0][15], 'Idade mínima declarada');
  assert.deepEqual(offSheet.rows.map(row => row.slice(0, 15)), oldRows);
  assert.equal(app.triggers.length, 1);
  assert.deepEqual(app.post(input), receipt);
  app.config[1][17] = 'https://projetoblippy.vercel.app.evil.example/e/ferias-proibidas-noite-sem-regras';
  assert.equal(app.get().offLists[0].advancePurchaseUrl, null);
  app.config[1][15] = 'vinte e cinco';
  assert.deepEqual(app.get().offLists, []);
});
