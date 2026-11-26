#!/usr/bin/env python3
"""Build the public Duke Haus feed from Blipy's public event pages."""

import argparse
import json
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo


BLIPY = "https://projetoblippy.vercel.app"
ORGANIZER = BLIPY + "/organizador/duke-haus"
BRASILIA = ZoneInfo("America/Sao_Paulo")
EVENT_LINK = re.compile(re.escape(BLIPY) + r"/e/([a-z0-9-]+)\Z")
MEDIA_LINK = re.compile(re.escape(BLIPY) + r"/api/midia/[a-z0-9-]+\Z")
MONTHS = dict(zip("jan fev mar abr mai jun jul ago set out nov dez".split(), range(1, 13)))
DATE_LABEL = re.compile(r"(\d{1,2}) de ([a-z]{3})\.? de (\d{4}), às (\d{2}):(\d{2})", re.I)
END_LABEL = re.compile(r"\(até (\d{2}):(\d{2})\)", re.I)
PRICE_LABEL = re.compile(r"\bR\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\b")
ACTIVE_COUNT = re.compile(r"(\d+) eventos? à venda\Z", re.I)
EMPTY_NOTICE = re.compile(r"(?:nenhum|sem) (?:próximo )?eventos?\b", re.I)
EMPTY_COUNT = re.compile(r"nenhum evento à venda[.!]?\Z", re.I)
CANCELED_NOTICE = re.compile(r"(?:evento )?cancelad[oa][.!]?\Z", re.I)
ENDED_NOTICE = re.compile(r"(?:evento )?(?:encerrado|finalizado)[.!]?\Z", re.I)
SOLD_OUT_NOTICE = re.compile(r"(?:ingressos )?esgotados?[.!]?\Z", re.I)
VOID_TAGS = frozenset("area base br col embed hr img input link meta param source track wbr".split())
OMITTED_TAGS = frozenset({"script", "style", "svg", "template"})
MAX_PAGE_BYTES = 2_000_000
MAX_EVENTS = 40


class SyncError(Exception):
    pass


@dataclass
class Element:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def find(self, tag):
        for child in self.children:
            if isinstance(child, Element):
                if child.tag == tag:
                    yield child
                yield from child.find(tag)

    def text(self):
        return " ".join("".join(self.text_parts()).split())

    def text_parts(self):
        for child in self.children:
            if isinstance(child, Element):
                if child.tag in {"p", "div", "li", "br"}:
                    yield " "
                yield from child.text_parts()
                if child.tag in {"p", "div", "li"}:
                    yield " "
            else:
                yield child


class PublicMarkup(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]
        self.omitted_tag = None
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        if self.omitted_tag:
            return
        if tag in OMITTED_TAGS:
            self.omitted_tag = tag
            return
        element = Element(tag, dict(attrs))
        self.stack[-1].children.append(element)
        if tag not in VOID_TAGS:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.omitted_tag:
            if tag == self.omitted_tag:
                self.omitted_tag = None
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if not self.omitted_tag:
            self.stack[-1].children.append(data)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_html(url):
    req = Request(url, headers={
        "Accept": "text/html",
        "User-Agent": "DukeHaus-Agenda/1.0 (+https://dukehaus.com.br/)",
    })
    try:
        with build_opener(NoRedirect()).open(req, timeout=15) as response:
            if response.headers.get_content_type() != "text/html":
                raise SyncError(f"Resposta inesperada ao consultar {url}.")
            payload = response.read(MAX_PAGE_BYTES + 1)
    except (OSError, ValueError) as error:
        raise SyncError(f"Falha ao consultar {url}: {error}") from error
    if len(payload) > MAX_PAGE_BYTES:
        raise SyncError(f"Página acima do limite ao consultar {url}.")
    try:
        return payload.decode("utf-8")
    except UnicodeError as error:
        raise SyncError(f"Codificação inesperada ao consultar {url}.") from error


def metadata(page, key):
    return next(((tag.attrs.get("content") or "").strip() for tag in page.find("meta")
                 if key in (tag.attrs.get("name"), tag.attrs.get("property"))), "")


def event_cards(html):
    page = PublicMarkup(html).root
    canonical = any(tag.attrs.get("href") == ORGANIZER and tag.attrs.get("rel") == "canonical"
                    for tag in page.find("link"))
    profile = any(tag.text().casefold() == "duke haus" for tag in page.find("h1"))
    if not canonical or not profile:
        raise SyncError("A página da Duke Haus na Blipy mudou ou está incompleta.")

    counts = {int(match[1]) for tag in page.find("span") if (match := ACTIVE_COUNT.fullmatch(tag.text()))}
    if any(EMPTY_COUNT.fullmatch(tag.text()) for tag in page.find("span")):
        counts.add(0)
    if len(counts) > 1:
        raise SyncError("A Blipy exibiu totais de eventos conflitantes.")
    count = next(iter(counts), None)

    section = next((tag for tag in page.find("section") if tag.attrs.get("aria-labelledby") == "proximos"), None)
    if section is None:
        if count == 0:
            return {}
        raise SyncError("A seção de próximos eventos está ausente na Blipy.")

    cards = {}
    for link in section.find("a"):
        href = link.attrs.get("href") or ""
        url = urljoin(BLIPY, href)
        if EVENT_LINK.fullmatch(url):
            article = next(link.find("article"), None)
            if article is None or not any(tag.text() for tag in article.find("h3")):
                raise SyncError("O formato de um card de evento mudou.")
            cards[url] = article

    if not cards:
        if count == 0 or (count is None and any(EMPTY_NOTICE.match(tag.text()) for tag in section.find("p"))):
            return {}
        raise SyncError("A seção retornou vazia sem indicação de que a programação terminou.")
    if count is not None and count != len(cards):
        raise SyncError("O total de eventos anunciado pela Blipy diverge dos cards encontrados.")
    if len(cards) > MAX_EVENTS:
        raise SyncError(f"A Blipy retornou mais de {MAX_EVENTS} eventos em uma consulta.")
    return cards


