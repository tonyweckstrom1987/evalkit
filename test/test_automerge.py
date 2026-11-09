"""Testit tools/automerge.py:lle (rajatut polut, tarkastajan paatos, rakenne- ja kokonaisarvio, main)."""
import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

_POLKU = Path(__file__).resolve().parent.parent / "tools" / "automerge.py"
_spec = importlib.util.spec_from_file_location("automerge_under_test", _POLKU)
am = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(am)

SHA = "a" * 40
VANHA_SHA = "b" * 40


def merkki(sha=SHA, paatos="HYVAKSYTTY"):
    return "<!-- riippumaton-tarkastus v1 sha=%s paatos=%s -->" % (sha, paatos)


def kommentti(body, user=am.BOTTI):
    return {"user": user, "body": body}


def pr(**yli):
    d = {
        "draft": False,
        "head_repo": "tonyweckstrom1987/evalkit",
        "base_repo": "tonyweckstrom1987/evalkit",
        "labels": [],
        "author": "tonyweckstrom1987",
        "head_ref": "oma-haara",
        "head_sha": SHA,
        "base_ref": "main",
        "state": "open",
    }
    d.update(yli)
    return d


def tiedosto(nimi="src/cli.ts", changes=10, patch="+const a = 1;", **yli):
    d = {"filename": nimi, "changes": changes, "patch": patch}
    d.update(yli)
    return d


class RajattuTest(unittest.TestCase):
    def test_tavallinen_polku_sallittu(self):
        self.assertIsNone(am.rajattu("evalkit", "src/cli.ts"))
        self.assertIsNone(am.rajattu("evalkit", "test/test_automerge.py"))

    def test_tyonkulut_ja_automerge(self):
        self.assertEqual(am.rajattu("evalkit", ".github/workflows/ci.yml"), "tyonkulut (.github)")
        self.assertEqual(am.rajattu("evalkit", "tools/automerge.py"), "automergen saannot")

    def test_automergen_nimiset_muut_tiedostot_sallittu(self):
        self.assertIsNone(am.rajattu("evalkit", "tools/automerge.py.bak"))
        self.assertIsNone(am.rajattu("evalkit", "test/test_automerge.py"))

    def test_julkaistu_action(self):
        self.assertEqual(am.rajattu("evalkit", "action.yml"), "julkaistu Action")
        self.assertEqual(am.rajattu("evalkit", "action.yaml"), "julkaistu Action")
        self.assertEqual(am.rajattu("evalkit", "dist/index.js"), "julkaistu Action")
        self.assertIsNone(am.rajattu("evalkit", "docs/action.yml.md"))

    def test_oikeudet(self):
        for polku in ("pr_kutsu.py", "agentti/github_app.py", "claudejono-pr", "x/asenna-kayttaja.sh", "etc/sudoers.d/yo"):
            with self.subTest(polku=polku):
                self.assertEqual(am.rajattu("evalkit", polku), "oikeudet")

    def test_kulukatot(self):
        self.assertEqual(am.rajattu("evalkit", "rajat.py"), "kulukatot ja rajat")
        self.assertEqual(am.rajattu("evalkit", "pkg/config.py"), "kulukatot ja rajat")
        self.assertEqual(am.rajattu("evalkit", "claudejono/varaus.py"), "kulukatot (Tonyn varaus)")

    def test_yojono_vain_testitiedostot_sallittu(self):
        self.assertEqual(am.rajattu("evalkit", "yojono/ajuri.py"), "kulukatot (yojono)")
        self.assertIsNone(am.rajattu("evalkit", "yojono/test_ajuri.py"))
        self.assertEqual(am.rajattu("evalkit", "yojono/test_ajuri.txt"), "kulukatot (yojono)")

    def test_palomuuri_ja_salaisuudet_kirjainkoosta_riippumatta(self):
        self.assertEqual(am.rajattu("evalkit", "docs/Firewall.md"), "palomuuri")
        self.assertEqual(am.rajattu("evalkit", "etc/nftables.conf"), "palomuuri")
        for polku in (".env", "app/.env.local", "src/secrets.ts", "deploy/server.pem", "id_ed25519", "API_KEY.txt"):
            with self.subTest(polku=polku):
                self.assertEqual(am.rajattu("evalkit", polku), "salaisuudet")

    def test_virheelliset_polut(self):
        for polku in ("", None, "/etc/hosts", "a b", "../x", "a/../b", "ääkköset.ts", "a\nb"):
            with self.subTest(polku=polku):
                self.assertEqual(am.rajattu("evalkit", polku), "polku")

    def test_kauppatiimin_lisarajaukset(self):
        for polku in ("src/salkku.py", "riskivahti.py", "data/x.csv", "ajuri.service", "a/b.db", "a/b.sqlite3"):
            with self.subTest(polku=polku):
                self.assertEqual(am.rajattu("kauppatiimi", polku), "oikea raha")
        self.assertIsNone(am.rajattu("evalkit", "src/salkku.py"))
        self.assertIsNone(am.rajattu("evalkit", "data/x.csv"))
        self.assertIsNone(am.rajattu("kauppatiimi", "src/raportti.py"))


