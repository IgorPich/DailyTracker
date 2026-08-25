# ADR-0001: Local-first sync przez GreekGod Sync Service w sieci LAN

- Status: zaakceptowane
- Data: 2026-08-25
- Branch: `greekgod-3-foundation`
- Zakres: wyłącznie transport i uruchomienie synchronizacji

## Decyzja

GreekGod 3 nie będzie używać Supabase ani innego backendu internetowego.

Docelowy przepływ:

```text
Mobile SQLite
    ↓ HTTPS w domowym Wi-Fi / LAN
GreekGod Sync Service na PC
    ↓ wspólne repository/use cases
Desktop SQLite
```

Sync Service nie jest trzecią bazą. Korzysta z tego samego pliku SQLite co aplikacja desktopowa. Telefon nigdy nie otwiera desktopowego pliku SQLite bezpośrednio; komunikuje się wyłącznie z kontrolowanym API Sync Service.

Zmiana nie dotyczy modeli domenowych, `exerciseId`, historii, progresu, `equipmentSensitive`, Dziennika, szablonów, UI, timera ani lock-screen input.

## Granice architektury

Warstwa synchronizacji zachowuje rozdział:

```text
Sync engine
    ↓
SyncTransport
    ↓
LanSyncTransport
```

`SyncTransport` nie zna HTTP, mDNS, Windows ani Androida. `LanSyncTransport` odpowiada za discovery, połączenie, uwierzytelnienie i wymianę paczek z lokalnym serwisem.

Nie powstanie `SupabaseSyncTransport`. Nie instalujemy bibliotek Supabase, nie dodajemy konta cloud ani zależności od Internetu.

## GreekGod Sync Service na Windows

Pierwsza wersja będzie małym, bezokienkowym procesem Rust:

- działa bez Tauri UI, Vite i serwera Node;
- uruchamia się automatycznie przy logowaniu bieżącego użytkownika;
- jest rejestrowana i usuwana razem z instalacją GreekGod;
- może zostać ponownie uruchomiona po awarii;
- posiada blokadę single-instance;
- zapisuje wyłącznie krótkie lokalne logi techniczne bez danych treningowych i sekretów.

Preferowany mechanizm startu to zadanie Harmonogramu zadań Windows z triggerem logowania użytkownika. Zachowuje to ten sam kontekst użytkownika i dostęp do tej samej bazy w jego katalogu aplikacji, bez przenoszenia danych i bez wymagania uprzywilejowanej usługi `LocalSystem`.

Termin „Sync Service” oznacza rolę procesu. Nie wymaga w pierwszej wersji rejestracji w Windows Service Control Manager.

## Discovery i pairing

Pierwsze parowanie:

1. Desktop wyświetla QR lub jednorazowy kod.
2. QR zawiera `serviceId`, krótko żyjący pairing nonce oraz fingerprint klucza/certyfikatu PC.
3. Telefon rejestruje własny `deviceId` i klucz urządzenia.
4. PC wydaje osobny losowy token dla tego urządzenia.
5. Token telefonu jest przechowywany w Android Keystore, a po stronie PC wyłącznie w bezpiecznej postaci skrótu.

Pairing endpoint jest aktywny tylko podczas jawnie otwartego, krótkiego okna parowania. Pozostałe endpointy sync odrzucają urządzenia anonimowe i cofnięte tokeny.

Kolejne połączenia:

1. próba ostatnio znanego hosta;
2. fallback przez DNS-SD/mDNS `_greekgod-sync._tcp.local`;
3. weryfikacja zapamiętanego `serviceId` i fingerprintu;
4. uwierzytelnienie tokenem sparowanego urządzenia.

Zmiana adresu DHCP nie wymaga ponownego parowania. Ustawienia pozwolą usunąć sparowane urządzenie i natychmiast unieważnić jego token.

## Transport i ekspozycja sieciowa

- protokół aplikacyjny: wersjonowane HTTPS/JSON;
- port dynamiczny albo konfigurowalny, ogłaszany przez mDNS;
- nasłuch tylko na interfejsach lokalnych;
- reguła Windows Firewall ograniczona do profilu `Private`;
- brak port forwarding, publicznego DNS i połączeń wychodzących do chmury;
- router nie musi mieć dostępu do Internetu.

Discovery może ujawnić jedynie nazwę usługi, wersję protokołu, port i `serviceId`. Nie ujawnia danych użytkownika ani nie pozwala wykonać synchronizacji.

## Protokół synchronizacji

