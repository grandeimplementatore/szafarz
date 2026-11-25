# Szafarz 3.0

Aplikacja Wspólnoty Szafarzy Nadzwyczajnych Komunii Świętej – Parafia bł. Karoliny Kózkówny w Tychach.

Strony: Strona główna, Harmonogram, Planner wizyt, Nasi Chorzy, Obrzęd Komunii Świętej (także krok po kroku), Nasza Wspólnota. Każda w wersji na komputer i telefon – aplikacja sama wybiera wersję po szerokości ekranu. Aplikacja jest publiczna (bez logowania).

## Wdrożenie na Heroku

Jedyne, czego aplikacja potrzebuje, to **baza Heroku Postgres podłączona do aplikacji** (zmienna `DATABASE_URL` ustawia się sama).

```bash
heroku addons:attach aftech::DATABASE -a szafarz --as DATABASE
git push heroku main          # albo w panelu: Deploy → GitHub → Deploy Branch
```

Przy pierwszym starcie aplikacja sama zakłada w bazie tabele.

## Gdzie są dane

| Tabela | Co zawiera |
|---|---|
| `szafarz_store` | wspólne dane: chorzy, plan wizyt, zmiany szafarzy, dziennik zmian (jeden dokument JSON z wersją) |
| `szafarz_audit` | kiedy zapisano zmiany |

Innych tabel w bazie aplikacja nie rusza. Gdy dwie osoby zmienią dane w tym samym czasie, zapisze się zmiana pierwszej, a druga zobaczy komunikat i odświeżoną stronę.

Kopie zapasowe bazy: `heroku pg:backups:schedule DATABASE_URL --at "03:00 Europe/Warsaw" -a NAZWA-APLIKACJI-Z-BAZĄ`.

## Ustawienia opcjonalne (Config Vars)

| Zmienna | Opis |
|---|---|
| `REVEAL_CODE` | kod do odkrywania nazwisk chorych na ekranie (domyślnie 1234) |
| `SEED_DEMO` | `1` = 10 fikcyjnych chorych przy tworzeniu pustej bazy (tylko testy) |

## Jak to działa

- `server.js` – serwer Node.js: strony i API danych (`/api/state`).
- `design/*.dc.html` – źródło wyglądu (pliki z projektu Claude Design); `scripts/build.js` buduje z nich strony do `public/` (Heroku robi to samo przy wdrożeniu).
- `static/runtime.js` – silnik stron w przeglądarce: rysuje widoki i zapisuje zmiany na serwerze.
- `lib/store.js` – baza danych.

Uruchomienie lokalne bez bazy (dane w pamięci, znikają po zatrzymaniu): `DATABASE_URL=memory SEED_DEMO=1 npm run dev` → http://localhost:3000

## Uwaga: dane są publiczne

Aplikacja nie ma logowania. Każdy, kto zna adres strony, może odczytać i zmienić wszystkie dane – także imiona, nazwiska, adresy i uwagi o chorych (rozmycie nazwisk i kod odkrywania działają tylko na ekranie; pełne dane są w odpowiedzi `/api/state`). Informacja, że ktoś przyjmuje Komunię w domu z powodu choroby, to dane o zdrowiu (art. 9 RODO) – przed wpisaniem prawdziwych danych uzgodnij to z parafią i jej inspektorem ochrony danych.
