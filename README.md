# Monitor de Crashlytics

Vigila la última versión de Super App y Contacto Logístico (Android e iOS) en el proyecto de Firebase `crp-dev-dig-superapp` y avisa en Slack (`#team-mobile`) de cada issue nuevo o que regrese, sea fatal, no fatal o ANR, sin importar cuántos usuarios afecte. También avisa cuando sale una versión nueva.

Está pensado para correr como una automatización programada de Cursor en el environment **Super App**, que también tiene los repos `sw-crp-super-app-android` y `sw-crp-super-app-ios`. En cada ejecución, un agente:

1. Ejecuta `npm run check` para consultar Crashlytics.
2. Si hay algo nuevo, revisa el código del commit con el que se compiló esa versión y escribe un análisis.
3. Ejecuta `npm run render` y publica los mensajes con la herramienta Send to Slack.

Lo que ya se reportó se guarda en la memoria de la automatización, así que cada issue se avisa una sola vez.

## Cómo decide qué avisar

- **Última versión:** la de versión semántica más alta con datos en los últimos 30 días (`releaseLookbackDays`). Para vigilar también la anterior, sube `watchLatestVersions` a 2 en `config/apps.json`.
- **Issue nuevo:** aparece en la última versión y no se había visto antes en esa app.
- **Regresión:** Crashlytics marca un issue conocido con la señal `SIGNAL_REGRESSED`. Se avisa una vez por regresión.
- **Versión nueva:** cambia la última versión detectada.
- **Primera ejecución:** registra los issues existentes como conocidos, sin avisar de cada uno, y manda un solo mensaje de "monitor activo".
- **Errores:** si no puede consultar Crashlytics, avisa del error, y de ese mismo error no vuelve a avisar en menos de 2 horas.

Las apps, el repo de código de cada una (`sourceRepo`) y los umbrales se configuran en `config/apps.json`.

## Requisitos

Node.js 20 o superior. No hay dependencias que instalar.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `FIREBASE_TOKEN` | Token de `npx firebase-tools login:ci`. Actúa con los permisos de la persona que lo generó; es la opción temporal mientras no haya cuenta de servicio. |
| `CRASHLYTICS_SA_KEY` | JSON de la cuenta de servicio de Google, completo o en base64. Es la opción recomendada a largo plazo; si está definida junto con `FIREBASE_TOKEN`, se usa `FIREBASE_TOKEN`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternativa: ruta al archivo JSON de la cuenta de servicio. |
| `GOOGLE_OAUTH_ACCESS_TOKEN` | Alternativa para pruebas locales: un token de acceso OAuth vigente. |
| `SLACK_BOT_TOKEN`, `SLACK_TARGET` | Opcional, para que `npm run notify` publique directamente con un bot propio, en un canal (`C…`) o por mensaje directo (`U…`). |
| `SLACK_WEBHOOK_URL` | Opcional, alternativa al bot: un incoming webhook de Slack. |

## Uso local

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./crashlytics-monitor.sa.json
npm run check                 # consulta Crashlytics; escribe .monitor/result.json y .monitor/state.next.json
npm run render                # escribe los mensajes como texto en .monitor/messages.json
npm run notify -- --dry-run   # muestra los mensajes en formato Block Kit sin enviarlos
cp .monitor/state.next.json .monitor/state.json  # lo que hace la automatización con su memoria
npm test
```

## Credenciales sin cuenta de servicio (temporal)

1. En tu computadora, con Node.js instalado, ejecuta `npx firebase-tools login:ci`.
2. Se abre el navegador. Entra con tu cuenta de Google y autoriza la CLI de Firebase.
3. La terminal imprime un token que empieza con `1//`. Cópialo directo al secreto `FIREBASE_TOKEN` (Runtime Secret) en Cloud Agents > Secrets. No lo pegues en chats ni en archivos.

El token tiene los mismos permisos que tu usuario en todos tus proyectos de Google Cloud y Firebase. Para revocarlo, ve a [myaccount.google.com/permissions](https://myaccount.google.com/permissions) y quita el acceso de "Firebase CLI". Si las políticas de la organización lo invalidan, el monitor avisa del error en Slack.

## Configuración en Google Cloud (una vez)

1. En la consola de Google Cloud, con el proyecto `crp-dev-dig-superapp` seleccionado, ve a **IAM y administración > Cuentas de servicio** y crea una llamada `crashlytics-monitor`.
2. Asígnale el rol **Firebase Crashlytics Viewer** (`roles/firebasecrashlytics.viewer`). Es de solo lectura.
3. En la cuenta de servicio, entra a **Claves > Agregar clave > JSON** y descarga el archivo. Si la organización bloquea la creación de claves, un administrador tiene que dar una excepción para este proyecto.
4. Si la primera ejecución falla con `SERVICE_DISABLED`, habilita la **Firebase Crashlytics API** (`firebasecrashlytics.googleapis.com`) en el proyecto.

## Automatización en Cursor

1. Agrega este repositorio al environment **Super App** (Cloud Agents > Environments), junto a los repos de Android e iOS.
2. En **Cloud Agents > Secrets**, agrega `FIREBASE_TOKEN` o `CRASHLYTICS_SA_KEY` como **Runtime Secret**.
3. Verifica que la app de Cursor esté instalada en Slack (Integrations) y, si `#team-mobile` es privado, invita al bot de Cursor al canal.
4. En [cursor.com/automations](https://cursor.com/automations), crea una automatización:
   - **Disparador:** programado, con el cron `*/10 * * * *` para la prueba. Después conviene algo como `0 * * * *` (cada hora).
   - **Environment:** Super App.
   - **Herramientas:** **Memories** y **Send to Slack**, con el canal fijo `#team-mobile`.
   - **Prompt:** el contenido de [`automation/prompt.md`](automation/prompt.md).
   - **Modelo:** uno rápido y económico, porque la mayoría de las ejecuciones no encuentran nada.
5. La primera ejecución manda el mensaje de "monitor activo". Desde ahí solo llegan avisos cuando hay algo nuevo.

Cada ejecución cuenta como uso del agente en la nube, así que la frecuencia de 10 minutos conviene solo para la prueba.