class TarkastajanPaatosTest(unittest.TestCase):
    def test_ei_kommentteja(self):
        self.assertIsNone(am.tarkastajan_paatos([], SHA))
        self.assertIsNone(am.tarkastajan_paatos(None, SHA))

    def test_hyvaksynta_loytyy(self):
        self.assertEqual(am.tarkastajan_paatos([kommentti(merkki())], SHA), "HYVAKSYTTY")

    def test_vain_botin_kommentit_kelpaavat(self):
        k = [kommentti(merkki(), user="joku-muu"), kommentti(merkki(), user=None), {"body": merkki()}]
        self.assertIsNone(am.tarkastajan_paatos(k, SHA))

    def test_viimeisin_paatos_voittaa(self):
        k = [kommentti(merkki(paatos="HYLATTY")), kommentti(merkki(paatos="HYVAKSYTTY"))]
        self.assertEqual(am.tarkastajan_paatos(k, SHA), "HYVAKSYTTY")
        k.reverse()
        self.assertEqual(am.tarkastajan_paatos(k, SHA), "HYLATTY")

    def test_toisen_commitin_paatos_ei_vaikuta(self):
        k = [kommentti(merkki(paatos="HYVAKSYTTY")), kommentti(merkki(sha=VANHA_SHA, paatos="HYLATTY"))]
        self.assertEqual(am.tarkastajan_paatos(k, SHA), "HYVAKSYTTY")
        self.assertIsNone(am.tarkastajan_paatos([kommentti(merkki(sha=VANHA_SHA))], SHA))

    def test_kaksi_merkkia_samassa_kommentissa_ei_kelpaa(self):
        self.assertIsNone(am.tarkastajan_paatos([kommentti(merkki() + "\n" + merkki())], SHA))

    def test_virheelliset_merkit_ohitetaan(self):
        for body in (merkki(paatos="KYLLA"), "<!-- riippumaton-tarkastus v1 sha=abc paatos=HYVAKSYTTY -->", merkki(sha="A" * 40), "", None):
            with self.subTest(body=body):
                self.assertIsNone(am.tarkastajan_paatos([kommentti(body)], SHA))

    def test_kaikki_paatosarvot_tunnistetaan(self):
        for p in ("HYVAKSYTTY", "HYLATTY", "RAJATTU", "EN_TIEDA"):
            with self.subTest(paatos=p):
                self.assertEqual(am.tarkastajan_paatos([kommentti(merkki(paatos=p))], SHA), p)

    def test_hylkays_hyvaksynnan_jalkeen_kumoaa_hyvaksynnan(self):
        k = [kommentti(merkki(paatos="HYVAKSYTTY")), kommentti(merkki(paatos="EN_TIEDA"))]
        self.assertEqual(am.tarkastajan_paatos(k, SHA), "EN_TIEDA")


class LisatytRivitTest(unittest.TestCase):
    def test_vain_lisatyt_rivit_ilman_otsikkoa(self):
        patch = "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n konteksti\n-poistettu\n+lisatty\n++kaksi"
        self.assertEqual(am._lisatyt_rivit(patch), ["lisatty", "+kaksi"])

    def test_tyhja_ja_none(self):
        self.assertEqual(am._lisatyt_rivit(None), [])
        self.assertEqual(am._lisatyt_rivit(""), [])


