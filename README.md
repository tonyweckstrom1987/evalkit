# evalkit

[![CI](https://github.com/tonyweckstrom1987/evalkit/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyweckstrom1987/evalkit/actions/workflows/ci.yml) ![Lisenssi: MIT](https://img.shields.io/badge/lisenssi-MIT-blue.svg)

Aja sama prompt-sarja usealla mallilla ja estä regressiot CI:ssä. Evalkit vertaa tuloksia edelliseen hyväksyttyyn ajoon (baseline) ja kaataa ajon vain, jos jokin aiemmin toiminut tapaus lakkaa toimimasta.

**English summary:** A small CLI that runs one prompt set against several models through any OpenAI-compatible endpoint (LiteLLM, OpenRouter) and compares the results with a stored baseline. Only regressions fail the run, so you can use it as a CI gate. Zod-validated eval set format, hard call caps, no API keys in output. The runner takes an injectable `fetch`, so it works with [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette) for free, deterministic CI runs. Node 22/24, TypeScript.

**Teknologiat:** TypeScript, Node.js 22/24, zod, vitest.

> **Tila:** Versio 0.3.0, julkaistu npm:ään nimellä `@tonyweckstrom/evalkit`. Ydin (skeema, ajo, ehdot, baseline, CLI ja `--cassette`) on testattu mallia kutsumatta. GitHub Action (`action.yml`) on mukana.

## Asennus

Tarvitset Node.js 22:n tai 24:n. Ei asennusta, kokeile suoraan:

```bash
npx @tonyweckstrom/evalkit --version
```

Tai lisää projektiin:

```bash
npm install --save-dev @tonyweckstrom/evalkit
npx evalkit --help
```

## Pika-aloitus

> Komentojen `examples/yleinen-fi.json` on repossa mutta ei npm-paketissa (paketissa on vain `dist/`). Kun asennat paketin npm:stä, lataa tiedosto [repon examples-kansiosta](https://github.com/tonyweckstrom1987/evalkit/blob/main/examples/yleinen-fi.json) tai kirjoita oma evalset (muoto alempana).

```bash
export LLM_API_KEY=...   # ei tarvita, jos rajapinta ei vaadi avainta

# 1) Luo baseline hyväksytystä tilasta
npx @tonyweckstrom/evalkit run examples/yleinen-fi.json \
  --models openrouter/deepseek/deepseek-v4.1-flash \
  --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --update-baseline

# 2) Aja CI:ssä: kaatuu vain regressioon
npx @tonyweckstrom/evalkit run examples/yleinen-fi.json \
  --models openrouter/deepseek/deepseek-v4.1-flash \
  --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json
```

Commitoi `evalkit.baseline.json` repoon. Kun muutat promptia tai mallia ja tulos on tarkoituksella erilainen, päivitä baseline uudelleen `--update-baseline`-valinnalla ja katselmoi muutos.

## Esimerkkituloste

Alla on repon omat testitallenteet (`test/fixtures/action/`) ajettuna `--cassette`-toistolla. Vastaukset ovat valemallin, ei oikean mallin, mutta tuloste on sellaisenaan evalkitin tulostetta. Ensin baseline täsmää, jolloin ajo menee läpi (poistumiskoodi 0), vaikka yksi tapaus kaatuu: se kaatui jo baselinessa.

```text
$ npx evalkit run examples/yleinen-fi.json --models demo --base-url https://litellm.example/v1 \
    --baseline test/fixtures/action/baseline-ok.json --cassette test/fixtures/action/yleinen.cassette.json
Evalkit: yleinen-fi
  demo: passed 2/3 (67 %), errors 0
Failed cases:
  - demo / lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
Comparison to baseline:
  regressions: 0, fixed: 0, new: 0, missing: 0
```

Kun baselinessa sama tapaus oli läpäissyt, sama tulos on regressio ja ajo kaatuu (poistumiskoodi 1):

```text
Comparison to baseline:
  regressions: 1, fixed: 0, new: 0, missing: 0
  REGRESSION demo::lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
  demo: pass rate dropped by 33 percentage points
```


Kolmen minuutin ohje ennen/jälkeen-esimerkkeineen ja GitHub Action -pätkineen: [docs/demo.md](docs/demo.md).

## Evalsetin tarkistus ilman kuluja

```bash
npx evalkit validate examples/yleinen-fi.json evals/*.json
```

`validate` lukee tiedostot, tarkistaa muodon (zod), kaksoisid:t ja virheelliset regex-lausekkeet eikä tee yhtään verkkokutsua. Se palauttaa 0, kun kaikki tiedostot kelpaavat, ja 2, jos yksikin ei kelpaa; kaikki tiedostot käydään läpi, joten saat kaikki virheet kerralla. Sopii CI:n ensimmäiseksi vaiheeksi.

## Evalsetin muoto (versio 1)

```json
{
  "version": 1,
  "name": "yleinen-fi",
  "cases": [
    {
      "id": "yleinen-01",
      "prompt": "Mikä on Ruotsin pääkaupunki?",
      "systemPrompt": "Vastaa yhdellä sanalla.",
      "tags": ["yleinen tieto"],
      "expect": {
        "contains": "Tukholma",
        "notContains": ["Helsinki"],
        "regex": "^Tukholma\\.?$",
        "minJudgeScore": 4
      }
    }
  ]
}
```

| Kenttä | Merkitys |
| --- | --- |
| `version` | Aina `1`. |
| `cases[].id` | Yksilöllinen tunniste. Samaa id:tä ei saa käyttää kahdesti. |
| `cases[].prompt` | Käyttäjän viesti mallille. |
| `cases[].systemPrompt` | Valinnainen järjestelmäviesti. |
| `cases[].tags` | Valinnainen. Ensimmäinen tagi on raportoinnin ryhmä; ilman tageja ryhmä päätellään id:n etuliitteestä (`yleinen-01` → `yleinen`). |
| `cases[].expect` | Valinnainen lista ehtoja. Tapaus läpäisee, kun **kaikki** annetut ehdot täyttyvät. Ilman `expect`-kenttää tapausta ei arvioida (vastaus vain tallentuu raporttiin). |
| `expect.contains` | Vastaus sisältää tekstin (kirjainkoosta riippumatta). |
| `expect.notContains` | Vastaus ei sisällä mitään listan teksteistä. |
| `expect.regex` | Vastaus täsmää säännölliseen lausekkeeseen. Virheellinen lauseke hylätään ennen ajoa. |
| `expect.minJudgeScore` | Tuomarimallin pisteet (1–5) vähintään tämän verran. Vaatii `--judge-model`. |

**Vanha muoto:** mcp-model-routerin taulukkomuoto (`expectedContains`, `category`) luetaan edelleen ja muunnetaan versioksi 1, joten olemassa olevat prompt-tiedostot toimivat sellaisenaan.

## Baseline ja regressioportti

`evalkit.baseline.json` tallentaa jokaisen arvioidun tapauksen tuloksen avaimella `malli::tapausId`.

- **Regressio:** tapaus läpäisi baselinessa mutta ei nyt (myös virhe, esim. aikakatkaisu, lasketaan kaatumiseksi).
- **Korjaantunut:** tapaus kaatui baselinessa mutta läpäisee nyt.
- **Uusi:** tapaus ei ole baselinessa. Uusi kaatuva tapaus ei kaada ajoa; päivitä baseline, kun olet tarkistanut sen.
- **Puuttuva:** tapaus on baselinessa mutta ei tässä ajossa (tapaus poistettu tai mallia ei ajettu).
- **Epävakaa malli:** `--max-pass-drop 0.1` sallii yksittäiset regressiot, kunhan minkään mallin läpäisyprosentti ei laske yli 10 %-yksikköä. Oletus on 0: yksikin regressio kaataa ajon.

Ilman `--baseline`-valintaa kaikkien arvioitavien tapausten pitää läpäistä.

## Poistumiskoodit

| Koodi | Merkitys |
| --- | --- |
| 0 | Ok |
| 1 | Regressio tai (ilman baselinea) epäonnistuneita tapauksia |
| 2 | Virhe käytössä tai asetuksissa (puuttuva valinta, rikkinäinen evalset, puuttuva baseline, ylitetty kutsuraja) |

## Valinnat

| Valinta | Merkitys |
| --- | --- |
| `--models a,b` | Mallit pilkulla eroteltuna (tai `EVALKIT_MODELS`). |
| `--base-url <url>` | OpenAI-yhteensopiva osoite (tai `EVALKIT_BASE_URL`). |
| `--api-key-env <NIMI>` | Ympäristömuuttuja, josta avain luetaan (oletus `LLM_API_KEY`). Avainta ei anneta komentoriville. |
| `--judge-model <malli>` | Tuomarimalli. Valitse eri malli kuin arvioitavat, koska malli suosii omaa vastaustyyliään. |
| `--baseline <tiedosto>` | Vertaa baselineen. |
| `--update-baseline` | Kirjoita tämän ajon tulokset baselineksi. |
| `--max-pass-drop <0-1>` | Sallittu läpäisyprosentin lasku (oletus 0). |
| `--concurrency <n>` | Samanaikaiset kutsut (oletus 4). |
| `--timeout-ms <ms>` | Aikakatkaisu per kutsu (oletus 60000). |
| `--max-tokens <n>` | `max_tokens` per kutsu (oletus 1024, katto 4096). |
| `--cassette <tiedosto>` | Toista tai tallenna mallivastaukset [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette)-tiedostoon (ks. alla). Vaatii paketin `@tonyweckstrom/llm-cassette`. |
| `--cassette-mode <tila>` | `replay` (oletus: ei koskaan verkkoa), `record` tai `auto`. |
| `--json <tiedosto>` | Kirjoita koko raportti JSON-tiedostoon. |

## Kulut ja turvallisuus

- **Kovat katot koodissa:** yksi ajo tekee enintään 200 mallikutsua (tuomarikutsut mukaan lukien), ja `max_tokens` on enintään 4096 per kutsu. Raja tarkistetaan ennen yhtäkään kutsua; sen voi ylittää vain kirjastokäytössä `maxCalls`-asetuksella.
- **API-avain** luetaan vain ympäristömuuttujasta eikä sitä tulosta raporttiin tai virheilmoituksiin.
- Raportti (`--json`) sisältää mallien vastaukset sellaisinaan. Älä commitoi sitä, jos promptit sisältävät arkaluonteista tietoa.

## Ilmaiset CI-ajot: llm-cassette

Oikeat mallikutsut maksavat, ja vastaukset vaihtelevat ajosta toiseen. Tallenna vastaukset kerran [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette)-tiedostoon ja toista ne CI:ssä:

```bash
npm install --save-dev @tonyweckstrom/llm-cassette

# Kerran paikallisesti, oikealla avaimella: tallentaa vastaukset
npx evalkit run examples/yleinen-fi.json --models m --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --cassette test/cassettes/yleinen.json --cassette-mode record

# CI:ssä: toistaa tallenteet, ei verkkoa eikä kuluja (replay on oletus)
npx evalkit run examples/yleinen-fi.json --models m --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --cassette test/cassettes/yleinen.json
```

Commitoi cassette-tiedosto ja baseline repoon. Jos prompti, malli tai tehtävä muuttuu, `replay` ei löydä vanhaa tallennetta ja kyseinen tapaus kaatuu viestillä "tallennetta ei löytynyt". Tallenna silloin uudelleen `record`-tilassa. Huomaa, että tämä testaa **evalsetin ja ehtojen** toimivuutta tallennettuja vastauksia vastaan, ei mallin nykyistä laatua: mallin laadun muutos näkyy vasta uudessa tallennuksessa.

Kirjastona `runEval` ottaa `fetch`-asetuksen:

```ts
import { runEval, loadEvalSet } from "@tonyweckstrom/evalkit";
import { cassetteFetch } from "@tonyweckstrom/llm-cassette";

const report = await runEval({
  set: loadEvalSet("examples/yleinen-fi.json"),
  models: ["m"],
  baseUrl: "https://litellm.local/v1",
  fetch: cassetteFetch({ path: "test/cassettes/yleinen.json" }), // oletus: replay
});
```

## GitHub Action

Evalkit ajetaan toisen repon CI:ssä yhdellä askeleella. Action asentaa ja kääntää evalkitin itse, joten sinun ei tarvitse julkaista tai asentaa mitään. **Kiinnitä versio commit-tunnisteeseen** (ei haaraan), jotta ulkopuolinen muutos ei pääse työnkulkuusi:

```yaml
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Ilmainen ja nopea: tarkistaa tiedostojen muodon ilman verkkoa
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          mode: validate
          eval-set: evals/yleinen.json

      # Toista tallennetut vastaukset (ei kuluja, ei avainta)
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          eval-set: evals/yleinen.json
          models: openrouter/deepseek/deepseek-v4.1-flash
          base-url: https://litellm.example/v1
          baseline: evals/evalkit.baseline.json
          cassette: evals/yleinen.cassette.json
```

Oikeilla mallikutsuilla (maksaa) avain annetaan secretistä askeleen `env`-lohkossa; sitä ei koskaan anneta syötteenä eikä tulosteta:

```yaml
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
        with:
          eval-set: evals/yleinen.json
          models: m1,m2
          base-url: https://litellm.example/v1
          baseline: evals/evalkit.baseline.json
```

| Syöte | Merkitys |
| --- | --- |
| `eval-set` | Evalset-tiedosto (`validate`-tilassa useita välilyönnillä erotettuna). Pakollinen. |
| `mode` | `run` (oletus) tai `validate`. |
| `models`, `base-url` | Pakolliset `run`-tilassa. |
| `baseline`, `max-pass-drop` | Regressioportti (ks. yllä). |
| `cassette`, `cassette-mode` | Toista tai tallenna vastaukset; CI:ssä jätä `cassette-mode` pois (oletus `replay`). |
| `judge-model`, `max-tokens`, `concurrency`, `timeout-ms` | Kuten CLI:n valinnat. |
| `api-key-env` | Avaimen ympäristömuuttujan nimi (oletus `LLM_API_KEY`). |
| `json-report` | Kirjoita raportti JSON-tiedostoon. Raportti sisältää mallien vastaukset; älä commitoi sitä. |

Syötteet välitetään kuoreen ympäristömuuttujina eikä komentoriville, joten arvoissa olevat erikoismerkit eivät suorita komentoja. Action ei koskaan päivitä baselinea: hyväksy muutokset paikallisesti `--update-baseline`-valinnalla ja katselmoi baseline-tiedoston muutos PR:ssä. Action käyttää Node 24:ää.

## Rajoitukset

- Tuomarimalli on vain yhden luvun arvio (1–5), eikä se korvaa ihmisen tarkistusta. Käytä sitä täydentävänä mittarina.
- Striimausta ei tueta, ja vain tekstivastauksia arvioidaan.

## Vaihtoehtoja ja miksi tämä

Evalkit ei ole ensimmäinen eval-työkalu, ja suurempi ja kypsempi vaihtoehto on olemassa. Valitse sen mukaan, mitä tarvitset:

- **[promptfoo](https://github.com/promptfoo/promptfoo)** on laajin avoimen lähdekoodin vaihtoehto: paljon valmiita arviointitapoja, monta mallitarjoajaa, vertailunäkymä ja oma GitHub Action. Jos tarvitset punaisen tiimin testejä, web-käyttöliittymän tai laajan ominaisuusvalikoiman, käytä sitä.
- **[DeepEval](https://github.com/confident-ai/deepeval)** ja **[Inspect](https://inspect.aisi.org.uk/)** ovat Python-työkaluja. Ne sopivat, jos projektisi on Pythonia ja haluat arviointeja pytestin tai tutkimustyön tapaan.
- Evalkit on tarkoituksella pieni (noin 700 riviä, yksi ajonaikainen riippuvuus `zod`) ja keskittyy yhteen kysymykseen: **meneekö jokin aiemmin toiminut tapaus nyt rikki?** Baseline-vertailu on ydin eikä lisäominaisuus, ja vain regressio kaataa CI-ajon. Lisäksi evalset on yksinkertainen JSON-tiedosto, jonka muoto tarkistetaan ilman verkkoa (`validate`), kutsumäärälle on kova katto koodissa, ja yhteensopivuus [llm-cassetten](https://github.com/tonyweckstrom1987/llm-cassette) kanssa antaa ilmaiset ja toistettavat CI-ajot.

Tämä vertailu perustuu hakuun ja työkalujen omiin kuvauksiin, ei kaikkien ominaisuuksien kokeiluun. Tarkista nykyinen tilanne niiden omilta sivuilta.

## Kehitys

```bash
npm ci
npm run typecheck
npm test
npm run build
```
