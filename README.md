# Monitor de Crashlytics

Revisa cada hora la última versión de Super App y Contacto Logístico (Android e iOS) en el proyecto de Firebase `crp-dev-dig-superapp` y lleva cada falla (crash, no fatal o ANR) en su propio hilo de `#team-mobile`, desde que aparece hasta que se resuelve. Si no hay nada nuevo, no publica nada.

Funciona con seis automatizaciones de Cursor en el environment **Super App**:

1. **Monitor Crashlytics**, programada cada hora. `npm run check` lee Crashlytics, `npm run bugs` lleva el seguimiento de cada falla y `npm run render` escribe un mensaje por cada falla nueva y, cada mañana, el resumen de las fallas abiertas, que Cursor publica con la herramienta Send to Slack. Luego `npm run notify` encuentra cada mensaje por su `Ref. CR-…`, abre su hilo, arroba al Analista y lo activa por webhook, publica los avisos de seguimiento y responde bajo el resumen con los enlaces a cada hilo.
2. **Analista Crashlytics**, activada por webhook. Ejecuta `npm run details`, lee el código del commit con el que se compiló la versión y escribe la causa y la solución propuesta en palabras simples. Con `npm run reply` responde en el hilo de cada falla.
3. **Revisor de PRs**, activada por webhook. Revisa cualquier PR de las apps (corrección de una falla, función nueva, mejora, versión…) con los lineamientos, skills y documentos del equipo que viven en el repo, da el visto bueno o pide solo los cambios necesarios, comenta en el PR de GitHub y responde en el hilo.
4. **PR nuevo**, activada por GitHub al abrir un PR (o marcarlo listo para revisión) en cualquiera de las dos apps. Le da al PR su hilo en `#team-mobile` (o usa el que ya tiene, como el de la falla que corrige), avisa si falta el PR gemelo en la otra plataforma y pide la revisión al Revisor de PRs, sin que nadie tenga que arrobarlo.
5. **Pruebas de PRs**, activada por GitHub al abrir un PR de Android o subirle commits. Corre `./gradlew :app:testDevDebugUnitTest :app:lintDevDebug` sobre el último commit y publica el resultado en el PR y en su hilo. Mientras el CI esté detenido, es la única verificación automática del código antes del merge.
6. **Corrector**, activada por webhook cuando alguien escribe `@Cursor corrige esta falla` o arroba a `@Corrector de fallas` en el hilo de una falla. Sigue la skill `investigar-crash` de las apps, corrige la causa en Android y en iOS, abre un PR por repo y responde en el hilo con los enlaces. Eso pone la falla *En corrección*, y la automatización PR nuevo pide la revisión y las pruebas en el mismo hilo.

```
:rotating_light: Falla nueva en Super App Android 1.5.5 (290) · No fatal · ArranqueAnfitrion$PasoArranqueExcedido.<init>
> rt - El paso de arranque 'remote_config' no terminó en 15s
5 eventos · 16 usuarios · desde 1.5.2
:thread: Detalle, solución propuesta y seguimiento en el hilo. · Ref. CR-4B7DFB
   └ :mag: @Analista Crashlytics, revisa esta falla contra el código del release y responde en este hilo…
   └ Super App Android 1.5.5 (290) · No fatal
     Dónde: ArranqueAnfitrion.protegido-dWUq8MI (ArranqueAnfitrion.kt:55)
     Qué está pasando: Al abrir la app, la configuración remota tarda más de 15 s…
     Solución propuesta: …
   └ @dev: Lo tomo, aquí el PR https://github.com/…/pull/14 @Cursor revisa este PR
   └ :hammer_and_wrench: En corrección con el PR #14. Aviso aquí cuando salga en una versión…
   └ :white_check_mark: Revisión del PR #14 …
   └ :twisted_rightwards_arrows: El PR #14 ya está fusionado. Aviso aquí cuando salga en una versión.
   └ :package: 1.5.6 (291) ya incluye el PR #14. Si no hay eventos de esta falla hasta el 22 nov, 10:00 (hora CDMX), la doy por resuelta.
   └ :white_check_mark: Resuelto · Super App Android · ArranqueAnfitrion$PasoArranqueExcedido.<init>   ← también aparece en el canal
```

