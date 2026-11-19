# Instrucciones para agentes

Este repo es el monitor de Crashlytics de Super App, el Revisor de PRs, las Pruebas de PRs, el aviso de PRs nuevos y el Corrector de fallas (ver [`README.md`](README.md)). Escribe en español.

## Si te piden en Slack revisar un pull request

Cuando alguien te arroba en `#team-mobile` para revisar un PR de `sw-crp-super-app-android` o `sw-crp-super-app-ios`, sea una corrección, una función nueva o cualquier otro cambio, y sea en un hilo o en el canal principal, la revisión la hace la automatización **Revisor de PRs**, no tú. Solo la activas:

1. En la carpeta de este repo (normalmente `/agent/repos/monitor-SuperApp`), actualízalo con `git fetch origin main` y `git checkout -f --detach FETCH_HEAD`.
2. Ejecuta `npm run review:request -- <URL del PR>` con el enlace que viene en el mensaje. El comando encuentra el mensaje donde se pegó el enlace, avisa en su hilo que la revisión empezó y activa al Revisor, que responde en ese hilo y comenta en el PR de GitHub. Si el mensaje estaba en el canal principal, el hilo se abre debajo de él.
3. Responde en una sola línea: que el Revisor de PRs publicará la revisión en el hilo, o el error que imprimió el comando.

No revises el PR tú, no cambies código y no hagas commits, ramas ni pull requests. Si el mensaje trae varios PR, ejecuta el comando una vez por cada uno.

## Si te piden en Slack corregir una falla

Cuando alguien te arroba en el hilo de una falla de Crashlytics de `#team-mobile` para que la corrijas ("corrige esta falla", "arréglala", "abre el PR"), la corrección la hace la automatización **Corrector**, no tú. Solo la activas:

1. En la carpeta de este repo (normalmente `/agent/repos/monitor-SuperApp`), actualízalo con `git fetch origin main` y `git checkout -f --detach FETCH_HEAD`.
2. Toma la referencia `Ref. CR-…` del mensaje que abre el hilo y ejecuta `npm run fix:request -- CR-…`. Si no ves la referencia, pasa el enlace del hilo. El comando lee el hilo, avisa ahí que el Corrector tomó la falla y lo activa; el Corrector responde en el mismo hilo con los PR de Android y de iOS.
3. Si el comando dice que la falla ya tiene PR o que el Corrector ya está trabajando en ella, responde eso. Solo si quien lo pidió insiste en otra corrección, vuelve a ejecutarlo con `--force`.
4. Responde en una sola línea: que el Corrector responderá en el hilo, o el error que imprimió el comando.

No corrijas la falla tú, no cambies código y no hagas commits, ramas ni pull requests.
