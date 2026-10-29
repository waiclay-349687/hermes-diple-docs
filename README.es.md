[English](README.md) | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | **Español**

# Diple Docs — resalta y comenta documentos Markdown para la IA (plugin de Hermes Desktop)

Abre un archivo `.md` en Hermes Desktop, resalta pasajes, escribe comentarios sobre ellos y pásalos a la IA de tu chat; cada anotación conserva su lugar en el archivo y muestra si se envió, si la IA respondió o si está resuelta.

> **El nombre.** La *diplé* (›) es el signo que los escribas griegos trazaban en el margen para remitir una línea a su comentario. Diple Docs (圈批·文档) es el miembro de la familia para documentos; [Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) es el miembro para el chat.

> **No oficial.** Es un plugin de la comunidad. No lo crea, revisa ni mantiene Nous Research ni el proyecto Hermes Agent.

## Funciones

- **Una página de documento de solo lectura** — abre un archivo `.md` / `.markdown` en su propia pestaña, en el mismo lugar que la vista previa de Hermes: junto al chat, a su derecha. Vistas **Renderizado** y **Fuente**, **Recargar** y **Mostrar en Finder**. El plugin nunca edita el documento.
- **Anotar una selección** — selecciona texto y haz clic en **Anotar**. El editor se abre justo debajo del pasaje y la selección conserva un sombreado leve y temporal, para que veas qué estás anotando. Todavía no se añade nada.
- **Guardada, entonces en la lista** — **Guardar** con un comentario crea un *comentario* (la IA debe responderlo); **Guardar** con el campo vacío crea un *resaltado* (solo fondo). Solo entonces entra la anotación en la lista y pasa a ser la actual. Un borrador vacío desaparece al hacer clic fuera o pulsar <kbd>Esc</kbd>. Un borrador con texto no se pierde al hacer clic fuera, pasar a otra anotación, cerrar la página o recargarla; solo <kbd>Esc</kbd> o **×** lo descartan. Cuando el archivo se actualiza, el borrador sigue a su pasaje; si no lo encuentra, te pide que lo vuelvas a seleccionar. Si otra ventana guardó el mismo pasaje mientras tanto, eliges: **Conservar el existente**, **Reemplazar con el mío** o **Combinar**.
- **La lista de anotaciones** — todas las anotaciones del archivo en el orden del documento, con filtros (Todas, Por enviar, Enviadas, Respondidas, Original modificado, Resueltas). En una tarjeta: ir al pasaje, editar el comentario, marcar como resuelta o reabrir, eliminar (con deshacer), enviar esta.
- **Anotación pendiente anterior / siguiente** — dos flechas en la cabecera de la lista (y en la barra de estado del margen) recorren lo que aún no está resuelto.
- **Borrar en bloque, con deshacer** — el menú **⋯** de la lista borra todas, las resueltas, las enviadas o respondidas, las de original modificado o las filtradas, marca todas como resueltas o copia todas como Markdown. Todo borrado se puede deshacer.
- **Mostrar u ocultar la lista desde la barra de herramientas** — el interruptor del extremo derecho de la barra del documento (indica cuántas quedan pendientes). Oculta, la lista deja una **barra de estado en el margen**: una marca por anotación en su lugar del documento, coloreada según su estado; pasa el puntero por una marca para verla, haz clic para ir allí.
- **Ventanas estrechas** — cuando la página es demasiado estrecha para la lista junto al documento, la lista pasa a ser una barra inferior que se despliega y se pliega.
- **Sigue los cambios del archivo** — cuando el archivo cambia en el disco, la página se recarga (espera si estás escribiendo un comentario) y vuelve a encontrar cada pasaje. Un pasaje que ya no encuentra se marca **Original modificado** y conserva el texto anterior, con **Elegir nuevo original** en la tarjeta.
- **Pasarlo al chat** — **Enviar N ▾** pasa las anotaciones a [Diple](https://github.com/waiclay-349687/hermes-diple): a la lista de pendientes de la conversación, para que salgan con tu próximo mensaje, o enviadas en el acto. La tarjeta muestra entonces **Enviada** y, cuando la IA ha respondido, **Respondida**, con un enlace a la conversación. **Copiar para la IA** en el mismo menú las copia como Markdown.
- **«Abrir en Diple Docs» en el chat** — cuando la IA escribe un archivo `.md`, una tarjeta al final de su respuesta lo abre para anotarlo (se puede desactivar). Los documentos recientes también están en la paleta de comandos.

La interfaz del plugin está en todos los idiomas de Hermes Desktop: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch y Español** (el árabe de derecha a izquierda). Por defecto sigue el idioma de la app; también puedes elegir uno en los ajustes del plugin.

## Capturas de pantalla

Todas las capturas usan la interfaz en chino simplificado y un documento de ejemplo inventado.

El editor de comentarios justo debajo del pasaje seleccionado; a la derecha, la barra de estado del margen:

![El editor debajo de un pasaje seleccionado, con el campo de comentario y los botones Guardar y enviar / Guardar (en chino)](docs/screenshots/editor.png)

La cabecera de la lista: anotación pendiente anterior / siguiente, el menú **⋯** abierto con las acciones en bloque, los filtros y las primeras tarjetas:

![La lista de anotaciones con su menú ⋯ abierto: borrar todas, borrar resueltas, borrar enviadas/respondidas, borrar «original modificado», marcar todas como resueltas, copiar todas como Markdown (en chino)](docs/screenshots/list-menu.png)

La lista oculta desde la barra de herramientas: la barra de estado del margen con una marca por anotación (tema claro y oscuro):

![El documento con la lista oculta y una estrecha barra de estado de marcas de colores en el borde derecho (en chino)](docs/screenshots/rail.png)

![Lo mismo en el tema oscuro](docs/screenshots/rail-dark.png)

Una página estrecha: la lista como barra inferior:

![Una página de documento estrecha con la lista de anotaciones como barra inferior (en chino)](docs/screenshots/narrow.png)

Las capturas se hicieron en un entorno aislado, antes del último cambio del editor: allí una anotación nueva ya tenía su número con el editor abierto; ahora lo recibe al guardar.

## Instalación

El plugin tiene dos mitades: un plugin de escritorio (`plugin.js`) y un pequeño backend en Python (`plugins/diple-docs/`). Hacen falta las dos. Para enviar anotaciones al chat, instala también [Diple](https://github.com/waiclay-349687/hermes-diple) (ver «Plugin compañero» más abajo). En los comandos siguientes `~/.hermes` es tu carpeta de Hermes; para un perfil con nombre usa `~/.hermes/profiles/<name>`.

### Opción A: descargar una versión publicada

1. Descarga `plugin.js`, `plugin.js.sha256`, `diple-docs-python-0.1.0.zip` y `diple-docs-python-0.1.0.zip.sha256` de la [última versión](https://github.com/waiclay-349687/hermes-diple-docs/releases) y verifícalos:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-docs-python-0.1.0.zip.sha256
   ```

2. Colócalos en su sitio:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple-docs ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple-docs/plugin.js
   unzip -o diple-docs-python-0.1.0.zip -d ~/.hermes/plugins/
   ```

3. Activa el backend y reinicia Hermes Desktop:

   ```bash
   hermes plugins enable diple-docs
   ```

### Opción B: desde el código fuente

Necesita Node.js 22 o posterior.

```bash
git clone https://github.com/waiclay-349687/hermes-diple-docs.git
cd hermes-diple-docs
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple-docs
```

`scripts/install.mjs` compila `plugin.js` y copia las dos mitades en la carpeta de Hermes indicada con `--home` (nunca adivina una). Reinicia Hermes Desktop después: la mitad en Python solo se carga al arrancar la app.

## Uso

1. Abre un documento: en la paleta de comandos (<kbd>⌘K</kbd>) elige «Diple Docs: Abrir documento…» o «Diple Docs: Documentos recientes…», o haz clic en **Abrir** en una tarjeta «Abrir en Diple Docs» del chat.
2. Selecciona un pasaje y haz clic en **Anotar**. Escribe un comentario, o deja el campo vacío para un resaltado, y haz clic en **Guardar** (o pulsa <kbd>Intro</kbd>; <kbd>Mayús</kbd>+<kbd>Intro</kbd> añade una línea). La anotación aparece en la lista y como sombreado sobre el pasaje.
3. Sigue leyendo. Con las flechas de la cabecera de la lista recorres lo que sigue pendiente, y con el interruptor de la barra de herramientas ocultas la lista cuando quieras recuperar el ancho.
4. Abre **Enviar N ▾**: elige esta o todas las no enviadas del archivo y luego la conversación actual, para añadirlas a su lista de pendientes o enviarlas en el acto. O elige **Copiar para la IA**.
5. Cuando la IA haya respondido, las tarjetas dicen **Respondida**. Marca como resuelto lo que esté zanjado y bórralo desde el menú **⋯** cuando termines.

**Guardar y enviar** en el editor guarda primero y luego envía esa anotación a la conversación actual.

### Atajos

| Acción | Por defecto | Notas |
| --- | --- | --- |
| Anotar la selección en la página del documento | <kbd>⌘⇧E</kbd> | El mismo atajo que el de Diple, que gestiona la propia página; también puedes asignar «Anotar la selección (página del documento)» en los ajustes de teclado de la app |
| Mostrar u ocultar la lista de anotaciones | <kbd>⌘⌥B</kbd> | Se puede cambiar |
| Anotación pendiente anterior / siguiente | ninguno | Asígnalos en los ajustes de teclado de la app |

Las superficies de trabajo (botón, editor, lista, barra de estado) no muestran estas teclas; la página de ajustes del plugin las enumera.

En Windows y Linux, <kbd>⌘</kbd> es <kbd>Ctrl</kbd>. La paleta de comandos (<kbd>⌘K</kbd>) también tiene «Anotar la selección (página del documento)» y «Diple Docs: Ajustes» (en el idioma de tu interfaz).

## Ajustes

Ábrelos desde la paleta de comandos («Diple Docs: Ajustes») o desde los ajustes de la app.

| Ajuste | Por defecto | Qué hace |
| --- | --- | --- |
| Idioma | Igual que la app | Igual que la app, o uno de los nueve idiomas, cada uno con su propio nombre. |
| Añadir una tarjeta «Abrir en Diple Docs» cuando la IA escribe un archivo `.md` | activado | Una tarjeta al final de la respuesta abre el archivo escrito. Desactivado: ábrelo desde la paleta de comandos. |
| Atajos | — | Enumera los atajos de arriba; se cambian en los ajustes de teclado de la app. |
| Restablecer | — | Vuelve a los valores por defecto. |

## Cómo funciona

### Qué recibe la IA

Diple Docs no habla con la IA por sí mismo. **Enviar** pasa las anotaciones a Diple mediante eventos de plugin (el protocolo de traspaso, [ADR 0007](docs/adr/README.md)); Diple las pone en la lista de pendientes de la conversación junto a las tomadas en el chat y las envía como las suyas: la burbuja del chat sigue siendo corta, y la IA recibe cada pasaje completo con su archivo y línea, tu comentario y la regla de responder a cada comentario. Diple informa de qué se envió y qué obtuvo respuesta, y las tarjetas lo reflejan.

**Copiar para la IA** pone las mismas anotaciones en el portapapeles como Markdown (el pasaje como cita y luego tu comentario), para cualquier chat o herramienta.

### El lugar de cada anotación

Una anotación guarda su pasaje, la línea y suficiente texto alrededor para volver a encontrarlo. Tras un cambio en el archivo, el plugin busca el pasaje en el texto nuevo; cuando el contexto no es lo bastante único para estar seguro, no adivina: la anotación se marca **Original modificado** y conserva el texto tal como era.

### Dónde se guardan los datos

- Las anotaciones, su estado y la lista de documentos recientes: SQLite en `~/.hermes/plugin-data/diple-docs/data.db`, por ruta de archivo. No se escribe nada junto a tus documentos.
- Las preferencias de diseño (ancho de la lista, mostrada u oculta, la vista): el almacenamiento de plugins de escritorio de Hermes Desktop (claves con el prefijo `hermes.plugin.diple-docs.`).

Las decisiones de diseño están en [docs/adr](docs/adr/README.md) y la estructura general en [docs/architecture.md](docs/architecture.md).

## Privacidad

Todo se queda en tu equipo. El plugin no hace peticiones de red por su cuenta y no tiene telemetría. Solo lee los documentos que abres y rechaza las ubicaciones con credenciales o datos internos de Hermes (por ejemplo `~/.ssh` o el `.env` de Hermes). Las anotaciones llegan a tu proveedor de modelos solo cuando las envías a una conversación, igual que el texto que escribes.

## Limitaciones conocidas

Las principales (lista completa con los motivos en [docs/known-limitations.md](docs/known-limitations.md)):

- Para enviar hace falta Diple. Sin él, el primer envío espera 3 segundos una respuesta (10 segundos si el destino es otra conversación, que Diple abre primero); luego la página indica que Diple no responde y desactiva el envío. La lista, los comentarios, **Copiar para la IA** y **Copiar todas como Markdown** siguen funcionando.
- El destino es siempre una conversación existente: no se puede crear una nueva desde aquí, porque `newChat()` del SDK no devuelve un id de sesión. _(issue not filed yet)_
- En la vista Renderizado, una selección dentro de una tabla, HTML sin procesar o una nota al pie puede no coincidir con la fuente; entonces la página te pide que la hagas de nuevo en la vista Fuente.
- Un archivo renombrado o movido empieza con la lista vacía.
- Si otro plugin también reescribe las respuestas de la IA, la tarjeta «Abrir en Diple Docs» puede perderse (el anfitrión solo conserva la primera reescritura); el archivo sigue en los documentos recientes.

## Compatibilidad

Probado con Hermes Agent **v0.22.5 (2026.9.24)**, commit `bf0203a` (2026-10-22), en macOS, junto con Diple 0.2.2. Necesita Hermes Desktop (la CLI sola no carga plugins de escritorio). Otras versiones pueden funcionar, pero no se han probado; cuéntanos lo que encuentres.

## Plugin compañero: Diple

[Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) es el miembro de la familia para el chat: resalta y comenta pasajes de una conversación, guárdalos en una lista de pendientes sobre el cuadro de texto y envíalos con tu próximo mensaje; la IA responde a cada comentario y puedes ir de cada respuesta a su pasaje y volver.

- **Sin Diple**: abrir documentos, anotar, la lista, los filtros, resolver, la barra de estado del margen, **Copiar para la IA** en el menú de envío y **Copiar todas como Markdown** funcionan. Solo enviar a una conversación necesita Diple.
- **Con Diple**: **Enviar N ▾** pone las anotaciones del documento en la lista de pendientes de la conversación, junto a las del chat, como fichas sobre el cuadro de texto; salen con tu próximo mensaje, o en el acto si eliges la propia conversación en el menú. Las respuestas de la IA indican a qué comentario responden, y las tarjetas de aquí pasan a **Enviada** y luego a **Respondida**.

Son dos plugins independientes, con repositorios y versiones propios; instala uno o los dos. No comparten código en ejecución: cada uno incluye su propia copia del núcleo común.

## En qué se diferencia

La vista previa integrada de Hermes Desktop muestra un archivo Markdown y puede editarlo. Diple Docs nunca edita: es para revisar. Guarda una lista de anotaciones por archivo entre sesiones, las vuelve a encontrar tras los cambios, sigue cada una de «por enviar» a «respondida» y «resuelta», y las pasa al chat a través de Diple.

## Hoja de ruta e incidencias

- [ROADMAP.md](ROADMAP.md) — en qué se trabaja ahora, después y más adelante.
- [Issues](https://github.com/waiclay-349687/hermes-diple-docs/issues) — preguntas abiertas, debates de diseño y limitaciones conocidas.
- [CHANGELOG.md](CHANGELOG.md) — qué cambió en cada versión.
- [CONTRIBUTING.md](CONTRIBUTING.md) — compilar y probar.

## Licencia

[MIT](LICENSE).
