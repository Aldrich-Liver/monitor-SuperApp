# Monitor de Crashlytics

Revisa cada hora la última versión de Super App y Contacto Logístico (Android e iOS) en el proyecto de Firebase `crp-dev-dig-superapp`. Si hay fallas con eventos nuevos, ya sean crashes, no fatales o ANR, nuevas o conocidas, las reporta en Slack (`#team-mobile`). Si no hay fallas, no publica nada.

Funciona con dos automatizaciones de Cursor en el environment **Super App**:

1. **Monitor Crashlytics**, programada cada hora. Ejecuta `npm run check` y `npm run notify`. Publica un mensaje corto con la lista de fallas y, en su hilo, menciona al Analista. Después activa al Analista por webhook con los datos de las fallas.
2. **Analista Crashlytics**, activada por webhook. Ejecuta `npm run details`, lee el código del commit con el que se compiló la versión y escribe la causa y la solución propuesta en palabras simples. Con `npm run reply` responde en el hilo una vez por falla.

```
:rotating_light: 1 falla en Crashlytics · 5 eventos nuevos entre 11:04 a.m. y 12:04 p.m. (hora CDMX)
• Super App Android 1.5.5 (290) · No fatal · ArranqueAnfitrion$PasoArranqueExcedido.<init> · 5 eventos · desde 1.5.2
:thread: Detalle y solución propuesta en el hilo.
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
| `SLACK_BOT_TOKEN` | Token `xoxb-…` del bot de Slack que publica. Necesita el permiso `chat:write` y estar invitado al canal. |
| `SLACK_CHANNEL` | ID del canal (`C…`) de `#team-mobile`. |
| `ANALYST_WEBHOOK_URL`, `ANALYST_WEBHOOK_KEY` | URL y llave del webhook de la automatización Analista Crashlytics. |
| `SLACK_ANALYST_MENTION` | Opcional: la mención `<@U…>` del bot del Analista, para que el hilo lo arrobe de verdad. |
| `SLACK_ANALYST_BOT_TOKEN` | Opcional: token del bot del Analista, para que sus respuestas salgan con su propio nombre. Sin este token, responde el bot del monitor. |

## Uso local

```bash
export FIREBASE_TOKEN=...                    # o GOOGLE_OAUTH_ACCESS_TOKEN
npm run check                                # escribe .monitor/result.json y .monitor/state.next.json
cp .monitor/state.next.json .monitor/state.json   # lo que hace la automatización con su memoria
npm run check                                # una hora después: reporta lo que subió
npm run notify -- --dry-run                  # muestra mensajes y payload sin enviarlos

# Analista: el payload que imprimió notify va en .analyst/payload.json
npm run details                              # escribe .analyst/details.json
# escribe .analyst/analysis.json: { "<key>": { "cause": "...", "fix": "..." } }
npm run reply -- --dry-run
npm test
```

## Configuración

### 1. Bot de Slack

La herramienta Send to Slack de las automatizaciones no devuelve el identificador del mensaje y por eso no puede responder en hilos. El monitor publica con un bot propio.

1. En [api.slack.com/apps](https://api.slack.com/apps), elige **Create New App > From scratch**, ponle de nombre `Monitor Crashlytics` y selecciona el workspace.
2. En **OAuth & Permissions > Bot Token Scopes**, agrega `chat:write`.
3. Haz clic en **Install to Workspace** y copia el **Bot User OAuth Token** (`xoxb-…`) al secreto `SLACK_BOT_TOKEN`.
4. En `#team-mobile`, escribe `/invite @Monitor Crashlytics`.
5. Para el ID del canal, abre los detalles de `#team-mobile`; el ID (`C…`) está al final. Guárdalo en el secreto `SLACK_CHANNEL`.

Opcional: para que el Analista aparezca como un usuario aparte y se pueda arrobar, crea una segunda app, `Analista Crashlytics`, con los mismos pasos. Guarda su token en `SLACK_ANALYST_BOT_TOKEN` y su mención en `SLACK_ANALYST_MENTION`, con el formato `<@U…>` y el Member ID que aparece en su perfil. Sin estos secretos, el hilo nombra al Analista en negritas y el bot del monitor publica sus respuestas.

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
- **Herramientas:** solo Memories. Ya no usa Send to Slack.
- **Prompt:** [`automation/monitor-prompt.md`](automation/monitor-prompt.md).
- **Modelo:** uno rápido y económico; solo ejecuta comandos.

Todos los secretos van en **Cloud Agents > Secrets** como Runtime Secret, disponibles para el environment Super App.

### Credenciales de Firebase sin cuenta de servicio

1. En tu computadora, ejecuta `npx firebase-tools login:ci` y autoriza con tu cuenta de Google.
2. Copia el token (`1//…`) directo al secreto `FIREBASE_TOKEN`. No lo pegues en chats ni en archivos.

Para revocarlo, quita el acceso de "Firebase CLI" en [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
