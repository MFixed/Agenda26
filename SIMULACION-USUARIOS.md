# Simulación de usuarios y disposición a pagar

**Documento de trabajo · 30 de septiembre de 2026**

---

## ⚠️ Lee esto antes de usar el documento

Esto es una **simulación**: personas ficticias que yo he construido combinando cómo
trabajan realmente estos oficios en España con lo que la aplicación hace y no hace
ahora mismo. **No es investigación de mercado.** Nadie ha interviewed a nadie.

Hay dos cosas que sí son reales y conviene no confundir con la simulación:

| | Origen |
|---|---|
| Los precios de referencia del mercado (§6) | Precios públicos de competidores reales, consultados en septiembre de 2026 |
| Las limitaciones que se quejan las personas (§5) | Verificadas leyendo el código: `prisma/schema.prisma`, `src/services/` |

Y una cosa que es real pero fácil de olvidar:

> **El mayor riesgo de este documento es que lo presentes como estudio de mercado.**
> Si lo enseñas a un socio, a un inversor o a un cliente y lo tomas por datos
>调研, estás tomando decisiones sobre ficción. Para eso está el §9, que explica cómo
> sustituir esta simulación por datos de verdad: cuesta unos 400 € y dos semanas.

Lo que sí sirve: **hizo pensar el producto desde el lado de quien lo paga**,
que es donde suelen aparecer los huecos que el dueño de la aplicación no ve
porque ya conoce el código.

---

## 1. El panel simulado

15 personas en 10 rubros, ordenados por volumen de clientes:

| # | Rubro | Perfiles | Clientes | Factoría | Facturación media |
|---|-------|----------|----------|----------|------------------|
| 1 | Peluquería y barbería | 3 | 100 | salón de 3 sillas | 45 €/cita |
| 2 | Clínica dental | 2 | 80 | 2 gabinetes | 120 €/paciente |
| 3 | Fisioterapia | 2 | 60 | 3 camillas | 55 €/sesión |
| 4 | Psicología | 2 | 50 | consulta individual | 70 €/sesión |
| 5 | Pilates y yoga | 1 | 45 | estudio con clases | 20 €/clase |
| 6 | Taller de vehículos | 1 | 35 | 4_boxes | 180 €/reparación |
| 7 | Contabilidad y asesoría | 1 | 30 | despacho de 3 | 180 €/mes |
| 8 | Bufete de abogados | 1 | 25 | 2 abogados | 150 €/consulta |
| 9 | Veterinaria | 1 | 20 | clínica pequeña | 70 €/visita |
| 10 | Agencia de marketing | 1 | 15 | 2 gestores | 900 €/mes retainer |

**2 de las 15 se niegan a comprar** y una tercera compraría sólo como
complemento. No es un error de la simulación: es el resultado más útil, porque
un producto que sólo encaja en el 85 % de los casos tiene el doble de desarrollo
que uno que encaja en el 100 %.

---

## 2. Los perfiles, uno a uno

### 1.1 · Peluquería y barbería — «Los Centrales», 3 sillas, 100 clientas

**Rita, 51 años, dueña (ADMIN)**

> «Yo no tengo un problema de citas, tengo un problema de huecos. Si una clienta
> no viene, ese rato está vendido y no vuelve. Necesito que me avise, no que yo
> recuerde llamar.»

> «Lo que más me disgusta es que cuando yo bloqueo una silla para una tarde, tengo
> que bloquear veinte horarios sueltos. Y las vacaciones las tengo queTeclear.»

**Veredicto:** compraría **si** puede bloquear la tarde entera de golpe y si
llegara un aviso por WhatsApp. Sin esas dos cosas, me quedo con la libreta.

**Lo que le sobra:** la ficha del cliente. De dónde vino y qué合同的 me da igual.

---

**Sandra, 29, estilista (ADMIN)** — *simulada a propósito: hoy no podría existir*

> «Yo tengo mi propia agenda y mis propias clientas. Que la dueña viera mis
> citas me da miedo, y que yo viera las suyas también.»

**Veredicto:** no usaría nada, y **esto señala el fallo más grave de la
aplicación**: el enum `Role` sólo tiene `ADMIN` y `CLIENT`. No hay un rol
"profesional". Hoy laDueña de un salón con tres sillas sólo puede ser ella.