class BotinForkkiSyytTest(unittest.TestCase):
    def forkki(self, **yli):
        oletus = {"author": am.BOTTI, "head_repo": "%s/evalkit" % am.BOTTI, "head_ref": "yo/testit-2026-11-09"}
        oletus.update(yli)
        return pr(**oletus)

    def test_kelvollinen_forkki(self):
        self.assertEqual(am.botin_forkki_syyt(self.forkki()), [])

    def test_kirjainkoko_ei_merkitse_tekijassa_ja_repossa(self):
        p = self.forkki(author=am.BOTTI.upper(), head_repo="%s/EvalKit" % am.BOTTI.upper())
        self.assertEqual(am.botin_forkki_syyt(p), [])

    def test_vieras_tekija(self):
        self.assertEqual(am.botin_forkki_syyt(self.forkki(author="joku")), ["forkista vain botin PR"])

    def test_vaara_head_repo(self):
        syyt = am.botin_forkki_syyt(self.forkki(head_repo="%s/toinen" % am.BOTTI))
        self.assertEqual(syyt, ["forkki ei ole botin oma fork samasta reposta"])

    def test_base_repo_ilman_omistajaa(self):
        syyt = am.botin_forkki_syyt(self.forkki(base_repo="evalkit"))
        self.assertIn("forkki ei ole botin oma fork samasta reposta", syyt)

    def test_haaran_nimi(self):
        for ref in ("main", "yo/", "yo/Iso", "yo/-alku", "yo/a b", "yo/a\n", "yo/" + "a" * 61, None):
            with self.subTest(ref=ref):
                self.assertEqual(am.botin_forkki_syyt(self.forkki(head_ref=ref)), ["botin haaran nimi ei ole yo/<nimi>"])
        for ref in ("yo/a", "yo/0.x_y-z", "yo/" + "a" * 60):
            with self.subTest(ref=ref):
                self.assertEqual(am.botin_forkki_syyt(self.forkki(head_ref=ref)), [])

    def test_useita_syita(self):
        syyt = am.botin_forkki_syyt(self.forkki(author="joku", head_ref="x"))
        self.assertEqual(len(syyt), 2)


