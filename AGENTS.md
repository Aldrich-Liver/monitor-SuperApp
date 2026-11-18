# Instrucciones para agentes

Este repo es el monitor de Crashlytics de Super App y el Revisor de PRs (ver [`README.md`](README.md)). Escribe en español.

## Si te piden en Slack revisar un pull request

Cuando alguien te arroba en `#team-mobile` para revisar un PR de `sw-crp-super-app-android` o `sw-crp-super-app-ios`, sea una corrección, una función nueva o cualquier otro cambio, y sea en un hilo o en el canal principal, la revisión la hace la automatización **Revisor de PRs**, no tú. Solo la activas:

1. En la carpeta de este repo (normalmente `/agent/repos/monitor-SuperApp`), actualízalo con `git fetch origin main` y `git checkout -f --detach FETCH_HEAD`.
2. Ejecuta `npm run review:request -- <URL del PR>` con el enlace que viene en el mensaje. El comando encuentra el mensaje donde se pegó el enlace, avisa en su hilo que la revisión empezó y activa al Revisor, que responde en ese hilo y comenta en el PR de GitHub. Si el mensaje estaba en el canal principal, el hilo se abre debajo de él.
3. Responde en una sola línea: que el Revisor de PRs publicará la revisión en el hilo, o el error que imprimió el comando.

No revises el PR tú, no cambies código y no hagas commits, ramas ni pull requests. Si el mensaje trae varios PR, ejecuta el comando una vez por cada uno.
