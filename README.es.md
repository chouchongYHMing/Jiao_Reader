# Jiao_Reader

[简体中文](README.md) | [English](README.en.md) | [Català](README.ca.md) | [Español](README.es.md)

Proyecto: [chouchongYHMing/Jiao_Reader](https://github.com/chouchongYHMing/Jiao_Reader) · Descargas: [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases)

Lector local de artículos académicos en PDF para Windows 10 / 11 x64. Utiliza PDF.js para mostrar los documentos y los modelos que ya tengas instalados en Ollama en tu equipo para traducir el texto seleccionado.

Una herramienta de lectura personal, actualmente en la versión `0.3.5`. Al abrir un artículo, puedes seleccionar texto para ver la traducción en una ventana emergente junto a la selección; el panel derecho conserva el texto original completo y su traducción.

**La interfaz de la aplicación está actualmente en chino simplificado y el texto seleccionado se traduce al chino simplificado.** Los distintos idiomas de este README no implican que la interfaz de la aplicación esté traducida a esos idiomas.

## Para lectores: instalar y empezar a leer

1. Descarga `Jiao_Reader-Setup-0.3.5.exe` desde [Releases](https://github.com/chouchongYHMing/Jiao_Reader/releases) y ejecuta el instalador. Las descargas llamadas `Source code` contienen el código fuente; para utilizar la aplicación, basta con descargar Setup.
2. Abre Jiao_Reader desde el escritorio o el menú Inicio y abre un PDF o arrástralo a la ventana.
3. Utiliza la rueda del ratón para leer de forma continua. La barra superior muestra la página actual y el número total de páginas. Puedes introducir un número de página para ir a ella o ajustar la vista con `+`, `−` y “适合宽度” (Ajustar al ancho).

La versión `0.3.5` reutiliza sin cambios el ejecutable de inicio de Electron de `0.3.1`. Las propiedades del archivo `.exe` en Windows pueden seguir mostrando `0.3.1`; las versiones de la aplicación y del instalador son `0.3.5`.

El instalador incluye el entorno de ejecución de escritorio. No necesitas instalar Node.js, Python ni herramientas de desarrollo para usar la aplicación. La instalación se limita al usuario actual de Windows. Puedes elegir otra carpeta de instalación si tienes permiso de escritura en ella. El instalador crea accesos directos en el escritorio y el menú Inicio, además de una entrada para desinstalar la aplicación desde Aplicaciones instaladas de Windows. La ubicación predeterminada no requiere permisos de administrador.

**La distribución actual no tiene firma de código.** Windows SmartScreen o el navegador pueden mostrar avisos como “Editor desconocido” o “Windows protegió su PC”. Estos avisos no tienen relación con la instalación de Node.js o Python. Antes de continuar, comprueba la procedencia del archivo. La firma de código y la reputación del editor son tareas pendientes para futuras versiones; no se debe pedir a los usuarios que desactiven las protecciones del sistema.

Encontrarás todos los pasos para el primer uso en la [Guía de inicio rápido (en chino)](docs/QUICKSTART.zh-CN.md).

**Actualizar desde una versión anterior:** cierra Jiao_Reader y ejecuta el nuevo Setup conservando la misma carpeta de instalación. No necesitas desinstalar primero. Se conservan las lecturas recientes, las prioridades, las notas guardadas, el historial de selecciones guardado en disco y el modelo seleccionado; Ollama y los PDF originales no se modifican. No se puede recuperar el historial temporal que las versiones anteriores no guardaron en disco; las notas ya guardadas se conservan. No hay actualización automática. Para actualizar una versión portátil, sustituye la carpeta completa de la aplicación; Setup no actualiza una copia portátil situada en otro lugar.

## Preparar la traducción local

No necesitas Ollama para leer PDF. Para traducir texto:

1. Instala e inicia [Ollama para Windows](https://ollama.com/download/windows).
2. En PowerShell, utiliza Ollama para descargar el modelo que quieras usar. Por ejemplo, el proyecto original utiliza:

   ```powershell
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. Vuelve a Jiao_Reader, actualiza el estado de los modelos locales y selecciona un modelo instalado en el panel de modelos.
4. Selecciona un fragmento del artículo. La ventana emergente junto a la selección muestra el progreso y el resultado de la traducción, y el panel derecho conserva también el original y la traducción.

Al iniciarse, la aplicación comprueba si Ollama está disponible en el equipo y muestra el estado de la conexión, la instalación y los modelos locales. Si Ollama está instalado pero el servicio no está en ejecución, puedes pulsar “启动 Ollama” (Iniciar Ollama). También puedes abrir Ollama o ejecutar `ollama serve` en una terminal. Cuando termine la descarga de un modelo, actualiza la lista para utilizarlo. La aplicación recuerda el modelo seleccionado; si lo has eliminado, tendrás que elegir otro.

**El panel de modelos solo permite seleccionar modelos locales ya disponibles en Ollama.** No descarga modelos, no admite nombres de modelo arbitrarios ni permite importar archivos GGUF arrastrándolos a la aplicación. Prepara los nuevos modelos mediante `ollama pull` o los comandos de importación de Ollama. El instalador no incluye Ollama ni modelos, y tampoco los instala automáticamente.

El espacio en disco, la memoria RAM y la memoria gráfica necesarios dependen del modelo elegido. La primera traducción puede tardar más mientras Ollama carga el modelo en memoria. Cambiar de modelo puede afectar a la velocidad y la calidad de la traducción. Consulta la [documentación oficial de Ollama](https://docs.ollama.com/quickstart) para preparar los modelos.

## Lectura y traducción

| Acción | Cómo hacerlo |
| --- | --- |
| Abrir un artículo | Pulsa “打开 PDF” (Abrir PDF), arrastra un archivo o utiliza `Ctrl+O` |
| Leer de forma continua | Utiliza la rueda del ratón o la barra de desplazamiento de la derecha |
| Consultar tu posición | Mira el número de página superior y “第 X 页 / 共 N 页” (Página X de N) en la parte inferior; ambos se actualizan al desplazarte |
| Ir a una página | Introduce y confirma el número de página en la barra superior |
| Ajustar el zoom | Utiliza `+`, `−`, “适合宽度” (Ajustar al ancho) o `Ctrl++` / `Ctrl+-` |
| Traducir | Selecciona un fragmento de la capa de texto del PDF y consulta la traducción en la ventana emergente junto a la selección |
| Copiar la traducción | Utiliza el botón de copia de la ventana emergente o de la tarjeta de traducción del panel derecho |
| Cambiar de modelo | Actualiza la lista y selecciona un modelo instalado en el equipo |
| Gestionar lecturas recientes | Elimina una entrada con su botón de eliminación o pulsa “清空” (Vaciar) para quitar todas; se conservan los PDF originales |
| Ajustar la prioridad de lectura | Haz clic derecho en una lectura reciente y elige “优先级 +1” (Aumentar prioridad en 1) o “优先级清零” (Poner a cero); el indicador de la entrada muestra la prioridad |
| Añadir etiquetas o notas | Selecciona texto y haz clic derecho en su entrada de “本次阅读” (Historial de lectura), abajo a la derecha; elige “添加标签” (Añadir etiquetas) o “写评论 / 笔记” (Escribir comentario / nota) |
| Volver a una selección anterior | Pulsa una entrada de “本次阅读” (Historial de lectura) para volver a su página y fragmento, ver la selección original y recuperar el original y la traducción guardada en el panel derecho |
| Consultar anotaciones guardadas | Pulsa “标签与笔记” (Etiquetas y notas), a la derecha del título del documento y a la izquierda del control de páginas; el botón de página localiza el fragmento original, y puedes editar o borrar notas |
| Ver y editar comentarios | Pulsa el pequeño bocadillo al final del resaltado del PDF para leer o editar el comentario en una tarjeta; editar las etiquetas abre el diálogo completo de anotación |

La selección al arrastrar gestiona mejor los espacios entre líneas, los márgenes y el texto en dos columnas, y reduce las ampliaciones repentinas de la selección o los saltos al final de la página. Cuando las columnas se detectan con claridad, cada selección se mantiene en la columna inicial; inicia otra selección para traducir la otra columna. Si el documento tiene una disposición compleja, comprueba que el texto original del panel derecho coincida con lo que querías seleccionar. Eliminar entradas de las lecturas recientes solo modifica la lista: no borra los PDF del disco ni cierra el artículo que tienes abierto.

Las lecturas recientes se ordenan por **prioridad de mayor a menor y después por fecha de lectura, de más reciente a más antigua**. El menú del clic derecho solo ofrece aumentar la prioridad o ponerla a cero. Las prioridades se guardan en el equipo junto con las lecturas recientes.

Las etiquetas, los comentarios, las notas y las anotaciones no necesitan Ollama. Cada selección de texto crea una entrada de lectura con el original y su página, por lo que puedes anotarla antes de traducir. Separa las etiquetas con comas; puedes editar juntas las etiquetas y la nota de una misma selección. La lista superior muestra primero las notas actualizadas más recientemente, con el fragmento citado y el número de página.

Las etiquetas ofrecen seis colores suaves de resaltador: amarillo trigo, verde salvia, azul bruma, lavanda, albaricoque y coral suave. Elige un color para cada etiqueta en el editor; se resaltan las etiquetas guardadas y sus fragmentos en el PDF. Un fragmento con varias etiquetas utiliza el color de la primera. Las notas que solo contienen un comentario también pueden tener color. Dentro de un documento, una misma etiqueta tiene un color uniforme; cambiarlo actualiza los fragmentos relacionados.

Pulsa una etiqueta sobre la lista para reunir sus fragmentos y notas. Cada fragmento conserva su propio comentario, ordenado por su última modificación; los comentarios no se sobrescriben. Elige “全部” (Todas) para volver a la lista completa. Las anotaciones nuevas guardan su posición en la página, por lo que el resaltado se conserva al ampliar y reiniciar. Las anotaciones antiguas solo se resaltan cuando su cita coincide de forma única. El resaltado se guarda en el lector y no se escribe en el PDF.

Los resaltados guardados que contienen un comentario muestran un pequeño botón con forma de bocadillo al final. Al pulsarlo, puedes leer o editar el comentario en una tarjeta, o abrir el diálogo completo para editar las etiquetas. Los resaltados que solo tienen etiquetas, sin comentario, no muestran este botón. Se conservan los seis colores y el comentario independiente de cada fragmento.

Las anotaciones guardadas y las selecciones y traducciones de “本次阅读” (Historial de lectura) se guardan en el equipo identificando el documento por el **contenido completo del PDF**. Se recuperan al volver a abrirlo, incluso después de cambiar de documento o reiniciar el lector. Un PDF copiado o renombrado con exactamente el mismo contenido comparte el historial y las anotaciones; los PDF con el mismo nombre y contenido diferente se guardan por separado. Cada documento conserva hasta 100 entradas, con un máximo de 12 000 caracteres de original y 64 000 de traducción por entrada. Pulsar una entrada del historial o el botón de página de una nota localiza y muestra la selección original. El historial también recupera el original y la traducción guardada en el panel derecho sin volver a traducir ni crear entradas duplicadas. Ni el historial ni las anotaciones se escriben en el PDF o lo modifican.

Los archivos PDF se leen en el equipo. Al traducir, el texto seleccionado se envía al servicio local `127.0.0.1:11434`. Los PDF deben tener una capa de texto extraíble; los documentos escaneados requieren OCR previo. El tamaño máximo de cada PDF es de 200 MB y cada traducción admite hasta 3000 caracteres. Cada anotación puede citar hasta 12 000 caracteres e incluir hasta 20 etiquetas (50 caracteres cada una) y una nota de 6000 caracteres.

## Desarrollo y empaquetado

Los siguientes comandos son para quienes mantienen el proyecto. No es necesario ejecutarlos para instalar y usar una versión publicada. El desarrollo requiere Windows x64 y Node.js 22.12 o posterior. La primera instalación de las dependencias de compilación y la descarga de Electron y de las herramientas NSIS requieren conexión a Internet.

```powershell
git clone https://github.com/chouchongYHMing/Jiao_Reader.git
cd Jiao_Reader
npm ci
npm run check
npm start
```

Para generar un instalador distribuible:

```powershell
npm run build:win
```

Resultado: `release\Jiao_Reader-Setup-0.3.5.exe`. Basta con compartir este único instalador con otros lectores. No necesitas enviar `node_modules`, el código fuente, la carpeta de compilación de la aplicación ni tus archivos de modelos de Ollama.

Para generar únicamente la carpeta de la aplicación `dist\Jiao_Reader-win32-x64` y validarla:

```powershell
npm run build:win:dir
```

También se conserva el comando original para generar la versión portátil:

```powershell
npm run package:win
```

La versión portátil se inicia desde `dist\Jiao_Reader-win32-x64\Jiao_Reader.exe`. Para compartirla, comprime la carpeta `Jiao_Reader-win32-x64` completa. No funcionará si copias únicamente el archivo `.exe` que contiene. Ni la versión instalable ni la portátil incluyen Ollama o modelos.

La configuración del instalador está en `electron-builder.yml`. Mantén estable `appId: com.jiao.reader` para que los futuros instaladores reconozcan la misma aplicación. `build-resources/installer.nsh` limita la instalación al usuario actual, y electron-builder proporciona el proceso de desinstalación predeterminado. El punto de entrada de la compilación crea primero la aplicación mediante la lista de archivos permitidos de `package-portable.cjs` y después utiliza la opción `prepackaged` de electron-builder para generar el instalador NSIS. Ambos formatos de distribución contienen la misma aplicación. Se incluyen el código de ejecución, los recursos y las licencias de PDF.js, además de los archivos README y la documentación de uso en la carpeta de la aplicación.

Consulta las comprobaciones previas a la publicación en [Validación de versiones para Windows (en chino)](docs/RELEASE_CHECKLIST.md).

## Publicar en GitHub

Sube el código fuente al repositorio de GitHub. Adjunta el instalador Setup y `SHA256SUMS.txt` como **archivos de una Release**. Los lectores pueden descargar Setup desde Releases y preparar sus modelos por separado con Ollama. Encontrarás todos los pasos para crear el repositorio, subir el código y publicar una versión en la [Guía de publicación en GitHub (en chino)](docs/GITHUB_RELEASE.zh-CN.md).

## Estructura del proyecto

```text
main.cjs                      Proceso principal de Electron, ventana, operaciones con PDF y API de escritorio
reading-store.cjs             Lecturas recientes, prioridades, historial de selecciones y anotaciones vinculadas al contenido del PDF
ollama.cjs                    Detección de Ollama, lista de modelos y traducción local
preload.cjs                   API de escritorio restringida disponible para la página
app/                          Interfaz de lectura, renderizado de PDF y módulos de interacción
app/pdfjs/                    PDF.js, mapas de caracteres y recursos de fuentes
electron-builder.yml          Configuración del instalador NSIS para Windows
build-resources/              Iconos de Windows, modo de instalación y scripts de empaquetado portátil
docs/                         Instrucciones para el primer uso y validación de versiones
```

## Relación con Jiao_Translator

Jiao_Reader toma como referencia el lector PDF.js y las instrucciones de traducción local de Jiao_Translator. La versión de escritorio llama directamente a la API local de Ollama. La licencia de PDF.js está en `app/pdfjs/LICENSE`; las licencias de las fuentes se distribuyen en `app/pdfjs/standard_fonts/`. Proyecto original: [Jiao_Translator](https://github.com/chouchongYHMing/Jiao_Translator).
