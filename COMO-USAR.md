# Cómo usar los agentes en `#team-mobile`

Guía corta para el equipo de desarrollo. El detalle técnico está en el [README](README.md).

## Qué hace cada agente

| Agente | Qué hace | Se activa solo cuando… |
|---|---|---|
| **Monitor Crashlytics** | Abre un hilo por cada falla nueva de la última versión y lleva su estado hasta que se resuelve. A las 9:00 publica el resumen de fallas activas. | Cada hora. |
| **Analista Crashlytics** | Responde en el hilo de la falla con la causa y una solución propuesta. | Aparece una falla nueva. |
| **PR nuevo** | Abre el hilo del PR (o usa el de la falla que corrige) y avisa si falta el gemelo de la otra plataforma. | Abres un PR o lo marcas listo para revisión. |
| **Revisor de PRs** | Revisa el PR con los lineamientos del equipo y responde *Visto bueno* o *Cambios necesarios*, en el hilo y en GitHub. | Se abre el PR. Las revisiones siguientes se piden. |
| **Pruebas de PRs** | Corre las pruebas unitarias y lint de Android y publica el resultado. iOS no se prueba. | Abres el PR de Android y con cada push. |
| **Corrector de fallas** | Busca la causa de una falla, abre los PR en Android y en iOS, espera las pruebas y la revisión, y deja todo listo para que una persona lo fusione. También atiende las notas del Revisor en un PR que ya existe, con commits en la misma rama. | Nunca. Solo trabaja cuando se lo pides. |

Nadie fusiona por ti: el merge siempre lo hace una persona.

## Cómo pedir algo

Escribe **en el hilo del PR o de la falla** y arroba al bot. No necesitas cuenta de Cursor: los bots trabajan con la cuenta del equipo y contestan al momento.

| Quieres… | Escribe |
|---|---|
| Otra revisión después de subir cambios | `@Revisor de PRs revisa este PR` |
| Revisar un PR en particular | `@Revisor de PRs revisa https://github.com/…/pull/9` |
| Correr otra vez las pruebas de Android | `@Pruebas de PRs` |
| Que el Corrector arregle una falla | `@Corrector de fallas corrige esta falla` |
| Otra corrección de una falla que ya tiene PR | `@Corrector de fallas corrige esta falla, es una corrección nueva` |
| Que el Corrector atienda las notas del Revisor | `@Corrector de fallas corrige las notas del revisor` |
| Que atienda solo algunas notas | `@Corrector de fallas corrige las notas del revisor, solo el punto 2` |

Reglas:

- **En el hilo del PR no hace falta el enlace.** El Revisor revisa los PR del hilo (Android e iOS, si están los dos). Si pegas enlaces, revisa solo esos.
- **El Corrector trabaja en el hilo de una falla o en el de un PR.** En el de una falla la corrige; en el de un PR atiende las notas de la última revisión. En el hilo de una falla que ya tiene PR, pídele las notas con la palabra *notas* o *revisor*.
- **Las notas van a la misma rama del PR.** Cualquiera del equipo puede pedirlo, aunque el PR no sea suyo. El Corrector no reescribe la historia de la rama, pero si el autor está trabajando en ella, que haga pull antes de seguir. No trabaja en PR cerrados, fusionados o de un fork.
- **Sube tus cambios antes de pedir la revisión.** El Revisor lee lo que ya está en GitHub.
- **Arroba al bot, no a Cursor.** `@Cursor` solo funciona para quien tiene cuenta de Cursor vinculada; a los demás les contesta *"Link Account"*. Pedírselo a un compañero (`@Juan revisa esto`) tampoco activa ningún agente.

## Cuánto esperar

Todos los tiempos son aproximados y se cuentan desde tu mensaje o desde el push.

| Qué | Primera señal | Resultado |
|---|---|---|
| Aviso del PR nuevo | — | 1 a 2 min después de abrir el PR |
| Revisión | `:eyes: Revisando el PR #…` en segundos | 3 a 10 min |
| Pruebas de Android | `:test_tube: Corriendo pruebas…` en segundos, si las pediste | 5 a 10 min |
| Análisis de una falla nueva | — | 5 a 15 min después de que aparece |
| Corrector | `:wrench: El Corrector toma esta falla` en segundos | PR abiertos en 10 a 30 min; respuesta final en 30 min a 2 h |
| Corrector, notas de un PR | `:wrench: El Corrector atiende las notas…` en segundos | Cambios subidos en 10 a 20 min; respuesta final en 30 min a 1 h |
| Estado de una falla (fusionado, en una versión, resuelta) | — | En la siguiente revisión del monitor, cada hora |

**No repitas el mensaje.** El `:eyes:`, el `:test_tube:` o el `:wrench:` confirman que ya se tomó; escribir otra vez no lo acelera. Si en 2 minutos no aparece ninguna señal, escribe una sola vez más: si el bot estaba caído, el monitor también la toma en su revisión de cada hora.

## El ciclo de un PR

1. Abres el PR (y su gemelo, con la misma rama). En 1 o 2 minutos aparece el aviso en el canal y en 3 a 10 minutos llega la primera revisión, sin pedirla. En Android también llegan las pruebas.
2. Si dice *Cambios necesarios*, corrige y sube los cambios. Las pruebas vuelven a correr solas; la revisión no. También puedes pedirle al Corrector que lo haga: `@Corrector de fallas corrige las notas del revisor`. Sube los cambios a tu rama, espera las pruebas y pide la revisión él solo.
3. Cuando las pruebas digan *Pruebas OK*, escribe en el hilo `@Revisor de PRs revisa este PR`.
4. Con *Visto bueno*, una persona fusiona.

Si no estás de acuerdo con un punto del Revisor, explícalo en el hilo o en el PR y pide otra revisión: lo tomará en cuenta. El Revisor sugiere; la decisión es del equipo.

## Para fijar en el canal

> **Agentes de `#team-mobile`.** Pide todo en el hilo del PR o de la falla, arrobando al bot (no necesitas cuenta de Cursor):
> • Otra revisión: `@Revisor de PRs revisa este PR`, después de subir tus cambios. El `:eyes:` llega en segundos y la revisión en 3 a 10 min.
> • Otra vez las pruebas de Android: `@Pruebas de PRs`. Corren solas con cada push (5 a 10 min).
> • Corregir una falla: `@Corrector de fallas corrige esta falla`. Abre los PR en 10 a 30 min y deja todo listo en hasta 2 h.
> • Atender las notas del Revisor en un PR: `@Corrector de fallas corrige las notas del revisor`. Sube los cambios a la misma rama (haz pull antes de seguir) y responde en 30 min a 1 h.
> El `:eyes:`, el `:test_tube:` o el `:wrench:` confirman que ya se tomó: no repitas el mensaje. El merge lo hace una persona.
