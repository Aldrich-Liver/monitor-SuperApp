# Instrucciones para agentes

Este repo es el monitor de Crashlytics de Super App (ver [`README.md`](README.md)). Escribe en español.

## Si te piden en Slack revisar un pull request

Cuando alguien te arroba en `#team-mobile` para revisar un PR de `sw-crp-super-app-android` o `sw-crp-super-app-ios`, la revisión la hace la automatización **Revisor Crashlytics**, no tú. Solo la activas:

1. En la carpeta de este repo (normalmente `/agent/repos/monitor-SuperApp`), actualízalo con `git fetch origin main` y `git checkout -f --detach FETCH_HEAD`.
2. Ejecuta `npm run review:request -- <URL del PR>` con el enlace que viene en el mensaje. El comando encuentra el hilo donde se pegó el enlace, avisa ahí que la revisión empezó y activa al Revisor, que responde en ese mismo hilo y comenta en el PR de GitHub.
3. Responde en una sola línea: que el Revisor Crashlytics publicará la revisión en el hilo, o el error que imprimió el comando.

No revises el PR tú, no cambies código y no hagas commits, ramas ni pull requests. Si el mensaje trae varios PR, ejecuta el comando una vez por cada uno.