## Cómo decide qué reportar

- **Última versión:** la versión semántica más alta con datos en los últimos 30 días (`releaseLookbackDays`).
- **Falla:** cualquier issue de la última versión cuyo número de eventos subió desde la revisión anterior. Los eventos se cuentan desde un instante fijo por versión, así que los que Crashlytics procesa con retraso se cuentan en la siguiente hora.
- **Versión nueva:** cuentan todos sus issues con eventos.
- **Primera revisión**, o cuando se reinicia el conteo tras 85 días en la misma versión: solo registra los contadores y no publica.
- **Errores del monitor**, por ejemplo credenciales vencidas: los reporta en el canal, pero el mismo error no se repite antes de 6 horas.
- El Analista revisa como máximo 8 fallas por hora, las de más eventos (`maxAnalyzedFailures`); las demás pasan a la hora siguiente. Guarda cada análisis por issue y versión, y si la misma falla vuelve a aparecer lo reutiliza en vez de volver a leer el código.

## Un hilo por falla

Cada issue de Crashlytics es una falla con su propio hilo, y todo lo que pasa con ella va ahí. Todo mensaje nuevo del canal lo publica Cursor: el que abre cada falla, el resumen de la mañana y los avisos de versión o de error. Los bots del monitor, el Analista y el Revisor solo responden en hilos; en el canal principal solo se ven, como respuestas del hilo que también se muestran en el canal (sin mensaje nuevo), los avisos de *Resuelto* y *Volvió a aparecer*.

| Estado | Cuándo |
|---|---|
| Abierta | La primera vez que el issue tiene eventos. Si sigue con eventos, solo suma al conteo: no publica de nuevo. |
| En corrección | Alguien pegó en el hilo un PR del repo de esa app. Se lee su estado en GitHub cada hora: si se fusiona lo avisa, y si se cierra sin fusionarse la falla vuelve a abierta. |
| En observación | Salió una versión que incluye el PR fusionado. Se confirma con el commit con el que se compiló la versión (viene en sus eventos de Crashlytics): el PR está incluido si su commit es ancestro de ese, o si el código de ese commit ya tiene los cambios del PR; no lo está si ese commit es anterior a la fusión. Como los repos son copias sincronizadas y sus historias pueden no coincidir, en cualquier otro caso (o si la versión no trae su commit) decide por fecha y lo dice en el aviso. |
| Resuelta | 48 h sin eventos (`resolveAfterHours`), contadas desde la versión con la corrección si la hay. Puede resolverse sin PR si deja de ocurrir sola. |
| Reabierta | Tuvo eventos después de resuelta, o en la versión que traía la corrección. Vuelve al mismo hilo y se le pide otra vez el detalle al Analista. |

**Resumen de la mañana:** la primera revisión desde las 9:00 hora CDMX (`digestHour`) prepara la lista de fallas abiertas y en corrección, con sus eventos del último día y la referencia `CR-…` de cada una; Cursor la publica y el bot del monitor responde debajo con el enlace a cada hilo. Si no hay fallas abiertas no publica nada. Las fallas resueltas se olvidan después de 30 días; si vuelven, abren un hilo nuevo.

## Revisor de PRs

Sirve para cualquier PR de `sw-crp-super-app-android` o `sw-crp-super-app-ios`: la corrección de una falla del monitor, una función nueva, una mejora, documentación o una versión. Se pide pegando el enlace del PR en un mensaje de `#team-mobile`, en el canal principal o en un hilo, de una de estas formas:

- **Arrobando a Cursor:** `@Cursor revisa este PR https://github.com/…/pull/12`. Cursor lee [`AGENTS.md`](AGENTS.md), ejecuta `npm run review:request -- <URL>` y el comando encuentra el mensaje por el enlace. La revisión empieza en segundos.
- **Arrobando al bot:** `@Revisor de PRs https://github.com/…/pull/12`. El bot no recibe eventos de Slack, así que el monitor, en su corrida de cada hora, encuentra la mención con `npm run review:scan` y activa la revisión.
- **Desde otra automatización:** `npm run review:request -- <URL> --thread <ts del hilo>`, o un POST al webhook del Revisor con el payload que imprime `npm run review:request -- <URL> --dry-run`.