class RakenneSyytTest(unittest.TestCase):
    def test_kelvollinen_pr(self):
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto()]), [])

    def test_luonnos(self):
        self.assertEqual(am.rakenne_syyt(pr(draft=True), [tiedosto()]), ["luonnos"])

    def test_base_haara(self):
        self.assertEqual(am.rakenne_syyt(pr(base_ref="develop"), [tiedosto()]), ["base ei ole main eika master"])
        self.assertEqual(am.rakenne_syyt(pr(base_ref="master"), [tiedosto()]), [])
        self.assertEqual(am.rakenne_syyt(pr(base_ref=None), [tiedosto()]), ["base ei ole main eika master"])

    def test_opt_out_tunniste(self):
        self.assertEqual(am.rakenne_syyt(pr(labels=[am.OPT_OUT]), [tiedosto()]), ["tunniste " + am.OPT_OUT])
        self.assertEqual(am.rakenne_syyt(pr(labels=None), [tiedosto()]), [])

    def test_rajatut_repot(self):
        for nimi, selite in am.RAJATUT_REPOT.items():
            with self.subTest(repo=nimi):
                repo = "tonyweckstrom1987/" + nimi
                syyt = am.rakenne_syyt(pr(head_repo=repo, base_repo=repo), [tiedosto()])
                self.assertEqual(syyt, ["rajattu repo: " + selite])

    def test_vieras_fork_antaa_forkkisyyt(self):
        syyt = am.rakenne_syyt(pr(head_repo="joku/evalkit", author="joku"), [tiedosto()])
        self.assertIn("forkista vain botin PR", syyt)

    def test_botin_oma_fork_kelpaa(self):
        p = pr(head_repo="%s/evalkit" % am.BOTTI, author=am.BOTTI, head_ref="yo/testit")
        self.assertEqual(am.rakenne_syyt(p, [tiedosto()]), [])

    def test_ei_tiedostoja(self):
        self.assertEqual(am.rakenne_syyt(pr(), []), ["ei tiedostoja"])

    def test_tiedostomaaran_raja(self):
        raja = [tiedosto("src/f%d.ts" % i, changes=1) for i in range(am.MAX_TIEDOSTOA)]
        self.assertEqual(am.rakenne_syyt(pr(), raja), [])
        yli = raja + [tiedosto("src/yli.ts", changes=1)]
        self.assertEqual(am.rakenne_syyt(pr(), yli), ["liian monta tiedostoa (%d)" % (am.MAX_TIEDOSTOA + 1)])

    def test_rivimaaran_raja_summaa_tiedostot(self):
        ok = [tiedosto("src/a.ts", changes=am.MAX_RIVEJA - 1), tiedosto("src/b.ts", changes=1)]
        self.assertEqual(am.rakenne_syyt(pr(), ok), [])
        yli = [tiedosto("src/a.ts", changes=am.MAX_RIVEJA), tiedosto("src/b.ts", changes=1)]
        self.assertEqual(am.rakenne_syyt(pr(), yli), ["liian suuri muutos (%d rivia)" % (am.MAX_RIVEJA + 1)])

    def test_changes_none_tulkitaan_nollaksi(self):
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto(changes=None, patch=None)]), [])

    def test_rajattu_tiedosto(self):
        syyt = am.rakenne_syyt(pr(), [tiedosto(".github/workflows/ci.yml")])
        self.assertEqual(syyt, ["rajattu (tyonkulut (.github)): .github/workflows/ci.yml"])

    def test_uudelleennimeaminen_rajatusta_polusta_estetaan(self):
        t = tiedosto("src/ci.yml", status="renamed", previous_filename=".github/workflows/ci.yml")
        syyt = am.rakenne_syyt(pr(), [t])
        self.assertEqual(syyt, ["rajattu (tyonkulut (.github)): .github/workflows/ci.yml"])

    def test_uudelleennimeaminen_rajattuun_polkuun_estetaan(self):
        t = tiedosto(".github/x.yml", previous_filename="src/x.yml")
        self.assertEqual(len(am.rakenne_syyt(pr(), [t])), 1)

    def test_sama_rajattu_syy_ei_toistu(self):
        t = tiedosto("action.yml", previous_filename="action.yml")
        self.assertEqual(am.rakenne_syyt(pr(), [t]), ["rajattu (julkaistu Action): action.yml"])

    def test_poisto_sallittu_muualla(self):
        t = tiedosto("src/vanha.ts", changes=20, patch="-poistettu rivi", status="removed")
        self.assertEqual(am.rakenne_syyt(pr(), [t]), [])

    def test_kauppatiimin_rajaus_vaikuttaa_vain_siihen_repoon(self):
        repo = "tonyweckstrom1987/kauppatiimi"
        p = pr(head_repo=repo, base_repo=repo)
        self.assertEqual(am.rakenne_syyt(p, [tiedosto("src/salkku.py")]), ["rajattu (oikea raha): src/salkku.py"])
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto("src/salkku.py")]), [])

    def test_patch_puuttuu(self):
        syyt = am.rakenne_syyt(pr(), [tiedosto("kuva.png", changes=5, patch=None)])
        self.assertEqual(syyt, ["patch puuttuu (binaari tai liian suuri): kuva.png"])

    def test_patch_puuttuu_mutta_ei_muutoksia_sallittu(self):
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto("src/uusi-nimi.ts", changes=0, patch=None)]), [])

    def test_yksityiset_osoitteet_lisatyilla_riveilla(self):
        for osoite in ("10.0.0.5", "192.168.1.20", "172.16.0.1", "172.31.255.1", "100.64.0.1", "100.127.1.2", "host.tail1234.ts.net", "HOST.TS.NET"):
            with self.subTest(osoite=osoite):
                t = tiedosto("README.md", patch="+palvelin: %s" % osoite)
                syyt = am.rakenne_syyt(pr(), [t])
                self.assertEqual(syyt, ["lisatylla rivilla yksityinen osoite tai tailnet-nimi: README.md"])

    def test_julkiset_osoitteet_sallittu(self):
        for osoite in ("8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1", "100.128.0.1", "11.0.0.1", "ts.net.example.com"):
            with self.subTest(osoite=osoite):
                t = tiedosto("README.md", patch="+palvelin: %s" % osoite)
                self.assertEqual(am.rakenne_syyt(pr(), [t]), [])

    def test_osoite_vain_poistetulla_tai_kontekstirivilla_sallittu(self):
        patch = "@@ -1,2 +1,1 @@\n-vanha 10.0.0.5\n konteksti 192.168.0.1\n+uusi"
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto("README.md", patch=patch)]), [])

    def test_osoite_tiedostotunnisteessa_ei_laske(self):
        patch = "--- a/10.0.0.5\n+++ b/10.0.0.5\n+ok"
        self.assertEqual(am.rakenne_syyt(pr(), [tiedosto("README.md", patch=patch)]), [])

    def test_syyt_kasautuvat(self):
        syyt = am.rakenne_syyt(pr(draft=True, base_ref="dev"), [])
        self.assertEqual(syyt, ["luonnos", "base ei ole main eika master", "ei tiedostoja"])


