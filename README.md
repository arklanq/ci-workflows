# CI Workflows

Wspólne workflow GitHub Actions dla projektów konta `arklanq`.

## Wybór runnera

`.github/workflows/select-runner.yaml` sprawdza runnery przypisane do repozytorium wywołującego. Wybiera etykiety własnego runnera, jeżeli co najmniej jedna pasująca instancja jest online. Zajęta instancja nadal jest wybierana: GitHub ustawia zadania w kolejce do czasu jej zwolnienia. Gdy nie ma pasującej instancji online, zwraca etykietę `fallback-runner`. Przy błędzie API, brakującym lub nieważnym tokenie również zwracany jest fallback, z ostrzeżeniem w logu.

Job wyboru zawsze uruchamia się na `ubuntu-latest`. Dzięki temu wyłączenie własnego PC nie blokuje samego sprawdzenia. Ten krótki job nadal korzysta z zasobów GitHub-hosted.

### Użycie

Po zaakceptowaniu i scaleniu workflow do `main` dodaj w repozytorium wywołującym:

```yaml
jobs:
  determine-runner:
    uses: arklanq/ci-workflows/.github/workflows/select-runner.yaml@main
    with:
      primary-runner: self-hosted,ubuntu-26.04
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
| `primary-runner` | `self-hosted,ubuntu-26.04`. | Etykiety własnego runnera, rozdzielone przecinkami bez spacji. |
| `fallback-runner` | `ubuntu-26.04`. | Jedna etykieta runnera GitHuba. |
| Sekret `runner-api-token` | Opcjonalny. | Token do odczytu listy runnerów repozytorium wywołującego. Bez niego wybierany jest fallback. |

Output `runner` jest tablicą etykiet zapisaną jako JSON. W `runs-on` trzeba użyć `fromJSON`.

### Token

W repozytorium wywołującym dodaj Actions secret `RUNNER_API_TOKEN`. Użyj fine-grained PAT ograniczonego do wybranych repozytoriów, z uprawnieniem repozytorium **Administration: Read**. Zwykły `GITHUB_TOKEN` nie ma uprawnienia do odczytu tej listy. Token jest przekazywany jawnie jako sekret wywołania; nie zapisuj go w plikach ani w tym repozytorium.

### Ograniczenia

- Domyślna etykieta `ubuntu-26.04` występuje zarówno na własnych runnerach, jak i w nazwie oficjalnego obrazu. GitHub [odradza takie kolizje](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#defining-runner-labels): fallback zwracający samo `["ubuntu-26.04"]` nie gwarantuje jednoznacznego wyboru runnera GitHuba. Aby zapewnić rozróżnienie, własne runnery powinny używać innej etykiety, np. `ubuntu-26.04-self-hosted`, także w `primary-runner`.
- Wybór sprawdza status online w chwili wykonania. Własny runner nie musi być wolny; zadania mogą czekać w kolejce. Nie ma rezerwacji instancji.
- Gdy PC zniknie po wyborze, GitHub nie przeniesie już przydzielonego zadania na runner hosted. To nie jest mechanizm ponawiania zadań po awarii.
- Akcja dopasowuje etykiety z uwzględnieniem wielkości liter. Używaj nazw zwracanych przez GitHub, np. `Linux` i `X64`.
- Workflow nie udostępnia runnera innym repozytoriom. Na koncie osobistym każda rejestracja runnera nadal jest związana z jednym repozytorium.
- Runner Linux obsługuje zadania zgodne z Linuxem. Zadania wymagające macOS albo Windows potrzebują odpowiedniej instancji i zgodnego fallbacku.

Implementacja używa [O-Mutt/runner-fallback-action](https://github.com/O-Mutt/runner-fallback-action) v2.0.0, przypiętej do SHA `f560f38018b223f50079f2006847fcb5cf07f490`. `fallback-on-error` jest włączone. Parametr `primaries-required` pozostaje nieustawiony, dzięki czemu zajęty runner online nie powoduje wyboru fallbacku.