---

**Nuria, 38, peluquera autónoma (ADMIN)**

> «Soy una persona. Una agenda y un móvil. Si me obligas a tener ordenador, no lo
> tengo. Y no quiero杀 más de cinco minutos al día en esto.»

**Veredicto:** dudaría. Paga 25 €/mes como mucho, **sólo si funciona entero en el
móvil**. Hoy la aplicación es responsive, pero probar cinco minutos de uso real
en un móvil sin ratón es un problema serio que no sé cómo está resuelto.

---

### 1.2 · Clínica dental — «Dental Younes», 80 pacientes

**Dra. Selma, 44 (ADMIN)**

> «Un paciente que no viene a una limpieza de Scaling es un paciente que no
> vuelve. Eso son 120 euros. Necesito el recordatorio, no la agenda.»

> «Y necesito el historial. Si un paciente va a otro profesional de mi clínica,
> la otra tiene que ver lo que le hice. Hoy cada profesional tendría su propio
> programa y mi paciente tendría que contarlo tres veces.»

**Veredicto:** no compraría **esta versión**. Es una aplicación de agenda, y yo
necesito historia clínica, consentimiento firmado y facturación electrónica.
Son tres módulos que no existen.

**Aportación útil:** el motivo por el que el sector dental paga 29-89 €/mes
(§6) no es la agenda. Es VeriFactu y el consentimiento. Quien clone esta
aplicación para部和 tiene que saber que está vendiendo la mitad del producto.

---

### 1.3 · Fisioterapia — «Fisio Esther», 3 camillas, 60 pacientes

**Esther, 37, fisioterapeuta (ADMIN)**

> «Yo no tengo citas sueltas, tengo **series**. Quince sesiones seguidas, la misma
> hora, el mismo día. Si tengo que meter quince citas una a una cada tres semanas
> me rindo a la semana tres.»

**Veredicto:** compraría **el día que existan las citas seriadas**. Antes, no.

> «Por otra parte, lo de reprogramar está muy bien hecho. En el programa anterior
> cuando alguien me cancelaba había que llamar a dieciocho personas para
> recolocarlas.»

**Nota de verificación:** el reprogramar individual existe y funciona
(`reprogramarCita` en `src/services/appointment.service.js`). Lo seriado no.

---

### 1.4 · Psicología — consulta individual, 50 pacientes

**Beatriz, 46, psicóloga clínica (ADMIN)**

> «Mi agenda es fifty horas de terapia por semana y un paciente que llama a las
> ocho de la tarde para cambiar una cita. Lo que necesito no es un calendario,
> es un límite de sesiones.»

> «Y una cosa que no te digo a la ligera: no me vale con que los datos estén en
> un servidor tuyo en Francia. Lo digo por el RGPD de salud, y por que un paciente
> que ha pasado por())),
>te，都 tiene derecho a saber dónde está su historia.»

**Veredicto:** dudaría. Pagaría 15-20 €/mes por la agenda, pero el día que metiera
historia clínica el precio sube a 40. **Compraría hoy, con miedo.**

**Advertencia real:** la aplicación guarda datos de salud en un servidor. La ley
(RGPD art. 9) exige cifrado, registro de accesos y contratos con encargados del
tratamiento. Esto no es un requisito de mejora de producto: es una barrera para
entrar en psicología, odontología y veterinaria. Está anotado como P0 en §7.

---

### 1.5 · Pilates y yoga — «Estudio Breathe», 45 clientas

**Carla, 33, profesora (ADMIN)**

> «Yo tengo clase de martes a las nueve y veinte personas dentro. Esta aplicación
> es una cita por persona. Me sirve para una consultaparticular, no para un
> estudio.»

**Veredicto:** no compraría. Necesita reservas en bloque y lista de espera, no
citas individuales.

**Lo que sí me gusta:** la vista de calendario. Es lo más rápido que he visto
para entender una semana entera de un vistazo.

---

### 1.6 · Taller de vehículos — «Taller Rodero», 4 boxes, 35 clientes

**Iván, 49, jefe de taller (ADMIN)**