Responde siempre en un hilo: el del mensaje que lo pidió, o uno nuevo debajo de él si se pidió en el canal principal. Primero avisa que empezó (`:eyes:`) y después publica el veredicto:

```
:warning: Cambios necesarios · PR #12 · Super App Android · Agenda de citas en Clienteling · feat/agenda-citas
@quien-pidió Agrega la agenda de citas, pero el ViewModel llama directo al repositorio remoto.
¿Cumple su objetivo? Parcialmente: la agenda funciona, pero falta el PR gemelo de iOS.
1. ClientelingViewModel.kt:88 · La presentación usa Datos/ directamente…
   Sugerencia: …
   Lineamiento: AGENTS.md §3.4
La revisión también quedó en el PR de GitHub.
```

### En qué se apoya

`npm run review:context` arma la lista de lo que el equipo escribió y aplica al PR. Lo toma de la rama base (`main`), y de la rama del PR cuando el PR lo agrega o lo cambia:

- **Lineamientos para agentes:** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` y la plantilla de PR, de la raíz y de cada carpeta que toca el PR.
- **READMEs** de la raíz y de esas carpetas, y **otros documentos** de esas carpetas (por ejemplo `PENDIENTES_VAS.md` si el PR toca VAS).
- **Reglas de Cursor** (`.cursor/rules`) que siempre aplican o cuyos `globs` coinciden con los archivos del PR.
- **Skills** (`.claude/skills`, `.cursor/skills`, `skills/`), como `investigar-crash`, `publicar-version` y `prueba-qa`. El Revisor lee las que corresponden al tipo de PR y revisa que el PR siga lo que piden.

También lee el título, la descripción y las ramas del PR en la API de GitHub, con el token que el environment ya le da a git o con `GITHUB_TOKEN`, y los mensajes del hilo, por ejemplo la causa y la solución que propuso el Analista.

Solo cuenta como cambio necesario:

- un error que provoque un crash, una regresión, datos incorrectos o un problema de seguridad;
- algo que rompa un lineamiento, una regla o una skill;
- que el PR no cumpla su objetivo, sea la falla del hilo o lo que dice su descripción;
- que falte algo que los lineamientos exigen para ese tipo de cambio, como pruebas, diseño aprobado, la métrica de una función nueva o el PR gemelo en la otra plataforma.

Los gustos de estilo no cuentan. El Revisor no ejecuta código del PR ni cambia nada en los repos.

El Revisor descarga el PR con git (`refs/pull/N/head`), así que solo revisa PRs de repos que puede clonar el environment Super App.

## PR nuevo

Cada PR que se abre en `sw-crp-super-app-android` o `sw-crp-super-app-ios` (o un borrador que se marca listo para revisión) dispara la automatización. `npm run pr:opened` busca si el PR, o su gemelo, ya tiene un hilo en el canal, por ejemplo el de la falla donde el Corrector lo publicó o el aviso del PR gemelo. Hay que tener en cuenta lo siguiente:

- **Si ya tiene hilo**, lo usa. Si el hilo era del gemelo, el bot del monitor deja ahí el enlace de este PR, para que la revisión y las pruebas lo encuentren.
- **Si no tiene hilo**, Cursor publica en el canal un aviso con el enlace del PR, su rama y el estado del gemelo; su hilo es el del PR.
- **El gemelo** se busca en la otra plataforma con la misma rama (`AGENTS.md` §2). Si no existe y la descripción no nombra el otro repo, el aviso lo dice.

Después pide la revisión con `npm run review:request -- <URL> --via github`, igual que si alguien hubiera arrobado a Cursor. Los commits nuevos no piden otra revisión; para eso se arroba a Cursor en el hilo.

```
:arrow_heading_up: PR nuevo en Super App Android · #14 · Arranque: la inscripción a notificaciones ya no frena el arranque
https://github.com/…/pull/14 · `fix/arranque-notificaciones` · de dev
:link: Gemelo en iOS: https://github.com/…/pull/9
:thread: Revisión y pruebas en el hilo.
   └ :eyes: Reviso el PR #14 de Super App Android con los lineamientos…
   └ :white_check_mark: Pruebas OK · PR #14 de Super App Android · `3f2a9c1` · 2217 pruebas · lint sin errores nuevos (4 previos en archivos que el PR no toca) · 4 min
   └ :white_check_mark: Visto bueno · PR #14 …