def event_dates(text):
    date = DATE_LABEL.search(text)
    if date is None or date[2].lower() not in MONTHS:
        raise SyncError("Data de início ausente ou em formato desconhecido.")
    try:
        start = datetime(int(date[3]), MONTHS[date[2].lower()], int(date[1]), int(date[4]), int(date[5]), tzinfo=BRASILIA)
        end = END_LABEL.search(text)
        if end is None:
            return start, None
        finish = start.replace(hour=int(end[1]), minute=int(end[2]))
        if finish < start:
            finish += timedelta(days=1)
    except ValueError as error:
        raise SyncError("A Blipy informou uma data ou hora inválida.") from error
    return start, finish


def can_add_ticket(button):
    return (button.attrs.get("aria-label") or "").startswith("Adicionar um ingresso ") and "disabled" not in button.attrs


def reading_status(main):
    notices = [tag.text() for kind in ("p", "h2", "span") for tag in main.find(kind)]
    if any(CANCELED_NOTICE.fullmatch(label) or ENDED_NOTICE.fullmatch(label) for label in notices):
        return "closed"
    if any(can_add_ticket(button) for button in main.find("button")):
        return "scheduled"
    if any(SOLD_OUT_NOTICE.fullmatch(label) for label in notices):
        return "sold_out"
    return "unknown"


def brl_amount(match):
    return float(match[1].replace(".", "").replace(",", "."))


def starting_price(card, main):
    for tag in card.find("span"):
        match = PRICE_LABEL.fullmatch(tag.text())
        if match:
            return brl_amount(match)
    match = re.search(r"a partir de\s+" + PRICE_LABEL.pattern, card.text(), re.I)
    if match:
        return brl_amount(match)
    if any(tag.text().casefold() in {"gratuito", "entrada gratuita", "grátis"} for tag in card.find("span")):
        return 0
    prices = []
    for row in main.find("li"):
        if any(can_add_ticket(button) for button in row.find("button")):
            match = PRICE_LABEL.search(row.text())
            if match:
                prices.append(brl_amount(match))
    return min(prices, default=None)


def parse_event(url, card, html, now):
    page = PublicMarkup(html).root
    main = next(page.find("main"), None)
    if main is None:
        raise SyncError("Página do evento sem conteúdo principal.")
    status = reading_status(main)
    if status == "closed":
        return None
    name = next((tag.text() for tag in main.find("h1") if tag.text()), "")
    organizer = any(urljoin(BLIPY, tag.attrs.get("href") or "") == ORGANIZER for tag in main.find("a"))
    if not name or not organizer:
        raise SyncError("O evento não pôde ser confirmado como uma publicação da Duke Haus.")

    date_label = next((tag.text() for tag in main.find("dd") if DATE_LABEL.search(tag.text())), "")
    start, end = event_dates(date_label)
    if (end or start) <= now:
        return None

    cover = metadata(page, "og:image") or next((tag.attrs.get("src") or "" for tag in card.find("img")), "")
    flyer = urljoin(BLIPY, cover)
    if not MEDIA_LINK.fullmatch(flyer):
        raise SyncError("A mídia original do evento está ausente ou usa um endereço desconhecido.")
    about = next((section for section in main.find("section")
                  if any(tag.text().casefold() == "sobre o evento" for tag in section.find("h2"))), None)
    description = next((tag for tag in about.find("div")
                        if "texto-rico" in (tag.attrs.get("class") or "").split()), None) if about is not None else None
    event = {
        "id": EVENT_LINK.fullmatch(url)[1],
        "name": name,
        "startAt": start.isoformat(),
        "endAt": end.isoformat() if end else None,
        "status": status,
        "flyerUrl": flyer,
        "description": (description.text() if description is not None else "") or metadata(page, "description"),
        "startingPrice": starting_price(card, main),
        "currency": "BRL",
        "purchaseUrl": url,
    }
    if description is not None:
        for image in description.find("img"):
            media = urljoin(BLIPY, image.attrs.get("src") or "")
            if MEDIA_LINK.fullmatch(media) and media != flyer:
                event["descriptionMediaUrl"] = media
                break
    return event


def collect_feed(now, fetch=fetch_html):
    cards = event_cards(fetch(ORGANIZER))
    events = []
    for url, card in cards.items():
        try:
            event = parse_event(url, card, fetch(url), now)
        except SyncError as error:
            raise SyncError(f"{url}: {error}") from error
        if event is not None:
            events.append(event)
    events.sort(key=lambda event: (event["startAt"], event["id"]))
    return {"schemaVersion": 1, "syncedAt": now.isoformat(timespec="seconds"), "events": events}


def update_feed(path, now, fetch=fetch_html):
    feed = collect_feed(now, fetch)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
            temp_path = Path(tmp.name)
            json.dump(feed, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
        temp_path.chmod(0o644)
        temp_path.replace(path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
    return feed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/events.json"))
    args = parser.parse_args()
    try:
        feed = update_feed(args.output, datetime.now(timezone.utc))
    except (SyncError, OSError) as error:
        print(f"Falha na sincronização Blipy. A última programação válida foi preservada. {error}", file=sys.stderr)
        return 1
    print(f"Agenda Blipy verificada: {len(feed['events'])} evento(s), {feed['syncedAt']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