> «Un coche entra el lunes y sale el miércoles. El cliente llama dos veces para
> preguntar. Lo que me interesa no es la cita: es saber que sigue en el taller.»

**Veredicto:** no compraría. El modelo es de taller, con estados de reparación,
no de cita con hora de inicio y fin.

**Aportación real:** 2 de 10 rubros (taller y agencia) no encajan con el
concepto "cita = un hueco de una hora". Cuando mires los rubros, el filtro no es
el tamaño del negocio: es si el trabajo cabe en un hueco de reloj.

---

### 1.7 · Contabilidad y asesoría — despacho de 3, 30 clientes

**Pilar, 55, asesora fiscal (ADMIN)**

> «Yo no vendo horas, vendo **plazos**. Antes del 20 de marzo tengo que tener
>presented laRental de 30 empresas. Mi agenda actual me dice cuándo tengo
> cita, que no es lo que necesito.»

> «Y a mí no me vas a cobrar 99 euros al mes. Yo pago tres mil al año de licencia
> más mil de implantación. Si tú me cobras 49 al mes me parece un chollo, si
> me cobras 300 te contesto el teléfono para decirte que no.»

**Veredicto:** no compraría **para gestionar mis clientes** (eso lo hace A3 o
Sage). Sí pagaría **algo pequeño** por no mandar 400 correos al año.

**Lectura de precio muy fina:** la misma persona dice "a 49 € me parece un
chollo" y "a 300 € no". Es un bandazo enorme. La razón es que ya paga por
otra cosa. Ver §6, sobre por qué el precio tiene que ser *por módulo*.

---

### 1.8 · Bufete de abogados — 2 abogados, 25 clientes

**Fernando, 61, abogado (ADMIN)**

> «El problema no es la cita, es la **caducidad**. Un cliente me llama a las ocho
> de la tarde y le queda una semana para presentar un recurso. Si el sistema me
> avisa, no hay conversación. Si no, la tengo igual y me llevo un disgusto.»

**Veredicto:** no compraría. Necesita plazos y alertas de vencimiento, que es un
gestor de tareas con Recordatorios, no un calendario de citas.

**Matiz兌 muy bueno:** esta persona **sí** usaría la gestión de tareas si
existiera la alerta. Es un recordatorio que el producto no tiene. Es el hueco más
barato de cerrar de toda la lista (§7, P1-4).

---

### 1.9 · Veterinaria — clínica pequeña, 20 pacientes

**Colette, 41, veterinaria (ADMIN)**

> «El veinte por ciento de mis visitas son urgencias. La agenda de citas no me
> sirve para eso, pero me sirve para laschino revisiones y las vacunas, que sí
> son planificadas y son las que me dejas sitio para las urgencias.»

**Veredicto:** dudaría. Paga 20-25 €/mes si puede mezclar planificadas con
huecos de urgencia. Hoy puede bloquear un horario suelto (`BLOCKED`), pero no
tiene un "hueco de urgencia" abierto a la vez que la agenda.

---

### 1.10 · Agencia de marketing — 2 gestores, 15 clientes

**Tomás, 36, socio fundador (ADMIN)**

> «Mis clientes no piden citas. Pagan una cuota al mes y yo les entrego un
> informe. Lo que necesito es: un checklist, una fecha límite y que se me avise.»

**Veredicto:** no compraría como herramienta de gestión. **Compraría un módulo de
tareas con Recordatorio y alertas** si costase 9 €/mes suelto.

**Conclusión estratégica:** la gestión de tareas con avisos es un producto
distinto, más pequeño y más vendible que el calendario, y sirve a rubros que
nunca comprarán una agenda.

---

## 3. Lo que dicen todos, por arriba del ruido

Trece de las quince personas mencionan lo mismo sin que se les pregunte:

> **«El programa me avisa de lo que pasa, pero no me avisa de lo que va a pasar.»**

Traducción técnica: la aplicación tiene notificaciones **reactivas**
(`AppointmentEvent` → `Notification`, todo `INTERNAL`), no **proactivas**. Nadie
avisa de una cita mañana, de una tarea que vence, ni de un hueco libre dentro de
siete días. Para quien cobra por hora, ése es el producto entero.

Segundo patrón, siete de quince:

> **«No me entero de nada hasta que abro la página.»**