```

## Pruebas de PRs

Al abrir un PR de Android y con cada commit nuevo, `npm run tests:run` lo descarga en un worktree aparte (`.tester/worktree`) y corre `./gradlew --no-daemon --continue :app:testDevDebugUnitTest :app:lintDevDebug`. Tarda unos 5 minutos; a los 15 se detiene (`AGENTS.md` §5.7) y lo reporta. Hay que tener en cuenta lo siguiente:

- **Lint:** `main` ya tiene errores de lint, así que solo cuentan los que caen en archivos que el PR toca. Los demás se mencionan como previos.
- **Resultado:** `Pruebas OK`, `Pruebas fallidas` (con las pruebas y los errores de lint nuevos), `No compila` (con los primeros errores del compilador) o `Pruebas detenidas` si pasó el límite.
- **Commits seguidos:** si llega un commit mientras corren las pruebas, `tests:reply` no publica el resultado viejo; lo hace la corrida del commit nuevo.
- **Dónde se publica:** como comentario del PR en GitHub y como respuesta en su hilo de Slack, si tiene uno.
- **Seguridad:** Gradle corre el código del PR con solo las variables que necesita para compilar (`PATH`, `HOME`, `JAVA_HOME`, `ANDROID_HOME`…), sin los secretos del environment. Los disparadores de GitHub no corren con PRs de forks.

iOS no se prueba: los agentes en la nube corren en Linux y no hay Xcode. El Revisor sí revisa los PR de iOS.

## Corrector

Se pide en el hilo de la falla, de una de estas formas:

- **Arrobando a Cursor:** `@Cursor corrige esta falla`. Cursor lee [`AGENTS.md`](AGENTS.md) y ejecuta `npm run fix:request -- CR-…` con la referencia del mensaje que abre el hilo. Empieza en segundos.
- **Arrobando al bot:** `@Corrector de fallas`. El bot no recibe eventos de Slack, así que el monitor, en su corrida de cada hora, encuentra la mención con `npm run fix:scan` y activa la corrección. El bot contesta toda mención, aunque sea para decir que la falla ya tiene PR, y esa respuesta es la que la marca como atendida.

Las dos formas hacen lo mismo. El comando reconoce la falla con lo que ya está en el hilo (el reporte y el detalle del Analista, con su enlace a Crashlytics), avisa que el Corrector la tomó y lo activa por webhook. No lo activa si la falla ya tiene un PR en su hilo o si el Corrector la tomó hace menos de 2 h; `--force` pide otra corrección de todos modos.

El Corrector ejecuta `npm run fix:context`, que agrega un evento de muestra de Crashlytics con su stack trace y el commit de la versión, y sigue la skill `investigar-crash` de las apps en modo autónomo (`GUIA-DEL-EQUIPO.md` §2):

- **Corrige la causa con el cambio mínimo**, con la misma rama `fix/…` en Android y en iOS, una prueba que reproduce el caso y la suite de Android. iOS sale sin compilar, y el PR lo dice.
- **Sin cambios de código** si la falla no es de la app, si `main` ya la corrigió o si los datos no alcanzan. En ese caso responde en el hilo con la causa y qué haría falta.
- **Nunca** publica versiones, toca Firebase, usa el keystore ni fusiona.

Con `npm run fix:reply` responde en el hilo con los enlaces. Eso pone la falla *En corrección* en el monitor, y la automatización PR nuevo pide en ese mismo hilo la revisión y las pruebas de cada PR.

```
   └ @dev: @Cursor corrige esta falla
   └ :wrench: El Corrector toma esta falla de Super App Android: busca la causa en el código, la corrige en Android y en iOS y responde aquí con los PR.
   └ :hammer_and_wrench: Corrección propuesta
     La inscripción a notificaciones se espera en paralelo y el aviso ya no se envía sin red o en segundo plano.
     • PR #14 · sw-crp-super-app-android
     • PR #9 · sw-crp-super-app-ios
     Qué se probó: ArranqueAnfitrionTest y la suite de Android (2219/2219).
     Qué no se probó: iOS no se compiló; los agentes en la nube corren en Linux.
   └ :hammer_and_wrench: En corrección con el PR #14…
