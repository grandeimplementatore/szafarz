# Szafarz 3.0

Aplikacja Wspólnoty Szafarzy Nadzwyczajnych Komunii Świętej – Parafia bł. Karoliny Kózkówny w Tychach.

Strony: Strona główna, Harmonogram, Planner wizyt, Nasi Chorzy, Obrzęd Komunii Świętej (także krok po kroku), Nasza Wspólnota. Każda w wersji na komputer i telefon – aplikacja sama wybiera wersję po szerokości ekranu.

## Jak to działa

- `server.js` – serwer Node.js (bez frameworków). Logowanie, strony, API danych.
- `design/*.dc.html` – źródło wyglądu (pliki z projektu Claude Design).
- `scripts/build.js` – buduje z nich gotowe strony do `public/` (robi to też Heroku przy wdrożeniu).
- `static/runtime.js` – silnik stron w przeglądarce: rysuje widoki i zapisuje zmiany na serwerze.
- `lib/store.js` – przechowywanie danych, `lib/auth.js` – konta i sesje.

### Gdzie są dane

Wszystkie wspólne dane (chorzy, plan wizyt, zmiany szafarzy, dziennik zmian) są w bazie **PostgreSQL**:

- `szafarz_store` – jeden wiersz z dokumentem JSON i numerem wersji,
- `szafarz_audit` – kto i kiedy zapisał zmiany.

Tabele tworzą się same przy pierwszym uruchomieniu. Inne tabele w tej samej bazie nie są ruszane.

Gdy dwie osoby zmienią dane w tym samym czasie, zapisze się zmiana pierwszej, a druga zobaczy komunikat i odświeżoną stronę – nic nie zostanie nadpisane bez wiedzy.

## Uruchomienie lokalne

Potrzebny jest PostgreSQL (lokalny albo baza z Heroku):

```bash
npm install
DATABASE_URL="$(heroku config:get DATABASE_URL -a NAZWA-APLIKACJI)" SEED_DEMO=1 npm run dev
# albo lokalna baza:  DATABASE_URL=postgres://localhost/szafarz DATABASE_SSL=false npm run dev
```

Otwórz http://localhost:3000 – bez zmiennej `USERS` działa konto testowe **test / test** (tylko poza produkcją). `SEED_DEMO=1` wpisuje 10 fikcyjnych chorych, ale tylko do pustej bazy (przy pierwszym uruchomieniu).

## Wdrożenie na Heroku

```bash
heroku login
heroku create szafarz-karolina --region eu   # nazwa do wyboru; serwery w UE
heroku addons:attach NAZWA-DODATKU-POSTGRES -a szafarz-karolina   # istniejąca baza → DATABASE_URL
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
heroku config:set REVEAL_CODE=1234        # zmień na własny kod
```

Konta szafarzy: utwórz plik `users.local.json` (jest w `.gitignore` – **nie wrzucaj go do gita**):

```json
{
  "pelka":  { "name": "Paweł Pełka",  "password": "długie-hasło-1" },
  "pawera": { "name": "Marek Pawera", "password": "długie-hasło-2" }
}
```

```bash
heroku config:set USERS="$(npm run -s users -- users.local.json)"
git push heroku main
heroku open
```

Hasła są zapisywane tylko jako skróty (scrypt). Dodanie lub zmiana konta = edycja `users.local.json` i ponowne `heroku config:set USERS=...` (aplikacja sama się zrestartuje).

### Kopie zapasowe

```bash
heroku pg:backups:schedule DATABASE_URL --at '03:00 Europe/Warsaw'
heroku pg:backups:capture                 # kopia teraz
heroku pg:backups:download                # pobranie ostatniej kopii
```

## Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `NODE_ENV` | `production` na serwerze (wymusza HTTPS, bezpieczne ciasteczka, wymaga `SESSION_SECRET`) |
| `SESSION_SECRET` | losowy ciąg min. 32 znaki – podpisuje sesje |
| `USERS` | konta szafarzy (wynik `npm run users`) |
| `REVEAL_CODE` | kod do odkrywania nazwisk chorych na ekranie (domyślnie 1234) |
| `SESSION_DAYS` | ile dni trwa zalogowanie (domyślnie 14) |
| `DATABASE_URL` | adres bazy PostgreSQL – ustawia go Heroku Postgres (wymagany) |
| `DATABASE_SSL` | `false` tylko dla lokalnej bazy bez SSL |
| `SEED_DEMO` | `1` = fikcyjni chorzy przy tworzeniu pustej bazy (tylko testy) |

## Bezpieczeństwo i RODO

- Wszystkie strony i dane są dostępne dopiero po zalogowaniu. Ciasteczko sesji: `HttpOnly`, `Secure`, `SameSite=Lax`, podpisane HMAC.
- Po 10 nieudanych logowaniach z jednego adresu – 15 minut blokady.
- Zapisy wymagają nagłówka aplikacji i zgodnego pochodzenia (ochrona przed CSRF).
- Każdy zapis jest odnotowany (kto, kiedy, która wersja). Wpisy o zmianie szafarza mają podpis autora.
- **Kod odkrywania nazwisk to tylko zasłona przed osobami patrzącymi na ekran** – właściwą ochroną jest logowanie.
- Informacja, że ktoś przyjmuje Komunię w domu z powodu choroby, to dane o zdrowiu (art. 9 RODO). Przed wpisaniem prawdziwych danych uzgodnij z parafią i jej inspektorem ochrony danych: podstawę przetwarzania, kto ma konta, gdzie stoi serwer (aplikacja tworzona z `--region eu`) i jak długo trzymać dane.

## Test w przeglądarce

```bash
BASE=http://localhost:3000 node scripts/e2e-check.js   # wymaga pakietu playwright
```
