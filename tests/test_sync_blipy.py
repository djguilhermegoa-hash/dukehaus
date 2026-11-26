import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from scripts.sync_blipy import BLIPY, ORGANIZER, SyncError, collect_feed, update_feed


NOW = datetime.fromisoformat("2026-11-25T21:00:00-03:00")
CARD = '<a href="/e/{slug}"><article><img src="/api/midia/capa-{slug}"><h3>Festa</h3>{price}</article></a>'


def organizer(*cards, count=None, notice=""):
    counter = f"<span>{count} evento{'s' if count != 1 else ''} à venda</span>" if count is not None else ""
    return f'''<link rel="canonical" href="{ORGANIZER}">
        <div hidden id="S:0"><h1>Duke Haus</h1>{counter}
        <section aria-labelledby="proximos"><h2 id="proximos">Próximos eventos</h2>
        {''.join(cards)}{notice}</section></div>'''


def details(day, *, name="Festa", description="", status="active", finish="05:00", media=""):
    tickets = {
        "active": '''<ul><li><span>R$ 32,50</span><button aria-label="Adicionar um ingresso A"></button></li>
        <li><span>R$ 15,00</span><button aria-label="Adicionar um ingresso B"></button></li>
        <li><span>R$ 10,00</span><button aria-label="Adicionar um ingresso C" disabled></button></li></ul>''',
        "canceled": "<p>Evento cancelado</p>",
        "past": "<p>Evento encerrado</p>",
        "sold out": "<p>Ingressos esgotados</p>",
        "unknown": "",
    }
    cover = f'<meta property="og:image" content="{media}">' if media else ""
    end_label = f"<span> (até <!-- -->{finish}<!-- -->)</span>" if finish else ""
    return f'''{cover}<meta name="description" content="Resumo público do evento."><main><h1>{name}</h1>
        <dl><dt>Data</dt><dd>sex., {day} de nov. de 2026, às 23:00{end_label}</dd></dl>
        <section><h2>Sobre o evento</h2><div class="texto-rico">{description}</div></section>
        <a href="/organizador/duke-haus">Duke Haus</a><aside>{tickets[status]}</aside></main>'''


def fake_feed(organizer_html, **event_pages):
    pages = {ORGANIZER: organizer_html}
    pages.update({BLIPY + "/e/" + slug: html for slug, html in event_pages.items()})
    return pages.__getitem__


class SyncTests(unittest.TestCase):
    def test_orders_deduplicates_and_imports_public_details(self):
        later = CARD.format(slug="depois", price="<p>a partir de <span>R$ 1.850,50</span></p>")
        earlier = CARD.format(slug="antes", price="<p>Vendas abertas</p>")
        fetch = fake_feed(organizer(later, earlier, earlier, count=2),
                          depois=details(28, finish=None, status="sold out"),
                          antes=details(27, name="Festa atualizada", description="<p>Parágrafo 1.</p><p>Parágrafo 2.</p>",
                                         media=BLIPY + "/api/midia/original"))
        feed = collect_feed(NOW, fetch)
        earlier, later = feed["events"]
        self.assertEqual(feed["schemaVersion"], 1)
        self.assertEqual(feed["syncedAt"], NOW.isoformat())
        self.assertEqual(earlier, {
            "id": "antes",
            "name": "Festa atualizada",
            "startAt": "2026-11-27T23:00:00-03:00",
            "endAt": "2026-11-28T05:00:00-03:00",
            "status": "scheduled",
            "flyerUrl": BLIPY + "/api/midia/original",
            "description": "Parágrafo 1. Parágrafo 2.",
            "startingPrice": 15,
            "currency": "BRL",
            "purchaseUrl": BLIPY + "/e/antes",
        })
        self.assertEqual(later["id"], "depois")
        self.assertEqual(later["status"], "sold_out")
        self.assertEqual(later["startingPrice"], 1850.50)
        self.assertIsNone(later["endAt"])
        self.assertEqual(later["description"], "Resumo público do evento.")

    def test_removes_past_and_canceled_events(self):
        cards = [CARD.format(slug=slug, price="") for slug in ("passado", "cancelado", "encerrado", "durante")]
        now = datetime.fromisoformat("2026-11-26T02:00:00-03:00")
        fetch = fake_feed(organizer(*cards, count=4), passado=details(24), cancelado=details(27, status="canceled"),
                          encerrado=details(28, status="past"), durante=details(25))
        self.assertEqual([event["id"] for event in collect_feed(now, fetch)["events"]], ["durante"])

    def test_updates_feed_and_removes_missing_events(self):
        card = CARD.format(slug="um", price="")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data/events.json"
            update_feed(path, NOW, fake_feed(organizer(card, count=1), um=details(27)))
            update_feed(path, NOW, fake_feed(organizer(count=0)))
            self.assertEqual(json.loads(path.read_text())["events"], [])

    def test_explicit_empty_profile_without_upcoming_section(self):
        page = (f'<link rel="canonical" href="{ORGANIZER}"><h1>Duke Haus</h1>'
                '<span>Nenhum evento à venda</span>')
        self.assertEqual(collect_feed(NOW, fake_feed(page))["events"], [])

    def test_preserves_original_media_for_an_image_only_description(self):
        card = CARD.format(slug="um", price="")
        description = ('<img src="https://external.example/tracker"><img src="/api/midia/capa-um">'
                       '<img src="/api/midia/sobre-um">')
        fetch = fake_feed(organizer(card, count=1), um=details(27, description=description))
        event = collect_feed(NOW, fetch)["events"][0]
        self.assertEqual(event["description"], "Resumo público do evento.")
        self.assertEqual(event["descriptionMediaUrl"], BLIPY + "/api/midia/sobre-um")

    def test_keeps_previous_file_when_detail_page_fails(self):
        card = CARD.format(slug="um", price="")
        other = CARD.format(slug="dois", price="")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.json"
            update_feed(path, NOW, fake_feed(organizer(card, count=1), um=details(27)))
            original = path.read_bytes()
            fetch = fake_feed(organizer(card, other, count=2), um=details(27, name="Atualização"), dois="<html></html>")
            with self.assertRaises(SyncError):
                update_feed(path, NOW, fetch)
            self.assertEqual(path.read_bytes(), original)

    def test_refuses_non_authoritative_empty_or_partial_result(self):
        external = CARD.format(slug="um", price="").replace("/e/um", "https://other.example/e/um")
        bad_organizers = ["<html>Indisponível</html>", organizer(), organizer(external, count=1),
                          organizer(notice="<p>Nenhum evento por aqui.</p>", count=2),
                          organizer(CARD.format(slug="um", price=""), count=2)]
        for page in bad_organizers:
            with self.subTest(page=page), self.assertRaises(SyncError):
                collect_feed(NOW, fake_feed(page))

    def test_accepts_event_with_no_price_or_public_status(self):
        card = CARD.format(slug="um", price="")
        fetch = fake_feed(organizer(card, count=1), um=details(30, status="unknown"))
        event = collect_feed(NOW, fetch)["events"][0]
        self.assertEqual(event["status"], "unknown")
        self.assertIsNone(event["startingPrice"])


if __name__ == "__main__":
    unittest.main()
