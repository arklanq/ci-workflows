# CI Workflows

Wspólne workflow GitHub Actions dla projektów konta `arklanq`.

## Wybór runnera

`.github/workflows/select-runner.yaml` sprawdza runnery przypisane do repozytorium wywołującego. Preferuje instancję online, która ma wszystkie wskazane etykiety i jest wolna. Gdy nie ma wymaganej liczby wolnych instancji, wybiera runner GitHuba. Przy błędzie API, brakującym lub nieważnym tokenie również zwraca fallback, zapisując ostrzeżenie w logu.

Job wyboru zawsze uruchamia się na `ubuntu-latest`. Dzięki temu wyłączenie własnego PC nie blokuje samego sprawdzenia. Ten krótki job nadal korzysta z zasobów GitHub-hosted.

### Użycie

Po zaakceptowaniu i scaleniu workflow do `main` dodaj w repozytorium wywołującym:

```yaml
jobs:
  determine-runner:
    uses: arklanq/ci-workflows/.github/workflows/select-runner.yaml@main
    with:
      primary-runner: self-hosted,Linux,X64,pc-wsl
      fallback-runner: ubuntu-26.04
    secrets:
      runner-api-token: ${{ secrets.RUNNER_API_TOKEN }}

  build:
    needs: determine-runner
    runs-on: ${{ fromJSON(needs.determine-runner.outputs.runner) }}
    steps:
      - run: uname -srm
```

Pełny przykład ręcznie uruchamianego workflow znajduje się w [examples/runner-fallback.yaml](examples/runner-fallback.yaml). W projektach wymagających przypięcia wersji można zastąpić `@main` zatwierdzonym SHA commita.

### Parametry

| Parametr | Domyślnie | Znaczenie |
| --- | --- | --- |
| `primary-runner` | Wymagany. | Etykiety własnego runnera, rozdzielone przecinkami bez spacji. |
| `fallback-runner` | `ubuntu-26.04`. | Jedna etykieta runnera GitHuba. |
| `primaries-required` | `1`. | Minimalna liczba pasujących instancji online, które nie są zajęte. Używaj dodatnich liczb całkowitych. |
| Sekret `runner-api-token` | Opcjonalny. | Token do odczytu listy runnerów repozytorium wywołującego. Bez niego wybierany jest fallback. |

Output `runner` jest tablicą etykiet zapisaną jako JSON. W `runs-on` trzeba użyć `fromJSON`.

### Token

W repozytorium wywołującym dodaj Actions secret `RUNNER_API_TOKEN`. Użyj fine-grained PAT ograniczonego do wybranych repozytoriów, z uprawnieniem repozytorium **Administration: Read**. Zwykły `GITHUB_TOKEN` nie ma uprawnienia do odczytu tej listy. Token jest przekazywany jawnie jako sekret wywołania; nie zapisuj go w plikach ani w tym repozytorium.

### Ograniczenia

- Wybór jest oceną dostępności w chwili sprawdzenia. Nie rezerwuje runnera. Równoległe workflow mogą wybrać tę samą instancję, a zadania będą wtedy czekały w kolejce.
- Gdy PC zniknie po wyborze, GitHub nie przeniesie już przydzielonego zadania na runner hosted. To nie jest mechanizm ponawiania zadań po awarii.
- Akcja dopasowuje etykiety z uwzględnieniem wielkości liter. Używaj nazw zwracanych przez GitHub, np. `Linux` i `X64`.
- Workflow nie udostępnia runnera innym repozytoriom. Na koncie osobistym każda rejestracja runnera nadal jest związana z jednym repozytorium.
- Runner Linux obsługuje zadania zgodne z Linuxem. Zadania wymagające macOS albo Windows potrzebują odpowiedniej instancji i zgodnego fallbacku.

Implementacja używa [O-Mutt/runner-fallback-action](https://github.com/O-Mutt/runner-fallback-action) v2.0.0, przypiętej do SHA `f560f38018b223f50079f2006847fcb5cf07f490`. `fallback-on-error` jest włączone, a `primaries-required` domyślnie wynosi `1`.
