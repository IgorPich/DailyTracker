# Formlog · Personal Fitness Tracker

Prywatna, lokalna aplikacja do śledzenia masy, talii, odżywiania, aktywności i progresu treningowego. Formlog działa jako natywna aplikacja Windows oparta o Tauri v2 oraz jako wersja przeglądarkowa do developmentu.

Nie ma logowania, backendu, synchronizacji ani zależności od internetu podczas normalnego korzystania.

## Funkcje

- Dashboard ze średnimi 7-dniowymi i kluczowymi metrykami.
- Dziennik dnia, szablony treningowe A/B/C/D, rolling split, serie, RIR, historia oraz timer odpoczynku.
- Coach Report z zakresem dat, adherence, Coach Notes i eksportem PNG.
- Pełny backup i przywracanie przez JSON oraz dodatkowy eksport CSV.
- Responsywny interfejs Graphite / White / Blue, z zielenią zarezerwowaną dla progresu i sukcesu.

## Przechowywanie i migracja danych

- Aplikacja Windows zapisuje dane lokalnie w Tauri Store: `%APPDATA%\com.igorpich.formlog\formlog.store.json`.
- Wersja przeglądarkowa nadal korzysta z `localStorage` pod kluczem `formlog.data.v1`.
- Dane przeglądarki i aplikacji desktopowej są oddzielne i nie migrują automatycznie.

Bezpieczna migracja ze starszej wersji przeglądarkowej:

1. W przeglądarce wybierz **Ustawienia → Eksportuj pełny backup JSON**.
2. Zainstaluj i uruchom Formlog dla Windows.
3. Wybierz **Ustawienia → Importuj backup JSON** i wskaż pobrany plik.
4. Potwierdź zastąpienie danych. Import zastępuje aktualny zestaw zamiast dopisywać duplikaty.

Backup ma nazwę `formlog-backup-YYYY-MM-DD.json` i zawiera dziennik, treningi, serie, RIR, ustawienia, fazę, cele, historię i Coach Notes.

## Development

Wymagania dla Windows:

- Node.js 20.19+ albo 22.12+,
- Rust z toolchainem `stable-msvc`,
- Microsoft C++ Build Tools z workloadem **Desktop development with C++**,
- Microsoft Edge WebView2 Runtime (jest obecny domyślnie w aktualnych wydaniach Windows 10/11).

Aktualne wymagania środowiska opisuje oficjalna dokumentacja [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev
```

Podczas developmentu Tauri uruchamia Vite pod `http://localhost:1420`. Zwykły tryb webowy pozostaje dostępny przez `npm run dev` na porcie `5173`.

## Windows Production Build

```bash
npm run tauri:build
```

Build najpierw tworzy statyczny frontend Vite, osadza go w aplikacji i nie uruchamia localhost, Node ani terminala w wersji produkcyjnej.

Wyniki:

- samodzielny plik: `src-tauri/target/release/formlog.exe`,
- zalecany instalator: `src-tauri/target/release/bundle/nsis/Formlog_2.2.0_x64-setup.exe`,
- instalatory MSI: `src-tauri/target/release/bundle/msi/Formlog_2.2.0_x64_pl-PL.msi` i `Formlog_2.2.0_x64_en-US.msi`.

Do normalnej instalacji uruchom plik `Formlog_2.2.0_x64-setup.exe`. Instalator działa dla bieżącego użytkownika i dodaje Formlog do menu Start oraz skrót na pulpicie. Kliknięcie systemowego `X` kończy aplikację — projekt nie zawiera tray icon, autostartu ani zadań w tle.

## Struktura

```text
src/
├── assets/           # logo i źródłowa ikona aplikacji
├── components/       # współdzielone elementy UI
├── context/          # stan aplikacji i toasty
├── data/             # domyślne szablony treningowe A–D
├── pages/            # Dashboard, Dziennik, Trening, Coach Report, Ustawienia
├── services/         # storage oraz natywne dialogi i pliki
├── utils/            # daty, obliczenia, normalizacja i identyfikatory
└── styles.css         # kompletny responsywny wygląd

src-tauri/
├── capabilities/     # uprawnienia Store, dialogów i plików
├── icons/            # ikony Windows i pozostałych targetów Tauri
├── src/              # natywny punkt startowy i obsługa zamknięcia
└── tauri.conf.json    # okno, metadata i bundlery NSIS/MSI
```
