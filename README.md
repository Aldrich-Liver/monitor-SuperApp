# Monitor de Crashlytics

Revisa cada hora la última versión de Super App y Contacto Logístico (Android e iOS) en el proyecto de Firebase `crp-dev-dig-superapp` y lleva cada falla (crash, no fatal o ANR) en su propio hilo de `#team-mobile`, desde que aparece hasta que se resuelve. Si no hay nada nuevo, no publica nada.

Para el equipo: cómo pedir revisiones y correcciones, y cuánto esperar, en [COMO-USAR.md](COMO-USAR.md).

Funciona con seis automatizaciones de Cursor en el environment **Super App** y un agente que escucha a los bots en Slack:

1. **Monitor Crashlytics**, programada cada hora. `npm run check` lee Crashlytics, `npm run bugs` lleva el seguimiento de cada falla y `npm run render` escribe un mensaje por cada falla nueva y, cada mañana, el resumen de las fallas abiertas, que Cursor publica con la herramienta Send to Slack. Luego `npm run notify` encuentra cada mensaje por su `Ref. CR-…`, abre su hilo, arroba al Analista y lo activa por webhook, publica los avisos de seguimiento y responde bajo el resumen con los enlaces a cada hilo.
2. **Analista Crashlytics**, activada por webhook. Ejecuta `npm run details`, lee el código del commit con el que se compiló la versión y escribe la causa y la solución propuesta en palabras simples. Con `npm run reply` responde en el hilo de cada falla.
3. **Revisor de PRs**, activada por webhook. Revisa cualquier PR de las apps (corrección de una falla, función nueva, mejora, versión…) con los lineamientos, skills y documentos del equipo que viven en el repo, da el visto bueno o pide solo los cambios necesarios, comenta en el PR de GitHub y responde en el hilo.
4. **PR nuevo**, activada por GitHub al abrir un PR (o marcarlo listo para revisión) en cualquiera de las dos apps. Le da al PR su hilo en `#team-mobile` (o usa el que ya tiene, como el de la falla que corrige), avisa si falta el PR gemelo en la otra plataforma y pide la revisión al Revisor de PRs, sin que nadie tenga que arrobarlo.
5. **Pruebas de PRs**, activada por GitHub al abrir un PR de Android o subirle commits. Corre `./gradlew :app:testDevDebugUnitTest :app:lintDevDebug` sobre el último commit y publica el resultado en el PR y en su hilo. Mientras el CI esté detenido, es la única verificación automática del código antes del merge.
6. **Corrector**, activada por webhook cuando alguien escribe `@Corrector de fallas corrige esta falla` en el hilo de una falla. Sigue la skill `investigar-crash` de las apps, corrige la causa en Android y en iOS, abre un PR por repo y responde en el hilo con los enlaces. Eso pone la falla *En corrección*, y la automatización PR nuevo pide la revisión y las pruebas en el mismo hilo.

Y además:

