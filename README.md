# Monitor de Crashlytics

Revisa cada hora la última versión de Super App y Contacto Logístico (Android e iOS) en el proyecto de Firebase `crp-dev-dig-superapp`. Si hay fallas con eventos nuevos, ya sean crashes, no fatales o ANR, nuevas o conocidas, las reporta en Slack (`#team-mobile`). Si no hay fallas, no publica nada.

Funciona con dos automatizaciones de Cursor en el environment **Super App**:

1. **Monitor Crashlytics**, programada cada hora. Ejecuta `npm run check` y `npm run render`, y publica el reporte (un mensaje corto con la lista de fallas) como Cursor, con la herramienta Send to Slack. Luego `npm run notify` encuentra ese reporte en el canal por su `Ref. CR-…`, menciona al Analista en el hilo con el bot del monitor y activa al Analista por webhook con los datos de las fallas.
2. **Analista Crashlytics**, activada por webhook. Ejecuta `npm run details`, lee el código del commit con el que se compiló la versión y escribe la causa y la solución propuesta en palabras simples. Con `npm run reply` responde en el hilo una vez por falla.

```
:rotating_light: 1 falla en Crashlytics · 5 eventos nuevos entre 11:04 a.m. y 12:04 p.m. (hora CDMX)
• Super App Android 1.5.5 (290) · No fatal · ArranqueAnfitrion$PasoArranqueExcedido.<init> · 5 eventos · desde 1.5.2
:thread: Detalle y solución propuesta en el hilo. · Ref. CR-4B7DFB
   └ :mag: @Analista Crashlytics, revisa 1 falla contra el código del release y responde en este hilo…
   └ 1/1 · Super App Android 1.5.5 (290) · No fatal
     Error: ArranqueAnfitrion$PasoArranqueExcedido.<init>
     > rt - El paso de arranque 'remote_config' no terminó en 15s
     Dónde: ArranqueAnfitrion.protegido-dWUq8MI (ArranqueAnfitrion.kt:55)
     Eventos: 5 nuevos · 17 en esta versión · 16 usuarios · desde 1.5.2
     Qué está pasando: Al abrir la app, la configuración remota tarda más de 15 s…
     Solución propuesta: …
     Ver en Crashlytics
```

## Cómo decide qué reportar

- **Última versión:** la versión semántica más alta con datos en los últimos 30 días (`releaseLookbackDays`).
- **Falla:** cualquier issue de la última versión cuyo número de eventos subió desde la revisión anterior. Los eventos se cuentan desde un instante fijo por versión, así que los que Crashlytics procesa con retraso se reportan en la siguiente hora.
- **Versión nueva:** se reportan todos sus issues con eventos.
- **Primera revisión**, o cuando se reinicia el conteo tras 85 días en la misma versión: solo registra los contadores y no publica.
- **Errores del monitor**, por ejemplo credenciales vencidas: los reporta en el canal, pero el mismo error no se repite antes de 6 horas.
- El Analista revisa como máximo las 8 fallas con más eventos (`maxAnalyzedFailures`). Guarda cada análisis por issue y versión, y si la misma falla vuelve a aparecer lo reutiliza en vez de volver a leer el código.

## Requisitos

Node.js 20 o superior. No hay dependencias que instalar.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `FIREBASE_TOKEN` | Token de `npx firebase-tools login:ci`, con los permisos de quien lo generó. |
| `CRASHLYTICS_SA_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` | Alternativa: una cuenta de servicio con el rol Firebase Crashlytics Viewer. |
| `GOOGLE_OAUTH_ACCESS_TOKEN` | Alternativa para pruebas locales: un token de acceso OAuth vigente. |
| `SLACK_BOT_TOKEN` | Token `xoxb-…` del bot del monitor, el que abre el hilo. Necesita los permisos `chat:write` y `groups:history` (para encontrar el reporte de Cursor en un canal privado) y estar invitado al canal. |
| `SLACK_CHANNEL` | ID del canal (`C…`) de `#team-mobile`. |
| `ANALYST_WEBHOOK_URL`, `ANALYST_WEBHOOK_KEY` | URL y llave del webhook de la automatización Analista Crashlytics. |
| `SLACK_ANALYST_BOT_TOKEN` | Opcional: token del bot del Analista. Con él, el hilo arroba al Analista y sus respuestas salen con su propio nombre. Sin él, el hilo lo nombra en negritas y responde el bot del monitor. |
| `SLACK_ANALYST_MENTION` | Opcional: fija la mención (`<@U…>`) en vez de obtenerla del token del Analista. |

## Uso local

```bash
export FIREBASE_TOKEN=...                    # o GOOGLE_OAUTH_ACCESS_TOKEN
npm run check                                # escribe .monitor/result.json y .monitor/state.next.json
cp .monitor/state.next.json .monitor/state.json   # lo que hace la automatización con su memoria
npm run check                                # una hora después: reporta lo que subió
npm run render                               # escribe el reporte para Send to Slack en .monitor/messages.json
npm run notify -- --dry-run                  # muestra el hilo y el payload sin enviarlos

# Prueba completa sin Send to Slack: publica una falla real marcada como PRUEBA con el bot del monitor
npm run simulate
npm run render -- --result .monitor/test-result.json --post-with-bot
npm run notify -- --result .monitor/test-result.json

# Analista: el payload que imprimió notify va en .analyst/payload.json
npm run details                              # escribe .analyst/details.json
# escribe .analyst/analysis.json: { "<key>": { "cause": "...", "fix": "..." } }
npm run reply -- --dry-run
npm test
```

## Configuración

### 1. Bot de Slack

El reporte lo publica Cursor, pero la herramienta Send to Slack no devuelve el identificador del mensaje y por eso no puede responder en su hilo. El bot del monitor busca el reporte en el canal por su `Ref. CR-…` y abre el hilo.

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

Todos los secretos van en **Cloud Agents > Secrets** como Runtime Secret, disponibles para el environment Super App.

### Credenciales de Firebase sin cuenta de servicio

1. En tu computadora, ejecuta `npx firebase-tools login:ci` y autoriza con tu cuenta de Google.
2. Copia el token (`1//…`) directo al secreto `FIREBASE_TOKEN`. No lo pegues en chats ni en archivos.

Para revocarlo, quita el acceso de "Firebase CLI" en [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