class ArvioiTest(unittest.TestCase):
    def test_hyvaksytty_kelpaa(self):
        self.assertEqual(am.arvioi(pr(), [tiedosto()], [kommentti(merkki())]), (True, []))

    def test_ilman_tarkastusta_odottaa(self):
        sallittu, syyt = am.arvioi(pr(), [tiedosto()])
        self.assertFalse(sallittu)
        self.assertEqual(syyt, ["riippumaton tarkastus: odottaa"])

    def test_muut_paatokset_estavat(self):
        for p in ("HYLATTY", "RAJATTU", "EN_TIEDA"):
            with self.subTest(paatos=p):
                sallittu, syyt = am.arvioi(pr(), [tiedosto()], [kommentti(merkki(paatos=p))])
                self.assertFalse(sallittu)
                self.assertEqual(syyt, ["riippumaton tarkastus: " + p])

    def test_vanhan_commitin_hyvaksynta_ei_kelpaa(self):
        sallittu, syyt = am.arvioi(pr(), [tiedosto()], [kommentti(merkki(sha=VANHA_SHA))])
        self.assertFalse(sallittu)
        self.assertEqual(syyt, ["riippumaton tarkastus: odottaa"])

    def test_virheellinen_head_sha_ei_kelpaa_vaikka_merkki_tasmaa(self):
        for sha in ("abc", "", None, "A" * 40, "a" * 41):
            with self.subTest(sha=sha):
                kommentit = [kommentti("<!-- riippumaton-tarkastus v1 sha=%s paatos=HYVAKSYTTY -->" % sha)]
                sallittu, _ = am.arvioi(pr(head_sha=sha), [tiedosto()], kommentit)
                self.assertFalse(sallittu)

    def test_hyvaksynta_ei_ohita_rakennesyita(self):
        sallittu, syyt = am.arvioi(pr(), [tiedosto(".github/workflows/ci.yml")], [kommentti(merkki())])
        self.assertFalse(sallittu)
        self.assertEqual(syyt, ["rajattu (tyonkulut (.github)): .github/workflows/ci.yml"])

    def test_vieraan_hyvaksynta_ei_kelpaa(self):
        sallittu, _ = am.arvioi(pr(), [tiedosto()], [kommentti(merkki(), user="agentti")])
        self.assertFalse(sallittu)


def gh_vastaus(returncode=0, stdout="", stderr=""):
    return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=stderr)


