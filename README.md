# Szafarz 3.0

Aplikacja Wspólnoty Szafarzy Nadzwyczajnych Komunii Świętej – Parafia bł. Karoliny Kózkówny w Tychach.

Strony: Strona główna, Harmonogram, Planner wizyt, Nasi Chorzy, Obrzęd Komunii Świętej (także krok po kroku), Nasza Wspólnota – w wersji na komputer i telefon. Aplikacja jest publiczna (bez logowania).

## Zasada: wszystkie dane w bazie

Kod aplikacji nie zawiera danych. Wszystko, co strony pokazują i co użytkownicy wprowadzają, jest w bazie PostgreSQL:

| Tabela | Zawartość |
|---|---|
| `sz_terminy`, `sz_przydzialy` | harmonogram: terminy posługi i szafarz przydzielony do każdego osiedla (planowy i aktualny) |
| `sz_zmiany_szafarzy` | historia zamian szafarzy („Zmiany w harmonogramie”) |
| `sz_uwagi_harmonogramu` | uwagi do harmonogramu |
| `sz_szafarze`, `sz_osiedla` | słowniki szafarzy i osiedli |
| `sz_chorzy`, `sz_wizyty` | chorzy i zaplanowane wizyty |
| `sz_dziennik` | dziennik wszystkich akcji zapisujących dane (co, kiedy, z jakiego adresu) |
| `sz_obrzedy`, `sz_obrzedy_kroki` | teksty obrzędów (zwykły, skrócony, wiatyk) |
| `sz_slowo_na_dzis`, `sz_swieta_stale` | „Słowo na dziś” i stałe święta do nazwy dnia liturgicznego |
| `sz_ustawienia` | treści wspólnoty: opis, spotkania, opiekun, lider, dane kancelarii |
| `sz_wersja`, `sz_migracje` | wersja danych (ochrona przed nadpisaniem przy równoczesnych zmianach) i lista wykonanych migracji |

Struktura bazy powstaje automatycznie przy starcie aplikacji z plików w `db/migracje/` – każdy plik jest wykonywany dokładnie raz:

- `001_schemat.sql` – tabele,
- `002_dane_poczatkowe.sql` – jednorazowy import danych startowych (harmonogram 15.11.2026–9.05.2027 z pliku XLS, szafarze, obrzędy, czytania, opis wspólnoty),
- `003_dane_z_poprzedniej_wersji.js` – przeniesienie danych zapisanych przez poprzednią wersję aplikacji (tabela `szafarz_store`).

Nowy harmonogram, zmiana opiekuna, nowe czytania itp. – to zmiany w bazie (np. `heroku pg:psql`), bez zmian w kodzie.

## Wdrożenie na Heroku

Aplikacja potrzebuje tylko bazy Heroku Postgres podłączonej jako `DATABASE_URL`:

```bash
heroku addons:attach aftech::DATABASE -a szafarz --as DATABASE
git push heroku main          # albo w panelu: Deploy → GitHub → Deploy Branch
```

Opcjonalnie: `REVEAL_CODE` – kod do odkrywania nazwisk chorych (domyślnie 1234).

Po przeniesieniu danych tabele poprzedniej wersji nie są już używane i można je usunąć:

```sql
DROP TABLE IF EXISTS szafarz_store, szafarz_audit, szafarz_users, szafarz_config;
```

Kopie zapasowe: `heroku pg:backups:schedule DATABASE_URL --at "03:00 Europe/Warsaw" -a NAZWA-APLIKACJI-Z-BAZĄ`.

## Budowa

- `server.js` – serwer: strony z `views/`, pliki z `static/`, API `/api/state` (odczyt wszystkich danych i zapis zmian).
- `lib/db.js` – migracje, odczyt danych i zapis zmian (każda zmiana trafia do właściwej tabeli i do dziennika).
- `views/*.html` – widoki stron (układ i logika interfejsu, bez danych).
- `static/runtime.js` – silnik widoków w przeglądarce.

Lokalnie: `DATABASE_URL=postgres://localhost/szafarz DATABASE_SSL=false npm start` → http://localhost:3000

## Uwaga: dane są publiczne

Aplikacja nie ma logowania. Każdy, kto zna adres strony, może odczytać i zmienić wszystkie dane – także imiona, nazwiska, adresy i uwagi o chorych (kod odkrywania nazwisk działa tylko na ekranie). Informacja, że ktoś przyjmuje Komunię w domu z powodu choroby, to dane o zdrowiu (art. 9 RODO) – przed wpisaniem prawdziwych danych uzgodnij to z parafią.