Każda lokalna zmiana trafia najpierw do SQLite i w tej samej transakcji do trwałego outboxa.

Minimalna operacja synchronizacji zawiera:

- `operationId` — globalny UUID i klucz idempotency;
- `deviceId`;
- `entityType`;
- `entityId`;
- `baseRevision`;
- payload albo tombstone;
- lokalne metadane diagnostyczne, które nie decydują samodzielnie o kolejności serwerowej.

Desktop SQLite przechowuje również rejestr zastosowanych `operationId`, monotoniczny `serverRevision` i change log potrzebny do pobierania zmian przez telefon. Są to tabele tej samej desktopowej bazy, nie osobna baza Sync Service.

Wymiana jest paczkowa:

1. telefon wysyła pending operations;
2. service atomowo deduplikuje i stosuje zaakceptowane operacje;
3. service zwraca potwierdzone `operationId` i aktualny revision cursor;
4. telefon pobiera zmiany od ostatniego potwierdzonego cursora;
5. telefon stosuje je lokalnie w transakcji;
6. cursor jest przesuwany dopiero po pełnym powodzeniu transakcji.

Powtórzenie requestu, timeout albo przerwanie aplikacji nie może utworzyć duplikatu. Usunięcia są przesyłane jako tombstones. Konflikt jest wykrywany przez `baseRevision`; pierwsza wersja może rozstrzygać last-write-wins według kolejności zaakceptowanej przez desktop, nie wyłącznie według zegara klienta.

## Współbieżny dostęp do desktop SQLite

Desktop UI i Sync Service mogą działać jednocześnie na tym samym komputerze.

Wymagania:

- SQLite w trybie WAL;
- krótko trwające transakcje zapisu;
- `busy_timeout` i kontrolowany retry z backoffem;
- jeden wspólny schemat migracji i te same repository contracts;
- idempotentne zapisy i constrainty `UNIQUE`;
- brak kopiowania aktywnego pliku bazy bez poprawnego mechanizmu backupu SQLite;
- testy dwóch procesów zapisujących równolegle;
- jawna kontrola wersji SQLite przed włączeniem dwóch writerów.

Wymagana jest wersja SQLite zawierająca poprawkę współbieżnego WAL-reset. Jeżeli używana biblioteka nie ma poprawki, zapis desktop UI i Sync Service musi zostać zserializowany wspólną blokadą międzyprocesową albo przeprowadzony przez jednego writera do czasu aktualizacji biblioteki.

## Mobile background sync

Android zapisuje trening bez sieci do własnego SQLite. Nie wykonuje requestu po każdej serii.

Po pojawieniu się odpowiedniej sieci:

- WorkManager uruchamia unique work wymagający sieci lokalnej/Wi-Fi;
- najpierw sprawdzany jest zapamiętany host, a mDNS jest krótkim fallbackiem;
- retry używa exponential backoff i nie spamuje sieci;
- job może zostać wznowiony po restarcie telefonu;
- ręczne „Synchronizuj teraz” korzysta z tego samego sync engine;
- brak PC lub błąd sieci pozostawia outbox nietknięty.

## Zachowanie desktop UI

Desktop zawsze otwiera dane bezpośrednio z lokalnego SQLite. Nie czeka na sieć ani Sync Service.

Gdy service zmieni bazę podczas otwartego UI, aplikacja wykrywa zmianę przez lekki revision/change-sequence check i odświeża lokalny view model. Nie budujemy drugiego kanału synchronizacji.

## Test akceptacyjny

Warunek końcowy:

1. GreekGod Desktop jest zamknięty, Sync Service działa.
2. Telefon offline zapisuje trening i pending operation.
3. Telefon wraca do domowego Wi-Fi bez dostępu do Internetu.
4. Odnajduje sparowany service bez ręcznego IP.
5. Push i pull kończą się idempotentnie.
6. Telefon zostaje zamknięty.
7. Później uruchomiony Desktop natychmiast widzi trening w swoim SQLite.
8. Retry tej samej paczki nie tworzy duplikatu.
9. Tombstone nie powoduje ponownego pojawienia się usuniętego rekordu.

## Zakres tej korekty

W chwili podjęcia decyzji repo nie zawiera kodu ani zależności Supabase. Dlatego korekta nie wymaga usuwania runtime code. Ten ADR zastępuje wyłącznie chmurową część wcześniejszego planu i jest kontraktem dla przyszłej implementacji `packages/sync`, aplikacji mobile oraz Sync Service.