class GhHakuTest(unittest.TestCase):
    def test_hae_pr_jasentaa_kentat(self):
        data = {
            "draft": 1,
            "state": "open",
            "head": {"repo": {"full_name": "bot/evalkit"}, "ref": "yo/x", "sha": SHA},
            "base": {"repo": {"full_name": "tony/evalkit"}, "ref": "main"},
            "labels": [{"name": "a"}, {"name": "b"}],
            "user": {"login": "bot"},
        }
        import json
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(stdout=json.dumps(data))) as gh:
            tulos = am.hae_pr("tony/evalkit", "7")
        gh.assert_called_once_with("api", "repos/tony/evalkit/pulls/7")
        self.assertEqual(tulos, {
            "draft": True, "state": "open", "head_repo": "bot/evalkit", "base_repo": "tony/evalkit",
            "labels": ["a", "b"], "author": "bot", "head_ref": "yo/x", "head_sha": SHA, "base_ref": "main",
        })

    def test_hae_pr_puuttuvat_kentat_eivat_kaada(self):
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(stdout="{}")):
            tulos = am.hae_pr("a/b", "1")
        self.assertFalse(tulos["draft"])
        self.assertEqual(tulos["labels"], [])
        self.assertIsNone(tulos["head_repo"])
        self.assertIsNone(tulos["author"])

    def test_hae_pr_virhe_nostaa_runtimeerrorin_ja_lyhentaa_viestin(self):
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(returncode=1, stderr="x" * 500 + "LOPPU")):
            with self.assertRaises(RuntimeError) as ctx:
                am.hae_pr("a/b", "1")
        self.assertTrue(str(ctx.exception).startswith("PR:n haku epaonnistui: "))
        self.assertTrue(str(ctx.exception).endswith("LOPPU"))
        self.assertLessEqual(len(str(ctx.exception)), len("PR:n haku epaonnistui: ") + 200)

    def test_hae_tiedostot_lukee_rivit_ja_ohittaa_tyhjat(self):
        out = '{"filename": "a"}\n\n  \n{"filename": "b"}\n'
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(stdout=out)) as gh:
            self.assertEqual(am.hae_tiedostot("a/b", "3"), [{"filename": "a"}, {"filename": "b"}])
        self.assertEqual(gh.call_args.args[:2], ("api", "--paginate"))

    def test_hae_tiedostot_virhe(self):
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(returncode=1, stderr="rikki")):
            with self.assertRaisesRegex(RuntimeError, "tiedostojen haku epaonnistui: rikki"):
                am.hae_tiedostot("a/b", "3")

    def test_hae_kommentit_lukee_rivit(self):
        out = '{"user": "bot", "body": "hei"}\n'
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(stdout=out)):
            self.assertEqual(am.hae_kommentit("a/b", "3"), [{"user": "bot", "body": "hei"}])

    def test_hae_kommentit_virhe(self):
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(returncode=1, stderr="rikki")):
            with self.assertRaisesRegex(RuntimeError, "kommenttien haku epaonnistui: rikki"):
                am.hae_kommentit("a/b", "3")

    def test_virheellinen_json_nostaa_valueerrorin(self):
        with mock.patch.object(am, "_gh", return_value=gh_vastaus(stdout="ei json")):
            with self.assertRaises(ValueError):
                am.hae_tiedostot("a/b", "3")