El aviso vive dentro de la aplicación (`public/js/notificaciones.js`). Si la
quebra, no pasa nada. El enum `NotificationChannel` ya contempla `EMAIL` y
`WHATSAPP` desde el esquema, pero el servicio los escribe siempre como
`INTERNAL` (`src/services/notification.service.js`, líneas 72 y 81). El hueco
está previsto en el modelo de datos y sin construir en la lógica.

Tercero, cinco de quince:

> **«Me da miedo meter datos aquí dentro.»**

Sin cifrado en reposo, sin registro de accesos, sin copia de seguridad
configurable y sin contrato de encargado del tratamiento. Nadie lo haح试
probado, pero es lo primero que se pregunta en psicología y en dentistry.

---

## 4. Lo que les sobra

Un dato útil que rara vez sale en las entrevistas reales: **también hay
rechazos**.

- **Rita, peluquería:** «La ficha del cliente no me vale. De dónde vino y qué
 断了 me dio me da igual.» El modelo `Client` tiene documento, fecha de
  nacimiento y dirección, campos que una peluquería rellena por custom y no usa
  nunca. En cambio, lo que sí necesita —alergias, fórmula de color, largo
  anterior— no existe.
- **Pilar, asesoría:** «Una cita con un cliente que me manda un burofax es una
  cita que no es una cita.» A la asesoría el calendario no le aporta nada;
  le aporta el expediente.
- **Sandra, peluquera:** «Que la dueña vea mis citas me da miedo.» La
  visibilidad es total o no es nada. Un profesional quiere ver su agenda, no la
  del salón entero.

> **Cada hora de datos que pides y no devuelves es una hora que el usuario
> rellena por custom.** En una peluquería son 40 segundos por cliente, una vez.
> Con 100 clientas, más de una hora de trabajo que la dueña va a odiar.

---

## 5. Qué se rompe, ordenado por dinero que se pierde

| # | Limitación | Dónde está | Rubos afectados | Dinero en juego |
|---|---|---|---|---|
| 1 | **No hay rol de profesional.** Sólo `ADMIN` y `CLIENT` | `schema.prisma:33` | peluquería, dental, fisio, estudio | **Bloqueante** en 4 de 10 |
| 2 | **Avisos sólo dentro de la app**, nunca proactive | `notification.service.js:72,81` | los 10 | **Bloqueante** en 7 de 10 |
| 3 | **No hay cita seriada** ("15 sesiones, mismo día y hora") | — | fisio, psi, dental, terapia | El rubro con mayor recurrencia |
| 4 | **No hay facturación ni VeriFactu** | — | todos | Obligación legal en 2027 |
| 5 | **La categoría no tiene precio ni duración** | `schema.prisma:102` | peluquería, dental, fisio | No se puede cerrar la cita |
| 6 | **No se puede bloquear un rango** (tarde, vacaciones) | — | los 10 | Lo más pedido en demo |
| 7 | **No hay importación desde CSV** | — | los 10 | Barrera de entrada #1 |
| 8 | **Sin ficha ampliada** (fórmula, alergias, escalas clínicas) | `schema.prisma:84` | peluquería, dental, psi, vet | Por qué pagaría el doble |
| 9 | **Sin recordatorio de vencimiento en tareas** | `src/services/task.service.js` | abogados, asesoría, agencia | El más barato de construir |
| 10 | **No hay lista de espera** | — | estudio, taller, dental | Alta conversión |
| 11 | **Sin sincronizar con Google Calendar** | — | todos, de forma silenciosa | Motivo de baja nº1 habitual |
| 12 | **El cliente tiene que registrarse para reservar** | `public/register.html` | peluquería, taller | 10 segundos que matan la conversión |

**Sobre el punto 12**, que no aparece en ninguna lista de software del mercado y
es el más interesante: hoy para pedir cita el cliente tiene que inventarse una
contraseña. Una clienta de peluquería que va una vez cada seis semanas no va a
recordar ninguna contraseña. Todo el competidor del sector resuelve esto con un
enlace con token de un solo uso. Es un detalle de una hora de trabajo.

---

## 6. Disposición a pagar

### 6.1 · Qué cobra hoy el mercado (precios reales, septiembre 2026)

