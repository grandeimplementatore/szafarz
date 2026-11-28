# Szafarz 3.0

Aplikacja Wspólnoty Szafarzy Nadzwyczajnych Komunii Świętej – Parafia bł. Karoliny Kózkówny w Tychach.

Strony: Strona główna, Harmonogram, Planner wizyt, Nasi Chorzy, Obrzęd Komunii Świętej (także krok po kroku), Nasza Wspólnota, Ustawienia – w wersji na komputer i telefon. Aplikacja jest publiczna (bez logowania).

## Gdzie są dane

**Baza PostgreSQL** – tylko dane, które się zmieniają:

| Tabela | Zawartość |
|---|---|
| `sz_terminy`, `sz_przydzialy` | harmonogram wizyt: terminy i szafarz każdego osiedla (planowy i aktualny po zamianie) |
| `sz_zmiany_szafarzy` | log zmian harmonogramu (kto, na kogo, kiedy) |
| `sz_szafarze` | lista szafarzy |
| `sz_osiedla` | lista osiedli |
| `sz_chorzy` | chorzy z atrybutami (adres, piętro, uwagi, osiedle) |
| `sz_wizyty` | zaplanowane wizyty |

**Kod** – stałe treści: `static/tresci.js` (opis wspólnoty, spotkania, opiekun, dane kancelarii, uwagi do harmonogramu, stałe święta, teksty obrzędów) oraz cały interfejs w `views/`.

**API** – „Słowo na dziś” serwer pobiera na bieżąco ze strony Archidiecezji Katowickiej (`/api/slowo`, krótko trzymane w pamięci). Gdy strona nie odpowiada, aplikacja pokazuje datę, dzień liturgiczny i link do czytań.

## Ustawienia

Strona **Ustawienia** (kafelek na stronie głównej, na telefonie także w menu ☰) pozwala dodawać i usuwać:

- **szafarzy** – usunąć można tylko szafarza bez przydziałów od dziś; jeśli był w minionych terminach, znika z list, a jego nazwisko zostaje w historii,
- **osiedla** – usunąć można tylko osiedle bez chorych; nowe osiedle pojawia się we wszystkich terminach bez szafarza („brak”) – przypisuje się go w Harmonogramie,
- **terminy harmonogramu** – nowy termin wymaga nazwy dnia i szafarza dla każdego osiedla; usunięcie terminu usuwa też zaplanowane na ten dzień wizyty.

API: `GET /api/ustawienia`, `POST /api/ustawienia/{szafarze|osiedla|terminy}`, `DELETE /api/ustawienia/szafarze/:id`, `/osiedla/:kod`, `/terminy/:data`.

## Operacje na bazie przy wdrożeniu

`Procfile` ma fazę `release: node db/deploy.js` – Heroku wykonuje ją przy każdym wdrożeniu, zanim uruchomi nową wersję. Skrypt w jednej transakcji:

1. tworzy brakujące tabele (`db/schema.sql`),
2. w pustej bazie wczytuje dane startowe – osiedla, szafarzy i harmonogram 15.11.2026–9.05.2027 z pliku XLS (`db/dane-startowe.sql`),
3. pozwala na osiedla bez przypisanego szafarza (`szafarz_planowy_id` może być pusty),
4. jeśli nie ma jeszcze żadnych chorych, a istnieje tabela pierwszej wersji `szafarz_store`, przenosi z niej chorych, wizyty i zmiany,
5. usuwa tabele, których aplikacja już nie używa: `sz_dziennik`, `sz_migracje`, `sz_obrzedy`, `sz_obrzedy_kroki`, `sz_slowo_na_dzis`, `sz_swieta_stale`, `sz_ustawienia`, `sz_uwagi_harmonogramu`, `sz_wersja`, `szafarz_audit`, `szafarz_config`, `szafarz_store`, `szafarz_users`.

Przy błędzie transakcja jest wycofywana, baza zostaje bez zmian, a Heroku nie uruchamia nowej wersji. Skrypt można bezpiecznie wykonywać wielokrotnie. Ręcznie: `npm run db` (z ustawionym `DATABASE_URL`).

## Wdrożenie na Heroku

Aplikacja potrzebuje bazy Heroku Postgres podłączonej jako `DATABASE_URL`:

```bash
heroku addons:attach aftech::DATABASE -a szafarz --as DATABASE
git push heroku main          # albo w panelu: Deploy → GitHub → Deploy Branch
```

Opcjonalnie: `REVEAL_CODE` – kod do odkrywania nazwisk chorych (domyślnie 1234).

Kopie zapasowe: `heroku pg:backups:schedule DATABASE_URL --at "03:00 Europe/Warsaw" -a NAZWA-APLIKACJI-Z-BAZĄ`.

## Budowa

- `server.js` – serwer: strony z `views/`, pliki z `static/`, API `/api/state` (dane z bazy i zapis zmian) i `/api/slowo`.
- `lib/db.js` – odczyt i zapis danych w bazie (z ochroną przed nadpisaniem cudzych zmian przy równoczesnym zapisie).
- `lib/slowo.js` – pobieranie „Słowa na dziś”.
- `lib/ustawienia.js`, `static/ustawienia.js` – strona Ustawienia (serwer i widok).
- `db/` – schemat, dane startowe i operacje wykonywane przy wdrożeniu.
- `views/*.html` – widoki stron, `static/runtime.js` – silnik widoków w przeglądarce.

Lokalnie: `DATABASE_URL=postgres://localhost/szafarz DATABASE_SSL=false npm run db && npm start` → http://localhost:3000

## Uwaga: dane są publiczne

Aplikacja nie ma logowania. Każdy, kto zna adres strony, może odczytać i zmienić wszystkie dane – także imiona, nazwiska, adresy i uwagi o chorych (kod odkrywania nazwisk działa tylko na ekranie). Informacja, że ktoś przyjmuje Komunię w domu z powodu choroby, to dane o zdrowiu (art. 9 RODO) – przed wpisaniem prawdziwych danych uzgodnij to z parafią.