```

## Requisitos

Node.js 20 o superior. No hay dependencias que instalar.

Pruebas de PRs y Corrector necesitan además el JDK 21 y el SDK de Android del environment Super App, que prepara `herramientas/nube/instalar.sh` del repo de Android.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `FIREBASE_TOKEN` | Token de `npx firebase-tools login:ci`, con los permisos de quien lo generó. |
| `CRASHLYTICS_SA_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` | Alternativa: una cuenta de servicio con el rol Firebase Crashlytics Viewer. |
| `GOOGLE_OAUTH_ACCESS_TOKEN` | Alternativa para pruebas locales: un token de acceso OAuth vigente. |
| `SLACK_BOT_TOKEN` | Token `xoxb-…` del bot del monitor, el que abre los hilos y publica los avisos y el resumen. Necesita los permisos `chat:write` y `groups:history` (para encontrar los mensajes de Cursor y leer los PR de los hilos en un canal privado) y estar invitado al canal. |
| `SLACK_CHANNEL` | ID del canal (`C…`) de `#team-mobile`. |
| `ANALYST_WEBHOOK_URL`, `ANALYST_WEBHOOK_KEY` | URL y llave del webhook de la automatización Analista Crashlytics. |
| `SLACK_ANALYST_BOT_TOKEN` | Opcional: token del bot del Analista. Con él, el hilo arroba al Analista y sus respuestas salen con su propio nombre. Sin él, el hilo lo nombra en negritas y responde el bot del monitor. |
| `SLACK_ANALYST_MENTION` | Opcional: fija la mención (`<@U…>`) en vez de obtenerla del token del Analista. |
| `REVIEWER_WEBHOOK_URL`, `REVIEWER_WEBHOOK_KEY` | URL y llave del webhook de la automatización Revisor de PRs. |
| `SLACK_REVIEWER_BOT_TOKEN` | Token del bot del Revisor. Con él, el Revisor responde con su propio nombre y `review:scan` encuentra sus menciones. Sin él, responde el bot del Analista o el del monitor. |
| `GITHUB_TOKEN` | Opcional: token de solo lectura para la API de GitHub. Sin él, el Revisor usa el token que el environment le da a git. |
| `FIXER_WEBHOOK_URL`, `FIXER_WEBHOOK_KEY` | URL y llave del webhook de la automatización Corrector. |
| `SLACK_FIXER_BOT_TOKEN` | Token del bot del Corrector. Con él, el Corrector responde con su propio nombre y `fix:scan` encuentra sus menciones. Sin él, responde el bot del Analista o el del monitor, y solo se le pide con `@Cursor`. |
| `SLACK_TESTER_BOT_TOKEN` | Opcional: token del bot de Pruebas de PRs, para que los resultados salgan con su propio nombre. Sin él, responde el bot del monitor. |

## Uso local