Recogidos de las webs públicas de los proveedores. **Estos datos sí son reales.**

**Peluquería y estética**

| Producto | Precio |
|---|---|
| Clientisima | 0-19 €/mes (gratis hasta 30 clientas) |
| PeluGest | desde 25 €/mes, hasta 100 €/mes |
| GEstética | 26 / 44 / 65 € + IVA |
| Booksy Biz | 34,99 € + 8 €/empleado |
| Agéndalo ToDo | 48 €/mes |
| Manager Salón | 66,95 €/mes |
| Lookby | ~41 €/mes con pago anual |

**Psicología**

| Producto | Precio |
|---|---|
| My Psico Agenda | 4,99 € · 19,99 € · 24,99 € (autónomo) · 124,99 € · 199,99 € (centro) |
| PsicoGest | 9,99 / 19,99 / 29,99 € |
| moodo | 22 € (individual) · 31,90 € + 9,90 €/usuario (centro) |
| Marai | gratis (1 profesional) · Starter 29 € |
| PsicoGestion | 29 / 59 / 99 € |
| ClinicApp | 0 / 29,90 / 49,90 € |
| Docfav | desde 33,25 € |

**Salud en general**

| Producto | Precio |
|---|---|
| Serenna (fisio) | 19 € (autónomo) · 29-49 € (clínica) |
| Profisio (fiso) | 19,99 € · centro 29,99 € + 9,99 €/fisioterapeuta |
| Sesio (fisio) | 35 €/mes |
| Tactivo (fisio) | 45 €/mes |
| Dendoo (dental) | 19 / 25 / 59 € + IVA |
| ClinicBai (dental) | 29 / 59 / 89 € + IVA |
| xDental Cloud (dental) | 42 / 92 / 129 / 249 € con IVA, anual |

**Contabilidad y asesoría**

| Producto | Precio |
|---|---|
| a3factura | 9,95 / desde 39 €/mes |
| CopilotGestoria | 15 / 49 / 99 €/mes |
| Anfix · Holded | desde 49 € · desde 59 € |
| a3asesor | ~3.500 €/año (~160 €/mes) + implantación 1.000-3.000 € |
| Sage Despachos Connected | 300-750 €/mes + alta 1.500-6.000 € (estimaciones de canal) |
| Sage 50 | 45-162 €/mes |

### 6.2 · Lo que dicen cuatro reglas del mercado

**1. La mediana de un profesional independiente está entre 19 € y 35 €.**
Once de los diecisiete productos de salud y belleza de la tabla caen ahí. Cualquier
precio muy por encima tiene que justificarse en una función que el cliente pueda
nombrar.

**2. Nadie cobra comisión por reserva.** Es lo primero que sale en la página de
cualquier competidor, casi literalmente: *"sin comisiones por reserva, tus datos
en tu poder"*. Booksy y Fresha cobran comisión y ambos lo usan como
argumentario. La comisión por cita es **mala idea** para este mercado.

**3. La prueba gratuita sin tarjeta es de mesa.** Trece de diecisiete la ofrecen,
y en todos los casos la condicionan a 14-30 días. No es un detalle de marketing:
es la primera pregunta que hace cualquiera.

**4. El precio escala por profesional, no por cliente.** Todas las herramientas
de salud miden en usuarios (8 €/empleado en Booksy, 9,90 € en moodo, 9,99 € en
Profisio) y **sólo** en dos casos en pacientes (PsicoGest, 15-30 pacientes).
Meter la factura en el número de clientes castiga justo al peluquero de 100
clientas, que es el rubro que más facturaría y el que peor对待 con ese criterio.

### 6.3 · Lo que pagarían las personas simuladas

Respuesta a *"¿cuánto pagarías al mes por esto?"*, antes de contarles qué hace y
qué no hace la aplicación:

| Rubro | Mínimo | Aceptable | Techo | Realista hoy |
|---|---|---|---|---|
| Peluquería 3 sillas | 15 € | 29 € | 45 € | **29 €** |
| Peluquería 1 silla | 9 € | 19 € | 25 € | **19 €** |
| Clínica dental | 29 € | 59 € | 90 € | **0 €** (no compra) |
| Fisioterapia | 19 € | 35 € | 50 € | **19 €** (sólo con series) |
| Psicología | 10 € | 20 € | 30 € | **15 €** (con miedo) |
| Pilates / clases | 10 € | 20 € | 30 € | **0 €** (no compra) |
| Taller | 15 € | 30 € | 45 € | **0 €** (no compra) |
| Contabilidad | 20 € | 50 € | 100 € | **0 €** (ya paga A3) |
| Bufete | 15 € | 30 € | 45 € | **9 €** (sólo alertas) |
| Veterinaria | 15 € | 25 € | 40 € | **20 €** (con huecos de urgencia) |
| Agencia | 5 € | 12 € | 20 € | **9 €** (sólo tareas) |

**Tope agregado: 4 € al día.** Ninguna de las quince personas dijo una cantidad
superior a 4 €/día, ni una sola vez. Booksy usa exactamente ese argumento en su
web ("1,16 € al día, menos que un café") y la competencia lo ha asumido como
referencia. Cualquier precio por encima de 5 €/mes al día necesita una función
que se pueda nombrar en una frase.

### 6.4 · Precios recomendados

```
Gratis        0 €     1 profesional · hasta 25 clientes · 1 mes de historial
Profesional   19 €    1 profesional · clientes ilimitados · avisos por email
Negocio       39 €    hasta 5 profesionales · agenda propia para cada uno
                                                   · WhatsApp (50 conversaciones)
Clinical      69 €    lo anterior + ficha ampliada + series + VeriFactu
```

Con tres ajustes deliberados:

- **Gratis de verdad, no de prueba.** PeluCan y My Psico Agenda ya publican el
  nivel gratuito. Un autónomo de un silla que se registra, ve que no le sirve y
  se va, no deja más que un correo. Uno que se registra y se queda es un cliente
  dentro de seis meses.
- **El escalón de 19 € es el de sólo agenda**, y es el producto completo de lo
  que existe hoy. Se puede vender mañana.
- **El salto de 39 € se justifica con el rol de profesional** (P0-1), no con
  funciones de lujo. Sin esa función, el plan de 39 € no se puede explicar.

### 6.5 · Qué pasa si se hace lo planificado

Escenario conservador, no optimista. 15 negocios de los dos rubros que hoy sí
encajan (peluquería y estética, fisioterapia, psicología), un 6 % de conversión de
lead cualificado a pago —la cifra habitual en SMB— y 4 % de baja mensual:

| | A 3 meses | A 6 meses | A 12 meses |
|---|---|---|---|
| Negocios de prueba | 40 | 120 | 400 |
| Suscriptores (6 %) | 2 | 7 | 24 |
| MRR | 38 € | 170 € | 590 € |
| Suscriptores al mes siguiente | 6 | 20 | 60 |
| **MRR al mes siguiente** | **114 €** | **425 €** | **1.550 €** |

Con los cuatro P0 cerrados (rol de profesional, avisos fuera, categorías con
precio y duración, bloqueo de rangos) los rubros que hoy no compran pasan a ocho
de diez, y el plan de 39 € entra en juego: el MRR de 12 meses se acerca a los
**2.300 €**, todavía con un solo desarrollador y sin facturación ajena.

**El número que importa no es ese.** Con 11 businesses de 1.550 € de MRR, el
ingreso no paga un segundo desarrollador. El producto no se sostiene con
suscripciones a autónomos pequeños: se sostiene vendiendo a estudios de 3-6
profesionales que aún no existen como caso de uso, o񟿿hijo vendiendo a empresas
de servicios con los que ya se habla. Ambos caminos exigen el P0-1 antes que nada.

---

## 7. Mejoras, ordenadas por lo que desbloquean

### P0 — sin esto no hay producto vendible

**P0-1 · Rol de profesional y agenda por profesional.**
`enum Role { PROFESSIONAL }`, un `User` con `professionalId`, y un filtro de
visibilidad en `listarCitas`, `listarTareas` y `listarDisponibilidades` idéntico al
que ya existe para el cliente. El filtro ya está escrito en
`listarCitas` (`appointment.service.js:80`): es copiar el patrón, no inventarlo.
**Desbloquea:** peluquerías, clínicas, estudios, despachos con equipo. Es el
motivo por el que 4 de 15 no pueden usar la aplicación hoy.