- **Agentes de `#team-mobile`** (`agentes/`), tres agentes del Agent SDK de Cursor alojados en Cursor, uno por bot. Reciben las menciones a `@Revisor de PRs`, `@Corrector de fallas` y `@Pruebas de PRs` y, en cuanto llegan, activa por webhook la automatización que corresponde. No usa el modelo ni pide cuenta de Cursor a quien escribe: las automatizaciones corren con la cuenta de su dueño. Ver [Bots en Slack](#bots-en-slack).

```
:rotating_light: Falla nueva en Super App Android 1.5.5 (290) · No fatal · ArranqueAnfitrion$PasoArranqueExcedido.<init>
5 eventos · 16 usuarios · desde 1.5.2 · Ref. CR-4B7DFB
   └ :mag: @Analista Crashlytics, analiza esta falla.
   └ Super App Android 1.5.5 (290) · No fatal · ArranqueAnfitrion.kt:55 · Ver en Crashlytics
     > rt - El paso de arranque 'remote_config' no terminó en 15s
     Qué está pasando: Al abrir la app, la configuración remota tarda más de 15 s…
     Solución propuesta: …
     ¿La corregimos? @Corrector de fallas corrige esta falla
   └ @dev: Lo tomo, aquí el PR https://github.com/…/pull/14 @Revisor de PRs revisa este PR
   └ :hammer_and_wrench: En corrección · PR #14
   └ :white_check_mark: Visto bueno · PR #14 · @dev
   └ :twisted_rightwards_arrows: PR #14 fusionado · espera versión
   └ :package: En observación · 1.5.6 (291) incluye el PR #14 · se resuelve el 22 nov, 10:00 a.m. (CDMX) si no hay eventos
   └ :white_check_mark: Resuelta · Super App Android · ArranqueAnfitrion$PasoArranqueExcedido.<init> · 48 h sin eventos en 1.5.6 (291) con el PR #14   ← también aparece en el canal
```

## Cómo decide qué reportar

- **Última versión:** la versión semántica más alta con datos en los últimos 30 días (`releaseLookbackDays`).
- **Falla:** cualquier issue de la última versión cuyo número de eventos subió desde la revisión anterior. Los eventos se cuentan desde un instante fijo por versión, así que los que Crashlytics procesa con retraso se cuentan en la siguiente hora.
- **Versión nueva:** cuentan todos sus issues con eventos.
- **Primera revisión**, o cuando se reinicia el conteo tras 85 días en la misma versión: solo registra los contadores y no publica.
- **Errores del monitor**, por ejemplo credenciales vencidas: los reporta en el canal, pero el mismo error no se repite antes de 6 horas.
- El Analista revisa como máximo 8 fallas por hora, las de más eventos (`maxAnalyzedFailures`); las demás pasan a la hora siguiente. Guarda cada análisis por issue y versión, y si la misma falla vuelve a aparecer lo reutiliza en vez de volver a leer el código.

## Un hilo por falla

Cada issue de Crashlytics es una falla con su propio hilo, y todo lo que pasa con ella va ahí. Todo mensaje nuevo del canal lo publica Cursor: el que abre cada falla, el resumen de la mañana y los avisos de versión o de error. Los bots del monitor, el Analista y el Revisor solo responden en hilos; en el canal principal solo se ven, como respuestas del hilo que también se muestran en el canal (sin mensaje nuevo), los avisos de *Resuelta* y *Volvió a aparecer*.

| Estado | Cuándo |
|---|---|
| Abierta | La primera vez que el issue tiene eventos. Si sigue con eventos, solo suma al conteo: no publica de nuevo. |
| En corrección | Alguien pegó en el hilo un PR del repo de esa app. Se lee su estado en GitHub cada hora: si se fusiona lo avisa, y si se cierra sin fusionarse la falla vuelve a abierta. |
| En revisión | El Corrector respondió *Sin cambios de código* en el hilo: revisó la falla y no hay un cambio de código que la corrija (por ejemplo, viene del teléfono). Sigue vigilada: se resuelve tras 48 h sin eventos, pasa a en corrección si alguien pega un PR, y vuelve a abierta si aparece en otra versión. En el resumen de la mañana aparece al final. |
| En observación | Salió una versión que incluye el PR fusionado. Se confirma con el commit con el que se compiló la versión (viene en sus eventos de Crashlytics): el PR está incluido si su commit es ancestro de ese, o si el código de ese commit ya tiene los cambios del PR; no lo está si ese commit es anterior a la fusión. Como los repos son copias sincronizadas y sus historias pueden no coincidir, en cualquier otro caso (o si la versión no trae su commit) decide por fecha y lo dice en el aviso. |
| Resuelta | 48 h sin eventos (`resolveAfterHours`), contadas desde la versión con la corrección si la hay. Puede resolverse sin PR si deja de ocurrir sola. |
| Reabierta | Tuvo eventos después de resuelta, o en la versión que traía la corrección. Vuelve al mismo hilo y se le pide otra vez el detalle al Analista. |

**Resumen de la mañana:** la primera revisión desde las 9:00 hora CDMX (`digestHour`) prepara la lista de fallas abiertas y en corrección, con sus eventos del último día y la referencia `CR-…` de cada una; Cursor la publica y el bot del monitor responde debajo con el enlace a cada hilo. Si no hay fallas abiertas no publica nada. Las fallas resueltas se olvidan después de 30 días; si vuelven, abren un hilo nuevo.

## Revisor de PRs

Sirve para cualquier PR de `sw-crp-super-app-android` o `sw-crp-super-app-ios`: la corrección de una falla del monitor, una función nueva, una mejora, documentación o una versión. Se pide pegando el enlace del PR en un mensaje de `#team-mobile`, en el canal principal o en un hilo, de una de estas formas:

- **Arrobando al bot:** `@Revisor de PRs revisa este PR https://github.com/…/pull/12`. El agente de [Bots en Slack](#bots-en-slack) recibe la mención al momento y activa la revisión. En el hilo de un PR no hace falta el enlace: revisa los PR de ese hilo.
- **Arrobando a Cursor:** `@Cursor revisa este PR https://github.com/…/pull/12`, solo para quien tiene su cuenta de Slack vinculada al equipo de Cursor. Cursor lee [`AGENTS.md`](AGENTS.md) y ejecuta `npm run review:request -- <URL>`.
- **Desde otra automatización:** `npm run review:request -- <URL> --thread <ts del hilo>`, o un POST al webhook del Revisor con el payload que imprime `npm run review:request -- <URL> --dry-run`.

Responde siempre en un hilo: el del mensaje que lo pidió, o uno nuevo debajo de él si se pidió en el canal principal. Primero avisa que empezó (`:eyes:`) y después publica el veredicto. El detalle de cada punto (qué está mal, qué cambiar y el lineamiento) va en la revisión del PR de GitHub; en el hilo solo dice qué archivos corregir:

```
:warning: Cambios necesarios · PR #12 · 2 puntos · @quien-pidió
1. ClientelingViewModel.kt:88
2. AgendaScreen.kt:41
Detalle en el PR.
```

Si no pudo publicar en GitHub, el hilo trae el detalle completo de cada punto.

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

Después pide la revisión con `npm run review:request -- <URL> --via github`, igual que si alguien hubiera arrobado a Cursor. Los commits nuevos no piden otra revisión; para eso se escribe `@Revisor de PRs revisa este PR` en el hilo.

```
:arrow_heading_up: PR nuevo · Super App Android #14 · Arranque: la inscripción a notificaciones ya no frena el arranque · de dev
https://github.com/…/pull/14 · gemelo iOS: https://github.com/…/pull/9
   └ :eyes: Revisando el PR #14…
   └ :white_check_mark: Pruebas OK · PR #14 · `3f2a9c1` · 2217 pruebas · lint sin errores nuevos · 4 min
   └ :white_check_mark: Visto bueno · PR #14 · @dev
```

## Pruebas de PRs

Al abrir un PR de Android y con cada commit nuevo, `npm run tests:run` lo descarga en un worktree aparte (`.tester/worktree`) y corre `./gradlew --no-daemon --continue :app:testDevDebugUnitTest :app:lintDevDebug`. Tarda unos 5 minutos; a los 15 se detiene (`AGENTS.md` §5.7) y lo reporta. Hay que tener en cuenta lo siguiente:

- **Lint:** `main` ya tiene errores de lint, así que solo cuentan los que caen en archivos que el PR toca.
- **Resultado:** `Pruebas OK`, `Pruebas fallidas` (con las pruebas y los errores de lint nuevos), `No compila` (con los primeros errores del compilador) o `Pruebas detenidas` si pasó el límite.
- **Commits seguidos:** si llega un commit mientras corren las pruebas, `tests:reply` no publica el resultado viejo; lo hace la corrida del commit nuevo.
- **Dónde se publica:** como comentario del PR en GitHub y como respuesta en su hilo de Slack, si tiene uno.
- **Seguridad:** Gradle corre el código del PR con solo las variables que necesita para compilar (`PATH`, `HOME`, `JAVA_HOME`, `ANDROID_HOME`…), sin los secretos del environment. Los disparadores de GitHub no corren con PRs de forks.

Para correrlas otra vez sin subir un commit, se escribe `@Pruebas de PRs` en el hilo del PR.

iOS no se prueba: los agentes en la nube corren en Linux y no hay Xcode. El Revisor sí revisa los PR de iOS.

## Corrector

**Dónde llega la petición.** Los hilos de las fallas los abre el Monitor con Send to Slack, así que un `@Cursor corrige esta falla` en ese hilo no le llega a un agente nuevo de Cursor: le llega a la corrida del Monitor que publicó el mensaje. Lo mismo pasa con `@Cursor revisa este PR` en un hilo que abrió PR nuevo. Por eso esos prompts no corrigen ni revisan nada: ejecutan `fix:scan` y `review:scan`, que encuentran la petición sin respuesta y activan al Corrector o al Revisor. Si el aviso inmediato falla, o el agente de los bots estaba caído, el Monitor la encuentra en su siguiente corrida. Arrobar directo a `@Corrector de fallas` o a `@Revisor de PRs` funciona igual. El Corrector nunca toma una falla por su cuenta: solo cuenta un mensaje de una persona que arroba a `@Cursor` (su ID está en `cursorUserId` de `config/apps.json`) o al bot del Corrector. Pedirle a un compañero que arregle algo no lo activa. Para cancelar una petición que todavía no tiene respuesta del Corrector, borra el mensaje.

Se pide en el hilo de la falla, de una de estas formas:

- **Arrobando al bot:** `@Corrector de fallas corrige esta falla`. El agente de [Bots en Slack](#bots-en-slack) recibe la mención al momento y activa la corrección. Si la falla ya tiene PR, el bot lo dice; para otra corrección se escribe `@Corrector de fallas corrige esta falla, es una corrección nueva`.
- **Arrobando a Cursor:** `@Cursor corrige esta falla`, solo para quien tiene su cuenta de Slack vinculada al equipo de Cursor. Cursor lee [`AGENTS.md`](AGENTS.md) y ejecuta `npm run fix:request -- CR-…` con la referencia del mensaje que abre el hilo. El bot contesta toda mención, aunque sea para decir que la falla ya tiene PR, y esa respuesta es la que la marca como atendida.

Las dos formas hacen lo mismo. El comando reconoce la falla con lo que ya está en el hilo (el reporte y el detalle del Analista, con su enlace a Crashlytics), avisa que el Corrector la tomó y lo activa por webhook. No lo activa si la falla ya tiene un PR en su hilo o si el Corrector la tomó hace menos de 3 h y no ha dado su respuesta final; `--force` pide otra corrección de todos modos.

El Corrector ejecuta `npm run fix:context`, que agrega un evento de muestra de Crashlytics con su stack trace y el commit de la versión, y sigue la skill `investigar-crash` de las apps en modo autónomo (`GUIA-DEL-EQUIPO.md` §2):

- **Corrige la causa con el cambio mínimo**, con la misma rama `fix/…` en Android y en iOS, una prueba que reproduce el caso y la suite de Android. iOS sale sin compilar, y el PR lo dice.
- **Sin cambios de código** si la falla no es de la app, si `main` ya la corrigió o si los datos no alcanzan. En ese caso responde en el hilo con la causa y qué haría falta.
- **Nunca** publica versiones, toca Firebase, usa el keystore ni fusiona.

El Corrector no termina al abrir los PR: lleva la falla hasta dejar los PR listos para que una persona los fusione.

1. **Avisa en el hilo** con `fix:reply` y los enlaces de los PR, en estado *en verificación*. Eso pone la falla *En corrección* en el monitor. La automatización PR nuevo ve que el Corrector lleva el PR y no pide otra revisión.
2. **Verifica en rondas**, como máximo tres:
   1. Espera con `tests:wait` el resultado que la automatización Pruebas de PRs publica en el hilo para su último commit (GitHub la activa al abrir el PR y con cada push). Si no llega en 25 minutos, corre `tests:run` él mismo. Corrige en su rama lo que falle.
   2. Pide la revisión a la automatización Revisor de PRs con `review:request --thread` y espera su veredicto con `review:wait`, hasta 30 minutos.
   3. Si el Revisor pide cambios, atiende los puntos válidos, hace push en la misma rama y empieza otra ronda. En la tercera ya no cambia código.
   4. Los puntos que contradicen los lineamientos no se hacen; quedan en *Falta*, lo que le toca a una persona.
3. **Responde una sola vez al final**, con la causa, los PR, el resultado de las pruebas, el veredicto del Revisor, qué no se probó y lo que queda para una persona.

El Corrector no repite el trabajo de las demás automatizaciones, las usa:

| Automatización | Cómo la activa el Corrector | Cómo lee su resultado |
|---|---|---|
| Analista Crashlytics | Ya respondió en el hilo antes de que se pidiera la corrección | `fix:request` toma su causa y su solución del hilo |
| PR nuevo | GitHub, al abrir cada PR | No hace falta: solo deja el PR en el hilo de la falla y no pide otra revisión |
| Pruebas de PRs | GitHub, al abrir el PR de Android y con cada push | `tests:wait` lee su resultado en el hilo |
| Revisor de PRs | Webhook, con `review:request` | `review:wait` lee su veredicto en el hilo |

El que decide qué falta y no suelta la falla es el Corrector.

```
   └ @dev: @Cursor corrige esta falla
   └ :wrench: El Corrector toma esta falla. Aviso aquí con los PR.
   └ :arrows_counterclockwise: PR abiertos, en verificación · Android #14 · iOS #9
     La inscripción a notificaciones se espera en paralelo y el aviso ya no se envía sin red o en segundo plano.
   └ :hammer_and_wrench: En corrección · PR #14
   └ :white_check_mark: Pruebas OK · PR #14 …                      ← Pruebas de PRs
   └ :eyes: Revisando el PR #14… / :warning: Cambios necesarios · PR #14 · 2 puntos …
   └ :eyes: Revisando el PR #14… / :white_check_mark: Visto bueno · PR #14 …
   └ :hammer_and_wrench: Corrección propuesta · Android #14 · iOS #9 · @dev
     La inscripción a notificaciones se espera en paralelo…
     Pruebas: 2219 pruebas OK, sin errores de lint nuevos. · Revisión: Visto bueno en los dos PR, en 2 rondas.
     Falta: iOS no se compiló; los agentes en la nube corren en Linux; el merge lo hace una persona.
```

## Bots en Slack

Los bots de Slack no reciben mensajes por sí solos. Cada uno es la app de Slack de un agente de `agentes/` (`revisor`, `corrector` y `pruebas`), alojado en Cursor. Cursor administra esas apps y les entrega las menciones, también en canales privados y sin URL pública; en Cursor hosting no se usan apps propias con Socket Mode. Cuando alguien arroba a uno de ellos, el agente ejecuta el código de `src/mentions.js`, sin abrir un turno del modelo:

| Mención | Qué hace |
|---|---|
| `@Revisor de PRs` | Revisa los PR que enlaza el mensaje o, si no enlaza ninguno, los del hilo. Avisa con `:eyes:` y activa el webhook del Revisor. |
| `@Corrector de fallas` | En el hilo de una falla, avisa con `:wrench:` y activa el webhook del Corrector, salvo que la falla ya tenga PR o el Corrector ya esté en ella. |
| `@Pruebas de PRs` | Corre otra vez las pruebas del PR de Android del mensaje o del hilo por el webhook de Pruebas de PRs. |

Si nada de eso aplica, el bot explica en una línea qué necesita. Cada mención se atiende una sola vez aunque Slack la entregue dos veces. Contesta también a personas de otras organizaciones del canal (Slack Connect).

El Monitor sigue buscando cada hora, con `review:scan` y `fix:scan`, las menciones que no tienen respuesta, por si el agente estuvo caído.

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
# escribe .fixer/result.json: { "status": "in-review" | "fixed" | "no-change" | "error", "summary": "...", "prs": [...] }
npm run fix:reply -- --dry-run
npm run review:wait -- https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/3 --thread 1795046617.681619 --timeout-min 0
npm run tests:wait -- https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/14 --thread <ts> --timeout-min 0
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
   - **Prompt:** [`automation/fixer-prompt.md`](automation/fixer-prompt.md). Atiende dos peticiones con el mismo webhook: corregir una falla (`crash-fix-request`, abre PR nuevos) y atender las notas del Revisor en un PR existente (`pr-fix-request`, hace commits en la rama de ese PR, la pida quien la pida). En PR de un fork no puede hacer push y lo reporta.
   - **Modelo:** uno fuerte en código.
3. Agrega a la regla de enrutamiento de `@Cursor` la palabra `corrige`, apuntando al environment Super App, igual que `revisa`.

### 8. Agentes de `#team-mobile` (bots al instante)

Cada bot es la app de Slack de su agente, creada y administrada por Cursor. Reemplazan a las apps *Revisor de PRs*, *Corrector de fallas* y *Pruebas de PRs* que se crearon a mano.

1. **Webhook de Pruebas de PRs.** En su automatización agrega un disparador **Webhook**, además de los de GitHub, y copia su URL y llave a `TESTER_WEBHOOK_URL` y `TESTER_WEBHOOK_KEY`.
2. **Cada agente**, con Node 22. Para `revisor` (nombre del bot *Revisor de PRs*, secretos `REVIEWER_WEBHOOK_URL` y `REVIEWER_WEBHOOK_KEY`), `corrector` (*Corrector de fallas*, `FIXER_…`) y `pruebas` (*Pruebas de PRs*, `TESTER_…`):

   ```bash
   cd agentes/revisor
   npm install
   npx agent-sdk login                       # solo la primera vez
   npx agent-sdk deploy --dir . --slug revisor
   npx agent-sdk secret set revisor REVIEWER_WEBHOOK_URL
   npx agent-sdk secret set revisor REVIEWER_WEBHOOK_KEY
   npx agent-sdk slack create --env prod --dir . --name "Revisor de PRs"
   ```

   El slug tiene que ser el nombre de la carpeta (`revisor`, `corrector` o `pruebas`), y el agente tiene que estar desplegado antes de `slack create`: si no, el asistente dice *Deployment not found*. Al conectar Slack el agente se vuelve a desplegar solo. `slack create` abre el asistente en el navegador: aprueba la app y confirma el nombre. Guarda los tokens del bot en `.env.local` (no se sube a git) y en el agente. Si Slack pide aprobación de un administrador, deja el comando corriendo y abre el enlace *Request approval* que imprime.
3. **Invita los bots nuevos** al canal: `/invite @Revisor de PRs`, `/invite @Corrector de fallas` y `/invite @Pruebas de PRs`.
4. **Que las automatizaciones respondan con los bots nuevos.** En **Cloud Agents > Secrets**, cambia `SLACK_REVIEWER_BOT_TOKEN`, `SLACK_FIXER_BOT_TOKEN` y `SLACK_TESTER_BOT_TOKEN` por el `…_SLACK_BOT_TOKEN` del `.env.local` de `revisor`, `corrector` y `pruebas`. Así el aviso, el veredicto y la respuesta salen del mismo bot que arrobaron, y `review:scan` y `fix:scan` reconocen sus respuestas.
5. **Quita las apps viejas** en [api.slack.com/apps](https://api.slack.com/apps) (**Settings > Basic Information > Delete App**), para que no haya dos bots con el mismo nombre.
6. **Comprueba.** Arroba a `@Revisor de PRs` en el hilo de un PR: el `:eyes:` debe aparecer en segundos. `npx agent-sdk logs --prod --slug revisor --once` muestra `[REVISOR] … petición(es) activada(s)`.

Cada agente solo puede llamar a los hosts de `hosting.egressDomains` de su `bot/agent.ts` (Slack ya viene incluido). Los webhooks de las automatizaciones están en `api2.cursor.sh`; si alguno cambia de host, agrégalo ahí y vuelve a desplegar.

Todos los secretos van en **Cloud Agents > Secrets** como Runtime Secret, disponibles para el environment Super App.

### Credenciales de Firebase sin cuenta de servicio

1. En tu computadora, ejecuta `npx firebase-tools login:ci` y autoriza con tu cuenta de Google.
2. Copia el token (`1//…`) directo al secreto `FIREBASE_TOKEN`. No lo pegues en chats ni en archivos.

Para revocarlo, quita el acceso de "Firebase CLI" en [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