```bash
export FIREBASE_TOKEN=...                    # o GOOGLE_OAUTH_ACCESS_TOKEN
npm run check                                # escribe .monitor/result.json y .monitor/state.next.json
cp .monitor/state.next.json .monitor/state.json   # lo que hace la automatización con su memoria
npm run check                                # una hora después: cuenta lo que subió
npm run bugs                                 # actualiza las fallas en .monitor/state.next.json (abre, reabre, PR, resuelve)
npm run render                               # escribe un mensaje por falla nueva para Send to Slack en .monitor/messages.json
npm run notify -- --dry-run                  # muestra hilos, avisos, resumen y payload sin enviarlos

# Prueba completa sin Send to Slack: publica una falla real marcada como PRUEBA con el bot del monitor
npm run simulate
T="--result .monitor/test-result.json --state .monitor/test-state.json"
npm run bugs -- $T && npm run render -- $T --post-with-bot && npm run notify -- $T

# Analista: el payload que imprimió notify va en .analyst/payload.json
npm run details                              # escribe .analyst/details.json
# escribe .analyst/analysis.json: { "<key>": { "cause": "...", "fix": "..." } }
npm run reply -- --dry-run

# Revisor: pedir una revisión (busca el hilo por el enlace) y preparar el contexto
npm run review:request -- https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/2 --dry-run
# el payload que imprimió va en .reviewer/payload.json
npm run review:context                       # escribe .reviewer/context.json y .reviewer/diff.patch
# escribe .reviewer/review.json: { "verdict": "approve" | "changes", "summary": "...", "items": [...] }
npm run review:reply -- --dry-run
npm run review:scan -- --dry-run             # menciones al bot del Revisor sin responder

# PR nuevo: hilo, gemelo y mensaje para Send to Slack en .prs/messages.json
npm run pr:opened -- https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/14 --dry-run

# Pruebas de PRs (--include-closed para probar con un PR ya fusionado)
npm run tests:run -- https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/7 --include-closed
npm run tests:reply -- --dry-run             # escribe .tester/comment.md y muestra la respuesta del hilo

# Corrector: el payload que imprime fix:request va en .fixer/payload.json
npm run fix:request -- CR-E6CF6D --dry-run
npm run fix:scan -- --dry-run                # menciones al bot del Corrector sin responder
npm run fix:context                          # escribe .fixer/context.json
# escribe .fixer/result.json: { "status": "fixed" | "no-change" | "error", "summary": "...", "prs": [...] }
npm run fix:reply -- --dry-run
npm test
```

## Configuración

### 1. Bot de Slack

El mensaje de cada falla nueva lo publica Cursor, pero la herramienta Send to Slack no devuelve el identificador del mensaje y por eso no puede responder en su hilo. El bot del monitor busca cada mensaje en el canal por su `Ref. CR-…`, abre su hilo y publica ahí todo el seguimiento. Si no lo encuentra, no publica nada en el canal: la siguiente revisión le vuelve a pasar el mensaje a Cursor con la misma referencia.