class YhteenvetoTest(unittest.TestCase):
    def test_tulostaa_ja_kirjoittaa_tiedostoon(self):
        with tempfile.TemporaryDirectory() as hakemisto:
            polku = os.path.join(hakemisto, "yhteenveto.md")
            puskuri = io.StringIO()
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": polku}), contextlib.redirect_stdout(puskuri):
                am.yhteenveto("eka")
                am.yhteenveto("toka")
            self.assertEqual(puskuri.getvalue(), "eka\ntoka\n")
            self.assertEqual(Path(polku).read_text(), "eka\ntoka\n")

    def test_ilman_ymparistomuuttujaa_vain_tuloste(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_STEP_SUMMARY"}
        puskuri = io.StringIO()
        with mock.patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(puskuri):
            am.yhteenveto("vain tuloste")
        self.assertEqual(puskuri.getvalue(), "vain tuloste\n")

    def test_kirjoitusvirhe_ei_kaada(self):
        with tempfile.TemporaryDirectory() as hakemisto:
            polku = os.path.join(hakemisto, "puuttuva", "yhteenveto.md")
            puskuri = io.StringIO()
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": polku}), contextlib.redirect_stdout(puskuri):
                am.yhteenveto("jatkuu")
            self.assertEqual(puskuri.getvalue(), "jatkuu\n")
            self.assertFalse(os.path.exists(polku))


class MainTest(unittest.TestCase):
    ENV = {"GITHUB_REPOSITORY": "tonyweckstrom1987/evalkit", "PR_NUMBER": "42"}

    def aja(self, env=None, hae_pr=None, hae_tiedostot=None, hae_kommentit=None, gh=None):
        patches = [
            mock.patch.dict(os.environ, env if env is not None else self.ENV),
            mock.patch.object(am, "hae_pr", **({"side_effect": hae_pr} if isinstance(hae_pr, Exception) else {"return_value": hae_pr or pr()})),
            mock.patch.object(am, "hae_tiedostot", return_value=hae_tiedostot if hae_tiedostot is not None else [tiedosto()]),
            mock.patch.object(am, "hae_kommentit", return_value=hae_kommentit if hae_kommentit is not None else [kommentti(merkki())]),
            mock.patch.object(am, "_gh", return_value=gh or gh_vastaus()),
            mock.patch.object(am, "yhteenveto"),
        ]
        with contextlib.ExitStack() as stack:
            mocks = [stack.enter_context(p) for p in patches]
            koodi = am.main()
        return koodi, {"hae_pr": mocks[1], "gh": mocks[4], "yhteenveto": mocks[5]}

    def test_virheellinen_repo_tai_numero(self):
        for env in (
            {"GITHUB_REPOSITORY": "", "PR_NUMBER": "1"},
            {"GITHUB_REPOSITORY": "ei-vinoviivaa", "PR_NUMBER": "1"},
            {"GITHUB_REPOSITORY": "a/b; rm -rf", "PR_NUMBER": "1"},
            {"GITHUB_REPOSITORY": "a/b", "PR_NUMBER": ""},
            {"GITHUB_REPOSITORY": "a/b", "PR_NUMBER": "1;2"},
            {"GITHUB_REPOSITORY": "a/b", "PR_NUMBER": "-1"},
        ):
            with self.subTest(env=env):
                with mock.patch.dict(os.environ, env), mock.patch.object(am, "hae_pr") as hae, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(am.main(), 2)
                hae.assert_not_called()

    def test_suljettu_pr_ei_tee_mitaan(self):
        koodi, m = self.aja(hae_pr=pr(state="closed"))
        self.assertEqual(koodi, 0)
        m["gh"].assert_not_called()
        self.assertIn("ei ole auki", m["yhteenveto"].call_args.args[0])

    def test_haun_virhe_palauttaa_1_eika_muuta_mitaan(self):
        koodi, m = self.aja(hae_pr=RuntimeError("verkko"))
        self.assertEqual(koodi, 1)
        m["gh"].assert_not_called()
        self.assertIn("verkko", m["yhteenveto"].call_args.args[0])

    def test_kelvollinen_pr_kytkee_automergen(self):
        koodi, m = self.aja()
        self.assertEqual(koodi, 0)
        m["gh"].assert_called_once_with("pr", "merge", "42", "--auto", "--squash", "--match-head-commit", SHA, "--repo", "tonyweckstrom1987/evalkit")
        self.assertIn("kelpaa", m["yhteenveto"].call_args.args[0])

    def test_kytkennan_epaonnistuminen_palauttaa_1(self):
        koodi, m = self.aja(gh=gh_vastaus(returncode=1, stderr="ei oikeuksia"))
        self.assertEqual(koodi, 1)
        self.assertIn("kytkenta epaonnistui: ei oikeuksia", m["yhteenveto"].call_args.args[0])

    def test_kelpaamaton_pr_poistaa_automergen(self):
        koodi, m = self.aja(hae_tiedostot=[tiedosto(".github/workflows/ci.yml")])
        self.assertEqual(koodi, 0)
        m["gh"].assert_called_once_with("pr", "merge", "42", "--disable-auto", "--repo", "tonyweckstrom1987/evalkit")
        viesti = m["yhteenveto"].call_args.args[0]
        self.assertIn("Auto-merge poistettu", viesti)
        self.assertIn(".github/workflows/ci.yml", viesti)

    def test_ilman_tarkastajan_hyvaksyntaa_poistaa_automergen(self):
        koodi, m = self.aja(hae_kommentit=[])
        self.assertEqual(koodi, 0)
        self.assertEqual(m["gh"].call_args.args[:4], ("pr", "merge", "42", "--disable-auto"))
        self.assertIn("odottaa", m["yhteenveto"].call_args.args[0])

    def test_virheellinen_json_palauttaa_1(self):
        koodi, m = self.aja(hae_pr=ValueError("rikkinainen json"))
        self.assertEqual(koodi, 1)
        m["gh"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
