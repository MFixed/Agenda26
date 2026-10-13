# Opciones de correo

La app manda correo de dos maneras (`MAIL_DRIVER`): **resend** (una API) o **smtp**
(cualquier servidor). El código es el mismo en los dos casos.

Si no hay ninguna configurada, la app **arranca igual** y los avisos se quedan como
notificación dentro del panel. No sale correo, pero nada se rompe.

---

## Comparativa

| Servicio       | Gratis            | Límite                        | ¿Abre en la bandeja?        | Dificultad |
| -------------- | ----------------- | ----------------------------- | --------------------------- | ---------- |
| **Resend**     | Sí                | 3.000/mes · 100/día           | Sí, muy bien                | Muy fácil  |
| **Brevo**      | Sí                | 300/día                       | Sí                          | Fácil      |
| **Mailjet**    | Sí                | 200/día                       | Sí                          | Fácil      |
| **Gmail**      | "Gratis"          | ~500/día, límites no públicos | A veces va a spam           | Media      |
| **Amazon SES** | No (~$0,10/1.000) | Prácticamente ilimitado       | Sí, la mejor entregabilidad | Media      |

---

## Mi recomendación

### Si vas a tener pocos clientes → **Gmail** (lo que ya tienes configurado)

Vale para empezar. Pero **no** para producción con volumen: Gmail pone límites que
no publica, y si detecta envío masivo o un patrón raro **bloquea la cuenta**.

El riesgo no es la aplicación: es que tu cuenta de correo personal deje de funcionar
para ti.

### Si vas en serio → **Resend**

3.000 correos al mes gratis, sin límite práctico de envío, y sale firmado (DKIM/DMARC)
de origen. Es lo que evita que los correos acaben en spam.

> Ojo: los correos gratis de Resend salen **desde `onboarding@resend.dev`**. Tus
> clientes lo verán así, sin tu nombre. Para enviar desde `tunombre@tudominio.com`
> necesitas conectar tu dominio (gratis, unos 5 minutos).

### La opción intermedia → **Brevo**

300 correos al día gratis, y sí permite enviar desde tu propio dominio sin pagar.

---

## Cómo dejar Gmail funcionando

Gmail **no acepta la contraseña normal** de tu cuenta desde un programa. Necesitas una
**contraseña de aplicación**.

### 1. Activa la verificación en dos pasos

Entra en <https://myaccount.google.com/security> y activa **Verificación en dos pasos**.
(Sin esto, Google no deja crear contraseñas de aplicación.)

### 2. Crea la contraseña de aplicación

En la misma página, busca **"Contraseñas de aplicación"** → **Crear**.

Te dará 16 caracteres tipo `abcd efgh ijkl mnop`. **Cópialos**: no se vuelven a mostrar.

### 3. Ponlos en el `.env`

```bash
MAIL_DRIVER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=abcd efgh ijkl mnop
EMAIL_FROM="Agenda26 <tu-correo@gmail.com>"
```

`SMTP_SECURE=false` porque usas el puerto 587, que sube a cifrado con STARTTLS.
(El 465 sería `SMTP_SECURE=true`.)

### 4. Prueba que funciona

```bash
npm run email:probar
```

Si sale `✓ Enviado`, ya está. Si falla, te dice exactamente por qué.

### 5. Mira también la carpeta de spam

Un remitente personal sin firma DKIM llega a spam con mucha frecuencia. **Que esté en
spam no significa que el envío haya fallado.**

---

## Cambiar a Resend después

Si más adelante quieres salir de Gmail, solo tienes que cambiar cuatro líneas del `.env`:

```bash
MAIL_DRIVER=resend
RESEND_API_KEY=re_TU_CLAVE
EMAIL_FROM="Agenda26 <agenda@tudominio.com>"
```

Y borrar (o dejar vacías) las líneas `SMTP_*`. El código no cambia.

---

## Configurar Gmail en un servidor

Si publicas en un servidor, el puerto **587 saliente** tiene que estar permitido. En
muchos proveedores está bloqueado por defecto:

- **Railway / Render / Fly.io**: hay que abrir el puerto 587 en la configuración de red.
- **VPS propio**: normalmente ya está abierto.
- **Si da `Connection timed out`**: es el cortafuegos del proveedor.

---

## El recordatorio importante

Si usas Gmail, **no actives `EMAIL_TEST_DESTINO` en producción** (ya está forzado a
vacío por código). Ese ajuste existe para que en desarrollo los correos te lleguen a
ti y no a tus clientes de prueba. En producción cada recordatorio va a quien le toca.

Y recuerda: para enviar desde tu propio dominio (`agenda@tunombre.com`) en lugar de
`tu-correo@gmail.com`, ningún servicio gratuito personal te lo va a dejar. Necesitas
un dominio propio y conectarlo al servicio.