1. En [api.slack.com/apps](https://api.slack.com/apps), elige **Create New App > From a manifest**, selecciona el workspace y pega [`slack/monitor-manifest.json`](slack/monitor-manifest.json). Ya trae el nombre y los permisos: `chat:write` para escribir y `groups:history`/`channels:history` para encontrar el reporte.
2. Revisa el resumen y haz clic en **Create**.
3. En **Install App**, haz clic en **Install to Workspace** y copia el **Bot User OAuth Token** (`xoxb-…`) al secreto `SLACK_BOT_TOKEN`.
4. En `#team-mobile`, escribe `/invite @Monitor Crashlytics`. El bot aparece en los detalles del canal, en **Integraciones > Aplicaciones**, no en la lista de miembros.
5. Para el ID del canal, abre los detalles de `#team-mobile`; el ID (`C…`) está al final. Guárdalo en el secreto `SLACK_CHANNEL`.

Opcional: para que el Analista aparezca como un usuario aparte y se pueda arrobar, crea una segunda app con los mismos pasos y [`slack/analyst-manifest.json`](slack/analyst-manifest.json). Guarda su token en `SLACK_ANALYST_BOT_TOKEN`; el monitor obtiene de ahí la mención. Sin ese secreto, el hilo nombra al Analista en negritas y el bot del monitor publica sus respuestas.

### 2. Automatización Analista Crashlytics

En [cursor.com/automations](https://cursor.com/automations):

- **Disparador:** Webhook. Al guardar, copia la URL y la llave a los secretos `ANALYST_WEBHOOK_URL` y `ANALYST_WEBHOOK_KEY`.
- **Environment:** Super App.
- **Herramientas:** Memories.
- **Prompt:** [`automation/analyst-prompt.md`](automation/analyst-prompt.md).
- **Modelo:** uno capaz de leer código.

### 3. Automatización Monitor Crashlytics

- **Disparador:** programado, con el cron `0 * * * *`.
- **Environment:** Super App.
- **Herramientas:** Memories y Send to Slack, con el canal fijo `#team-mobile`.
- **Prompt:** [`automation/monitor-prompt.md`](automation/monitor-prompt.md).
- **Modelo:** uno rápido y económico; solo ejecuta comandos.

### 4. Revisor de PRs

1. Crea la app de Slack con los pasos del bot, usando [`slack/reviewer-manifest.json`](slack/reviewer-manifest.json). Guarda su token en `SLACK_REVIEWER_BOT_TOKEN` e invítala con `/invite @Revisor de PRs`.
2. Crea la automatización:
   - **Disparador:** Webhook. Copia la URL y la llave a `REVIEWER_WEBHOOK_URL` y `REVIEWER_WEBHOOK_KEY`.
   - **Environment:** Super App.
   - **Herramientas:** Comment on pull request, con aprobaciones activadas para que pueda aprobar o pedir cambios.
   - **Prompt:** [`automation/reviewer-prompt.md`](automation/reviewer-prompt.md).
   - **Modelo:** uno fuerte en revisión de código.
3. Para que `@Cursor` corra en el environment Super App al pedir una revisión, agrega en el dashboard de Cursor, en **Cloud Agents**, una regla de enrutamiento (routing rule) con la palabra `revisa` apuntando al environment Super App, o escribe `env="Super App"` en el mensaje.

### 5. PR nuevo

- **Disparadores:** GitHub, *Pull request opened*, uno para `sw-crp-super-app-android` y otro para `sw-crp-super-app-ios`. Incluye los borradores que se marcan listos para revisión.
- **Environment:** Super App.
- **Herramientas:** Send to Slack, con el canal fijo `#team-mobile`.
- **Prompt:** [`automation/pr-opened-prompt.md`](automation/pr-opened-prompt.md).
- **Modelo:** uno rápido y económico; solo ejecuta comandos.

### 6. Pruebas de PRs

Opcional: crea la app de Slack con los pasos del bot, usando [`slack/tester-manifest.json`](slack/tester-manifest.json). Guarda su token en `SLACK_TESTER_BOT_TOKEN` e invítala con `/invite @Pruebas de PRs`.

- **Disparadores:** GitHub, *Pull request opened* y *Pull request pushed*, en `sw-crp-super-app-android`.
- **Environment:** Super App.
- **Herramientas:** Comment on pull request, sin aprobaciones: solo comenta.
- **Prompt:** [`automation/tester-prompt.md`](automation/tester-prompt.md).
- **Modelo:** uno rápido y económico; solo ejecuta comandos.

### 7. Corrector

1. Crea la app de Slack con los pasos del bot, usando [`slack/fixer-manifest.json`](slack/fixer-manifest.json). Guarda su token en `SLACK_FIXER_BOT_TOKEN` e invítala con `/invite @Corrector de fallas`.
2. Crea la automatización:
   - **Disparador:** Webhook. Copia la URL y la llave a `FIXER_WEBHOOK_URL` y `FIXER_WEBHOOK_KEY`.
   - **Environment:** Super App, con los dos repos de las apps.
   - **Herramientas:** la de crear pull requests, que viene activada.
   - **Prompt:** [`automation/fixer-prompt.md`](automation/fixer-prompt.md).
   - **Modelo:** uno fuerte en código.
3. Agrega a la regla de enrutamiento de `@Cursor` la palabra `corrige`, apuntando al environment Super App, igual que `revisa`.

Todos los secretos van en **Cloud Agents > Secrets** como Runtime Secret, disponibles para el environment Super App.

### Credenciales de Firebase sin cuenta de servicio

1. En tu computadora, ejecuta `npx firebase-tools login:ci` y autoriza con tu cuenta de Google.
2. Copia el token (`1//…`) directo al secreto `FIREBASE_TOKEN`. No lo pegues en chats ni en archivos.

Para revocarlo, quita el acceso de "Firebase CLI" en [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
