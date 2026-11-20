# Cómo usar los agentes en `#team-mobile`

Guía corta para el equipo de desarrollo. El detalle técnico está en el [README](README.md).

## Qué hace cada agente

| Agente | Qué hace | Se activa solo cuando… |
|---|---|---|
| **Monitor Crashlytics** | Abre un hilo por cada falla nueva de la última versión y lleva su estado hasta que se resuelve. A las 9:00 publica el resumen de fallas activas. | Cada hora. |
| **Analista Crashlytics** | Responde en el hilo de la falla con la causa y una solución propuesta. | Aparece una falla nueva. |
| **PR nuevo** | Abre el hilo del PR (o usa el de la falla que corrige) y avisa si falta el gemelo de la otra plataforma. | Abres un PR o lo marcas listo para revisión. |
| **Revisor de PRs** | Revisa el PR con los lineamientos del equipo y responde *Visto bueno* o *Cambios necesarios*, en el hilo y en GitHub. | Se abre el PR. Las revisiones siguientes hay que pedirlas. |
| **Pruebas de PRs** | Corre las pruebas unitarias y lint de Android y publica el resultado. iOS no se prueba. | Abres el PR de Android y con cada push. |
| **Corrector** | Busca la causa de una falla, abre los PR en Android y en iOS, espera las pruebas y la revisión, y deja todo listo para que una persona lo fusione. | Nunca. Solo trabaja cuando se lo pides. |

Nadie fusiona por ti: el merge siempre lo hace una persona.

## Cómo pedir algo

Escribe **en el hilo del PR o de la falla**, arrobando a **@Cursor**:

| Quieres… | Escribe |
|---|---|
| Otra revisión después de subir cambios | `@Cursor revisa este PR https://github.com/…/pull/9` |
| Revisar los dos PR gemelos | `@Cursor revisa estos PR https://github.com/…android/pull/9 https://github.com/…ios/pull/7` |
| Que el Corrector arregle una falla | `@Cursor corrige esta falla` (en el hilo de la falla, sin enlace) |

Reglas:

- **El enlace del PR va en el mismo mensaje** que la petición de revisión. Sin enlace no hay revisión.
- **Un enlace por PR.** Si pides "ambos" pero pegas dos veces el mismo enlace, solo se revisa uno.
- **Arroba a @Cursor y usa la palabra "revisa" o "corrige"/"arregla".** Pedírselo a un compañero (`@Juan revisa esto`) no activa ningún agente.
- **Sube tus cambios antes de pedir la revisión.** El Revisor lee lo que ya está en GitHub.

### ¿@Cursor o @Revisor de PRs?

Los dos funcionan, pero no tardan lo mismo:

- **@Cursor**: la petición se atiende en 1 o 2 minutos. **Úsalo siempre.**
- **@Revisor de PRs** o **@Corrector de fallas**: el bot no recibe los mensajes al momento. Los encuentra el monitor en su revisión de cada hora, así que puede tardar **hasta 60 minutos** en empezar.

Para usar @Cursor, tu usuario de Slack debe estar vinculado a una cuenta del equipo de Cursor. Si Cursor te contesta *"You can launch Cursor agents directly from Slack. Click the Link Account button…"*, todavía no lo está: toca **Link Account** y entra con tu cuenta del equipo. Si no tienes cuenta, pídela a quien administra las automatizaciones y, mientras tanto, arroba al bot (@Revisor de PRs o @Corrector de fallas). No repitas la petición: el monitor la toma en su siguiente revisión.

Si Cursor contesta con un mensaje corto o con "Open it in Cursor", no pasa nada: la respuesta que cuenta es la del Revisor o la del Corrector.

## Cuánto esperar

Todos los tiempos son aproximados y se cuentan desde tu mensaje o desde el push.

| Qué | Primera señal | Resultado |
|---|---|---|
| Aviso del PR nuevo | — | 1 a 2 min después de abrir el PR |
| Revisión pedida con @Cursor | `:eyes: Revisando el PR #…` en 1 a 2 min | 3 a 10 min |
| Revisión pedida con @Revisor de PRs | `:eyes:` en hasta 60 min | 3 a 10 min después del `:eyes:` |
| Pruebas de Android | — | 5 a 10 min después de cada push |
| Análisis de una falla nueva | — | 5 a 15 min después de que aparece |
| Corrector | `:wrench: El Corrector toma esta falla` en 1 a 2 min | PR abiertos en 10 a 30 min; respuesta final en 30 min a 2 h |
| Estado de una falla (fusionado, en una versión, resuelta) | — | En la siguiente revisión del monitor, cada hora |

**No repitas el mensaje.** El `:eyes:` o el `:wrench:` confirman que ya se tomó; escribir otra vez no lo acelera y puede pedir una revisión duplicada. Si con @Cursor no aparece ninguna señal en 5 minutos, o con el bot en más de una hora, escribe una sola vez más o avisa a quien administra las automatizaciones.

## El ciclo de un PR

1. Abres el PR (y su gemelo, con la misma rama). En 1 o 2 minutos aparece el aviso en el canal y en 3 a 10 minutos llega la primera revisión. En Android también llegan las pruebas.
2. Si dice *Cambios necesarios*, corrige y sube los cambios. Las pruebas vuelven a correr solas; la revisión no.
3. Cuando las pruebas digan *Pruebas OK*, pide otra revisión con `@Cursor revisa este PR <enlace>`.
4. Con *Visto bueno*, una persona fusiona.

Si no estás de acuerdo con un punto del Revisor, explícalo en el hilo o en el PR y pide otra revisión: lo tomará en cuenta. El Revisor sugiere; la decisión es del equipo.

## Para fijar en el canal

> **Agentes de `#team-mobile`.** Pide todo en el hilo del PR o de la falla, arrobando a **@Cursor**:
> • Otra revisión: `@Cursor revisa este PR <enlace>` (un enlace por PR, después de subir tus cambios). Responde en 3 a 10 min.
> • Corregir una falla: `@Cursor corrige esta falla`. Abre los PR en 10 a 30 min y deja todo listo en hasta 2 h.
> • Las pruebas de Android corren solas con cada push (5 a 10 min).
> Arrobar al bot (@Revisor de PRs, @Corrector de fallas) también funciona, pero puede tardar hasta 1 h. El `:eyes:` o el `:wrench:` confirman que ya lo tomó: no repitas el mensaje. El merge lo hace una persona.
