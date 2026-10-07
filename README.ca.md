# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

Projecte: [chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · Instal·lador: [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

Lector local d’articles acadèmics en PDF per a Windows 10 / 11 x64. Utilitza PDF.js per mostrar els documents i els models ja instal·lats a l’Ollama de l’ordinador per traduir el text seleccionat.

És una eina de lectura personal; la versió actual és la `0.3.1`. La pantalla inicial inclou una il·lustració no oficial de Takamatsu Tomori llegint al seu escriptori. Quan obres un article i hi selecciones text, la traducció apareix en un globus al costat de la selecció. El panell dret conserva tant el text original com la traducció completa.

**La interfície de l’aplicació és actualment en xinès simplificat i les traduccions del text seleccionat també són al xinès simplificat.** Aquesta versió en català correspon únicament a la documentació; no afegeix una interfície ni traduccions al català.

## Per a usuaris: instal·lar i començar a llegir

1. Descarrega `Jiao_Reader-Setup-0.3.1.exe` de la pàgina [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases) i executa’l per completar la instal·lació. Els fitxers etiquetats com a `Source code` contenen el codi font; per utilitzar l’aplicació, només cal descarregar el Setup.
2. Obre Jiao_Reader des de l’escriptori o el menú Inici i obre un PDF o arrossega’l a la finestra.
3. Llegeix de manera contínua amb la roda del ratolí. La barra superior mostra la pàgina actual i el nombre total de pàgines. Pots introduir un número de pàgina per anar-hi directament o ajustar la visualització amb `+`, `−` i “适合宽度” (ajusta a l’amplada).

L’instal·lador inclou l’entorn d’execució de l’aplicació. Els companys amb qui la comparteixis no han d’instal·lar Node.js, Python ni eines de desenvolupament. Per defecte, s’instal·la només per a l’usuari actual de Windows. Pots canviar la carpeta de destinació per una altra on tinguis permís d’escriptura. L’instal·lador crea les dreceres de l’escriptori i del menú Inici, així com l’entrada de desinstal·lació a les aplicacions instal·lades de Windows. La carpeta predeterminada no requereix permisos d’administrador.

**La versió distribuïda encara no té signatura de codi.** Windows SmartScreen o el navegador poden mostrar un avís d’editor desconegut o indicar que Windows ha protegit l’ordinador. Això no està relacionat amb la manca de Node.js o Python. Abans d’executar el fitxer, comprova’n la procedència. L’obtenció d’un certificat de signatura i de reputació per a l’aplicació són tasques pendents per a futures publicacions; no cal desactivar les proteccions del sistema.

Consulta tots els passos inicials a la [guia d’inici ràpid, en xinès](docs/QUICKSTART.zh-CN.md).

## Preparar la traducció local

No cal tenir Ollama per llegir PDF. Per traduir text:

1. Instal·la i inicia [Ollama per a Windows](https://ollama.com/download/windows).
2. Descarrega el model que vulguis fer servir mitjançant Ollama des del PowerShell. Per exemple, pots utilitzar el model del projecte original:

   ```powershell
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. Torna a Jiao_Reader, actualitza l’estat dels models locals i selecciona un model ja instal·lat al panell de models.
4. Selecciona un fragment de text de l’article. El globus al costat de la selecció mostra el progrés i la traducció. El panell dret també conserva el text original i el traduït.

En iniciar-se, l’aplicació comprova si Ollama està disponible a l’ordinador i mostra l’estat de la connexió, de la instal·lació i dels models locals. Si detecta que Ollama està instal·lat però el servei no s’està executant, pots prémer “启动 Ollama” (inicia Ollama). També pots obrir Ollama o executar `ollama serve` al terminal. Quan acabi la descàrrega d’un model, actualitza la llista per poder-lo seleccionar. L’aplicació recorda el model escollit; si l’has eliminat, n’hauràs de seleccionar un altre.

**El panell de models només permet seleccionar models locals que ja estiguin disponibles a Ollama.** No descarrega models, no accepta noms de model arbitraris i no permet importar fitxers GGUF arrossegant-los directament a l’aplicació. Els models nous s’han de preparar amb `ollama pull` o amb les ordres d’importació d’Ollama. L’instal·lador no inclou Ollama ni models i tampoc no els instal·la automàticament.

L’espai en disc, la memòria RAM i la memòria gràfica necessaris depenen del model seleccionat. La primera traducció pot trigar mentre Ollama carrega el model a la memòria. La velocitat i la qualitat de les traduccions també poden variar en canviar de model. Consulta com preparar els models a la [documentació oficial d’Ollama](https://docs.ollama.com/quickstart).

## Llegir i traduir

| Acció | Com fer-la |
| --- | --- |
| Obrir un article | Prem “打开 PDF” (obre PDF), arrossega-hi un fitxer o fes servir `Ctrl+O` |
| Llegir de manera contínua | Fes servir la roda del ratolí o la barra de desplaçament de la dreta |
| Saber en quina pàgina ets | Consulta el número de pàgina de la barra superior o “第 X 页 / 共 N 页” (pàgina X de N) a la part inferior; s’actualitzen mentre et desplaces |
| Anar a una pàgina | Introdueix el número de pàgina a la barra superior i confirma’l |
| Ajustar el zoom | Fes servir `+`, `−`, “适合宽度” (ajusta a l’amplada) o `Ctrl++` / `Ctrl+-` |
| Traduir | Selecciona un fragment de la capa de text del PDF i consulta la traducció al globus que apareix al costat |
| Copiar la traducció | Prem el botó de còpia del globus o de la targeta de traducció del panell dret |
| Canviar de model | Actualitza la llista i selecciona un model instal·lat a l’ordinador |
| Gestionar lectures recents | Elimina una entrada amb el seu botó d’eliminació o prem “清空” (buida) per treure-les totes; es conserven els PDF originals |

La selecció per arrossegament gestiona millor els espais entre línies, els marges de pàgina i el text en dues columnes, i redueix les ampliacions sobtades de la selecció o els salts al final de la pàgina. Quan es detecten clarament les columnes, cada selecció es manté a la columna on comença; inicia una selecció nova per traduir l’altra columna. Si el document té una disposició complexa, comprova que el text original del panell dret coincideixi amb el que volies seleccionar. Eliminar entrades de les lectures recents només modifica la llista: no esborra els PDF del disc ni tanca l’article que tens obert.

Els PDF es llegeixen localment. El text seleccionat s’envia al servei local a `127.0.0.1:11434`. Actualment, cal que el PDF tingui una capa de text que es pugui extreure; els documents escanejats requereixen OCR previ. Cada PDF pot ocupar com a màxim 200 MB i cada traducció pot contenir fins a 3.000 caràcters. L’historial de traduccions només es conserva durant la sessió actual de l’aplicació.

## Desenvolupament i generació dels paquets

Les ordres següents són només per a qui manté el projecte. No cal executar-les per instal·lar i utilitzar una versió publicada. Es requereixen Windows x64 i Node.js 22.12 o una versió posterior. La primera instal·lació de les dependències de compilació i la descàrrega d’Electron i de les eines NSIS requereixen connexió a Internet.

```powershell
git clone https://github.com/chouchongYHMing/Jiao_Reader.git
cd Jiao_Reader
npm ci
npm run check
npm start
```

Per generar un instal·lador que es pugui distribuir:

```powershell
npm run build:win
```

Fitxer resultant: `release\Jiao_Reader-Setup-0.3.1.exe`. Només cal compartir aquest instal·lador amb els companys. No cal enviar-los `node_modules`, el codi font, la carpeta de compilació de l’aplicació ni els fitxers dels teus models d’Ollama.

Per generar només la carpeta de l’aplicació `dist\Jiao_Reader-win32-x64` i poder-la verificar:

```powershell
npm run build:win:dir
```

També es manté l’ordre original per generar la versió portàtil:

```powershell
npm run package:win
```

L’executable de la versió portàtil és `dist\Jiao_Reader-win32-x64\Jiao_Reader.exe`. Per compartir-la, comprimeix tota la carpeta `Jiao_Reader-win32-x64`; copiar-ne només el fitxer `.exe` no és suficient perquè funcioni. Ni la versió instal·lable ni la portàtil inclouen Ollama o models.

La configuració de l’instal·lador es troba a `electron-builder.yml`. Cal mantenir estable `appId: com.jiao.reader` perquè els instal·ladors futurs identifiquin la mateixa aplicació. `build-resources/installer.nsh` restringeix la instal·lació a l’usuari actual, i electron-builder proporciona el procés de desinstal·lació predeterminat. El procés de compilació genera primer l’aplicació amb la llista de fitxers permesos de `package-portable.cjs` i després crea l’instal·lador NSIS amb l’opció `prepackaged` d’electron-builder. Tots dos formats de distribució contenen la mateixa aplicació. El codi d’execució, els recursos de PDF.js i les llicències s’inclouen al paquet. Els README i la documentació d’ús també es copien a la carpeta de l’aplicació.

Consulta els passos de verificació previs a una publicació a la [llista de comprovació de versions per a Windows, en xinès](docs/RELEASE_CHECKLIST.md).

## Publicar a GitHub

Puja el codi font al repositori de GitHub i afegeix l’instal·lador Setup i `SHA256SUMS.txt` com a **fitxers adjunts d’una Release**. Els companys només han de descarregar el Setup des de Releases; els models es continuen preparant amb Ollama. La [guia de publicació a GitHub, en xinès](docs/GITHUB_RELEASE.zh-CN.md) explica com crear el repositori, pujar-hi el codi i publicar una versió.

## Estructura del projecte

```text
main.cjs                      Procés principal d’Electron, finestres, fitxers PDF i interfícies d’escriptori
ollama.cjs                    Detecció d’Ollama, llista de models i traducció local
preload.cjs                   Restricció de les interfícies d’escriptori accessibles des de la pàgina
app/                          Interfície de lectura, renderització de PDF i mòduls d’interacció
app/pdfjs/                    PDF.js, mapes de caràcters i recursos tipogràfics
electron-builder.yml          Configuració de l’instal·lador NSIS per a Windows
build-resources/              Icones de Windows, mode d’instal·lació i scripts de la versió portàtil
docs/                         Guies d’inici i de verificació de les versions
```

## Relació amb Jiao_Translator

Jiao_Reader pren com a referència el lector PDF.js i les instruccions de traducció local de Jiao_Translator. La versió d’escriptori utilitza directament la interfície local d’Ollama. La llicència de PDF.js es troba a `app/pdfjs/LICENSE`, i les llicències dels tipus de lletra es distribueixen a `app/pdfjs/standard_fonts/`. Consulta el projecte original a [Jiao_Translator](https://github.com/chouchongYHMing/Jiao_Translator).