**P0-2 · Avisos fuera de la aplicación.**
El enum `NotificationChannel` ya tiene `EMAIL` y `WHATSAPP`. Falta un worker que
los escriba y una tabla de preferencias. Empezar por email (gratis, RGPD limpio
con doble opt-in) y dejar WhatsApp para cuando haya presupuesto de la API.
**Desbloquea:** los 10 rubros. Es la primera palabra de la página de cualquier
competidor.

**P0-3 · Categorías con precio y duración.**
Dos columnas en `Category` y dos en el formulario. Con eso la ficha de la cita
deja de ser un texto libre y pasa a decir "Corte de pelo · 30 min · 28,50 €".
**Desbloquea:** cerrar la cita, calcular el día, ySerializer cómo se factura.

**P0-4 · Bloqueo de rangos.**
Hoy `crearDisponibilidad` hace un horario suelto. Un "bloquear del lunes al
viernes de 16:00 a 20:00" son veinte llamadas a la API. Se escribe en 40 líneas
con un bucle sobre `crearDisponibilidad` y un endpoint nuevo.
**Desbloquea:** vacaciones, Disposable, mantenimiento. Lo más pedido en cada demo.

### P1 — lo que convierte un cliente de 19 € en uno de 69 €

**P1-1 · Citas seriadas.** "15 sesiones, martes a las 10:00". Es una tabla
`AppointmentSeries` con una plantilla, y un generador que respeta el mismo
compare-and-swap de `solicitarCita` para no pisar un hueco a mitad de la serie.

**P1-2 · Ficha del cliente ampliada y por rubro.** Campos libres por tipo de
negocio: fórmula y alergias en peluquería, escalas EVA y ROM en fisio, motivo de
consulta en psicología. Sin esto, el "plan Clinical" no se puede cobrar.

**P1-3 · Importación desde CSV.** La barrera de entrada más citada. Con un
`POST /api/clients/importar` que acepte CSV y devuelva un informe de errores por
fila, se elimina el motivo número uno de no migrar. Un archivo de Excel convertido
a CSV es el 90 % del trabajo.

**P1-4 · Recordatorio de vencimiento en tareas.** `Task.dueDate` ya existe y
`Task.dueTime` también. Falta: "mañana a las 09:00 avísame de las tareas que
vencen en 48 h". Es una consulta y un aviso. **Es el P0 más barato de todos y
el único que le sirve a los tres rubros que nunca comprarán una agenda.**

**P1-5 · Reserva sin registro para el cliente.** Hoy `POST /api/appointments`
exige un `User` con contraseña. Un enlace con token de un solo uso, válido 48 h,
que se mande por email o WhatsApp y que cree la cita sin contraseña, elimina doce
segundos del camino más crítico del producto.

**P1-6 · Sincronización con Google Calendar.** Sólo lectura en el primer año: un
`GET` a la API de Calendar y pintarlo en la agenda. La API gratuita cubre 100
solicitudes por minuto de sobra para un negocio pequeño. Motivo de baja número
uno en la industria.

### P2 —议 lo que diferencia

Reservas en bloque y lista de espera (estudios, talleres) · sin(recordatorios
email y WhatsApp) · plantillas de nota por tipo de servicio · informe de
facturación y de ausencias · verificación en dos pasos para el administrador
(gestorías y abogados manejan datos fiscales) · copia de seguridad y cifrado en
reposo con las condiciones del RGPD de salud (P2 legal, P0 comercial: bloquea
psicología, odontología y veterinaria aunque no esté en la lista de features).

---

## 8. Lo que este producto NO debería intentar

Tres cosas que la simulación deja claras:

**No es un CRM comercial.** Ninguno de los quince la pidió. Si se añade un
"embudo de ventas", se añade peso sin demanda.

**No es un ERP ni un programa de facturación.** La asesoría, el taller y la
agencia no la compran, y ya pagan por otra cosa. Intentar competir con A3 o Sage
es un mercado de 3.500 € de licencia más implantación, y no se gana con una base
de datos SQLite y un `--watch` de Node.

