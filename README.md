# GreekGod · prywatny dziennik treningowy

Prywatna, lokalna aplikacja do śledzenia masy, talii, odżywiania i progresu treningowego. GreekGod działa jako natywna aplikacja Windows oparta o Tauri v2 oraz jako wersja przeglądarkowa do developmentu.

Nie ma logowania, backendu, synchronizacji ani zależności od internetu podczas normalnego korzystania.

## Funkcje

- Panel ze średnimi 7-dniowymi i kluczowymi metrykami.
- Dziennik dnia z kaloriami, białkiem, tłuszczem i węglowodanami oraz edycją wcześniejszych wpisów.
- Historia treningów z pełnym podglądem i edycją ciężaru, powtórzeń, serii, ćwiczeń, daty, siłowni i notatek bez tworzenia duplikatów.
- Ręczna lista siłowni, filtrowanie historii oraz bezpieczne porównywanie wyników na maszynach tylko w tej samej lokalizacji.
- Osobna zakładka Progres z wyborem ćwiczenia, zakresu czasu, metryki i siłowni dla maszyn.
- Trwała edycja szablonów A/B/C/D: nazwy, serie, zakresy, kolejność, dodawanie i usuwanie ćwiczeń.
- Wspólny format liczb z kropką oraz obsługa przecinka podczas wpisywania wartości dziesiętnych.
- Progres liczony dynamicznie z dwóch ostatnich porównywalnych wykonań ćwiczenia i docelowego zakresu powtórzeń.
- Raport dla trenera z zakresem dat, realizacją celów, notatkami trenera i eksportem PNG.
- Pełna kopia zapasowa i przywracanie przez JSON oraz dodatkowy eksport CSV.
- Responsywny interfejs Graphite / White / Blue, z zielenią zarezerwowaną dla progresu i sukcesu.

## Przechowywanie i migracja danych

- Aplikacja Windows zapisuje dane lokalnie w Tauri Store: `%APPDATA%\com.igorpich.formlog\formlog.store.json`.
- Wersja przeglądarkowa nadal korzysta z `localStorage` pod kluczem `formlog.data.v1`.
- Powyższe legacy identyfikatory celowo nie zostały zmienione przy zmianie nazwy na GreekGod, dzięki czemu istniejące dane są odczytywane bez migracji i resetu.
- Dane przeglądarki i aplikacji desktopowej są oddzielne i nie migrują automatycznie.

Bezpieczna migracja ze starszej wersji przeglądarkowej:

1. W przeglądarce wybierz **Ustawienia → Eksportuj pełną kopię JSON**.
2. Zainstaluj i uruchom GreekGod dla Windows.
3. Wybierz **Ustawienia → Importuj kopię JSON** i wskaż pobrany plik.
4. Potwierdź zastąpienie danych. Import zastępuje aktualny zestaw zamiast dopisywać duplikaty.

Kopia ma nazwę `greekgod-kopia-YYYY-MM-DD.json` i zawiera kompletny stan aplikacji. Starsze pola `sleep`, `recovery` i `rir` pozostają zachowane dla kompatybilności, choć nie są już pokazywane w interfejsie. Migracja danych v2→v3 zmienia wyłącznie wbudowane szablony przyszłych treningów; zapisane wpisy i treningi pozostają bez zmian.

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

- samodzielny plik: `src-tauri/target/release/greekgod.exe`,
- zalecany instalator: `src-tauri/target/release/bundle/nsis/GreekGod_2.5.0_x64-setup.exe`,
- instalatory MSI: `src-tauri/target/release/bundle/msi/GreekGod_2.5.0_x64_pl-PL.msi` i `GreekGod_2.5.0_x64_en-US.msi`.

Do normalnej instalacji uruchom plik `GreekGod_2.5.0_x64-setup.exe`. Instalator działa dla bieżącego użytkownika i dodaje GreekGod do menu Start oraz skrót na pulpicie. Kliknięcie systemowego `X` kończy aplikację — projekt nie zawiera ikony w zasobniku, autostartu ani zadań w tle.

## Struktura

```text
src/
├── assets/           # logo i źródłowa ikona aplikacji
├── components/       # współdzielone elementy UI
├── context/          # stan aplikacji i toasty
├── data/             # domyślne szablony treningowe A–D
├── pages/            # Panel, Dziennik, Trening, Raport dla trenera, Ustawienia
├── services/         # storage oraz natywne dialogi i pliki
├── utils/            # daty, obliczenia, normalizacja i identyfikatory
└── styles.css         # kompletny responsywny wygląd

src-tauri/
├── capabilities/     # uprawnienia Store, dialogów i plików
├── icons/            # ikony Windows i pozostałych targetów Tauri
├── src/              # natywny punkt startowy i obsługa zamknięcia
└── tauri.conf.json    # okno, metadata i bundlery NSIS/MSI
```
