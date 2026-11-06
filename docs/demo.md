# Demo: regressio kaataa CI:n, korjaus korjaa sen

*English summary at the end.*

**Ongelma:** kun vaihdat promptin tai mallin, jokin aiemmin toiminut vastaus voi hiljaa rikkoutua, eikä kukaan huomaa sitä ennen kuin käyttäjä huomaa. Evalkit vertaa ajoa hyväksyttyyn baselineen ja kaataa CI:n vain, jos jokin aiemmin läpäissyt tapaus ei enää läpäise.

Tämä demo kestää noin kolme minuuttia, eikä se tarvitse API-avainta, verkkoa eikä rahaa. Mallivastaukset ovat **käsin kirjoitettu valemalli**, joka on tallennettu cassette-tiedostoihin. Demo siis todistaa evalkitin toiminnan (ehdot, baseline, poistumiskoodit), ei minkään oikean mallin laatua.

Tiedostot:

- [`examples/yleinen-fi.json`](../examples/yleinen-fi.json): evalset, kolme tapausta (`lasku-01` odottaa vastaukseksi `42`)
- [`examples/demo/baseline.json`](../examples/demo/baseline.json): hyväksytty tila, jossa kaikki kolme läpäisevät
- [`examples/demo/ennen.cassette.json`](../examples/demo/ennen.cassette.json): "rikkoutunut malli" vastaa `17 + 25` -kysymykseen `41`
- [`examples/demo/jalkeen.cassette.json`](../examples/demo/jalkeen.cassette.json): "korjattu malli" vastaa `42`
- [`examples/demo/luo.mjs`](../examples/demo/luo.mjs): luo kaksi cassettea ja baselinen valemallilla (ei verkkokutsuja)

Testi [`test/demo.test.ts`](../test/demo.test.ts) ajaa molemmat vaiheet jokaisessa testiajossa, joten alla olevat tulosteet pysyvät totena.

## Valmistelu (kerran)

Tarvitset Node.js 22:n tai 24:n.

```bash
git clone https://github.com/tonyweckstrom1987/evalkit.git
cd evalkit
npm ci          # asentaa ja kääntää
node dist/bin.js validate examples/yleinen-fi.json
```

```text
OK examples/yleinen-fi.json: 3 tapausta
```

## 1. Ennen: regressio kaataa ajon

```bash
node dist/bin.js run examples/yleinen-fi.json --models demo \
  --base-url https://litellm.example/v1 \
  --baseline examples/demo/baseline.json \
  --cassette examples/demo/ennen.cassette.json
echo "exit=$?"
```

```text
Evalkit: yleinen-fi
  demo: passed 2/3 (67 %), errors 0
Failed cases:
  - demo / lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
Comparison to baseline:
  regressions: 1, fixed: 0, new: 0, missing: 0
  REGRESSION demo::lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
  demo: pass rate dropped by 33 percentage points
exit=1
```

`lasku-01` läpäisi baselinessa mutta ei nyt, joten kyseessä on regressio ja poistumiskoodi on `1`. CI-työnkulku kaatuu.

## 2. Jälkeen: korjauksen jälkeen ajo menee läpi

```bash
node dist/bin.js run examples/yleinen-fi.json --models demo \
  --base-url https://litellm.example/v1 \
  --baseline examples/demo/baseline.json \
  --cassette examples/demo/jalkeen.cassette.json
echo "exit=$?"
```

```text
Evalkit: yleinen-fi
  demo: passed 3/3 (100 %), errors 0
Comparison to baseline:
  regressions: 0, fixed: 0, new: 0, missing: 0
exit=0
```

Sama evalset ja sama baseline, vain mallin (tässä: tallenteen) vastaus on eri. Käytännössä "korjaus" on promptin, mallin tai asetuksen muutos, jonka jälkeen vastaukset tallennetaan uudelleen `--cassette-mode record` -tilassa.

## 3. GitHub Action (copy-paste)

Lisää repoon `.github/workflows/eval.yml`. Kiinnitä versio commit-tunnisteeseen (`<commit-sha>`), ei haaraan. Tämä versio ei käytä avainta eikä tee verkkokutsuja: se toistaa tallennetut vastaukset.

```yaml
name: eval
on: [pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Ilmainen muototarkistus (ei verkkoa)
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          mode: validate
          eval-set: evals/yleinen.json

      # Regressioportti tallennettuja vastauksia vasten (ei kuluja, ei avainta)
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          eval-set: evals/yleinen.json
          models: demo
          base-url: https://litellm.example/v1
          baseline: evals/evalkit.baseline.json
          cassette: evals/yleinen.cassette.json
```

Action ei koskaan päivitä baselinea. Hyväksy tarkoituksellinen muutos paikallisesti `--update-baseline`-valinnalla ja katselmoi baseline-tiedoston muutos PR:ssä. Oikeilla mallikutsuilla avain annetaan secretistä (ks. [README](../README.md#github-action)). Action-työnkulkua ei ole ajettu tässä demossa; sen CLI-osa on sama kuin yllä ajetut komennot.

## Rajoitukset

- Demon vastaukset ovat käsin kirjoitettuja. Se ei kerro mitään oikeiden mallien laadusta.
- Cassette-toisto testaa evalsetin ja ehtojen toimivuutta tallennettuja vastauksia vasten. Jos prompti tai malli muuttuu, tallenne pitää tehdä uudelleen oikealla mallilla (maksaa).
- Millisekuntiaikoja tai kustannuksia ei raportoida tässä demossa.

## English summary

Evalkit compares an eval run with an approved baseline and fails CI only on regressions. This demo uses hand-written fake model answers recorded into cassette files, so it needs no API key or network. Run 1 (`ennen`) shows `lasku-01` regressing (exit 1); run 2 (`jalkeen`) passes (exit 0). `test/demo.test.ts` keeps the outputs above true.