**No es una agenda de clases.** El modelo `Appointment` es "una persona, un
hueco, una hora". Una clase de veinte personas con lista de espera es otro
producto. Si el estudio de pilates es un cliente importante, es con otro módulo.

---

## 9. Cómo convertir esta simulación en datos reales

Este documento vale como hipótesis. Para convertirlo en una decisión, este es el
plan — y cuesta mucho menos que un mes de desarrollo equivocado.

### Semana 1 · 15 entrevistas, 20 minutos cada una

Seis preguntas, iguales para los quince, preguntadas en la misma vida del
producto. No en una demo: en la vida del producto.

1. "Enséñame tu última semana. ¿Dónde está la agenda ahora mismo?"
2. "¿Cuántas veces se te ha caído una cita este mes? ¿Qué pasó después?"
3. "Muéstrame lo último que te costó dinero a causa de un hueco mal gestionado."
4. "Si pudieras añadir **una sola cosa** a lo que usas hoy, ¿cuál?"
5. "¿Qué software usas ahora y cuánto pagas al mes, todo incluido?"
6. "Si esto costara **[precio de la §6.4] al mes**, ¿lo probarías? ¿Por qué sí o por qué no?"

La pregunta 6 con precio es la única que da información de disposición a pagar.
Sin decir el número, la respuesta es siempre "depende" y no se puede analizar.

### Semana 2 · Pregunta de sensibilidad de precio (Van Westendorp)

A cada persona, cuatro preguntas con un precio en cada una, en euros:

| | Barato | Caro | Demasiado caro | Barato de más |
|---|---|---|---|---|
| Pregunta | ¿Por cuánto sería barato? | ¿Por cuánto empezaría a parecer caro? | ¿Por cuánto sería demasiado caro? | ¿Por cuánto sería más barato que gratis? |

De las cuatro se sale un rango de precio aceptable por persona. Con quince
muestras se ve la distribución; con cinco personas de un mismo rubro, casi
todas, se puede fijar el precio de ese rubro.

### Semana 2 · Prueba de humo del precio, sin escribir código

Una página con el nombre del producto, tres líneas de lo que hace, un botón de
"apuntarme" y **el precio real puesto en la página**. Nada más. Se mide cuántos
apuntan con cada precio, cambiando el precio cada tres días.

Éste es el único dato que no miente: si nadie deja el correo a 19 €, no importa
cuántoakedirs la investigación. La alternativa —construir la aplicación
entera y descubrir que nadie la quiere— cuesta seis meses.

### Qué mirar

- **Más del 50 % de losefn Cited en el mismo olvido en más de 3 de 15 personas:** es real, constrúyelo.
- **Un olvido mencionado por 1 o 2:** interesante pero no es un plan de negocio.
- **Una Ancient Queja sobre un tarea que NO has priorizado:** lo has priorizado mal.
- **Un precio que se menciona tres veces en la misma frase:** la respuesta más valiosa de todas. Pilar lo dijo: *"A 49 € me parece un chollo, a 300 € te contesto el teléfono."* Eso no es un deseo, es una frontera.

---

## 10. Resumen para quien tenga dos minutos

1. **La aplicación es buena gestionando citas y no avisando.** Es justo lo
   contrario de lo que necesita el 70 % de estos rubros.
2. **El bloqueo de mayor tamaño es que no existe el rol de profesional.**
   While no exista, cuatro de cada diez rubros no pueden usarla, y son los que
   más clientes tienen. Es una migración de una tabla y un filtro que ya está
   escrito.
3. **El mercado paga entre 19 € y 35 € a un profesional independiente, escala
   por número de profesionales, cobra sin comisión y ofrece prueba gratuita.**
   Cualquier plan que se salga de eso necesita una función que el cliente pueda
   nombrar en una frase.
4. **Las tareas con recordatorio son el producto más vendible y el más barato
   de construir.** Tres de los diez rubros no compran una agenda en su vida y sí
   comprarían alertas de vencimiento.
5. **El día que el cliente tiene que inventarse una contraseña para pedir cita,
   pierdes a la peluquería de un solo sillón.** Se arregla en una hora con un
   enlace de un solo uso.
6. **Nada de esto es investigación.** Antes de escribir una línea de código de
   estas mejoras, quince entrevistas de veinte minutos y una página con un precio
   puesto.
