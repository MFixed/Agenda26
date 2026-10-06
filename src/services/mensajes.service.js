/**
 * Avisos externos al cliente: correo, WhatsApp y SMS.
 *
 * Pensado como "capa de envío" separada de las notificaciones internas
 * (notification.service.js): la lógica de negocio sigue creando su
 * notificación INTERNAL igual que antes, y además se llama aquí para que el
 * cliente reciba el aviso también fuera de la app.
 *
 * Cómo se entrega de verdad:
 *   1. RESEND: si RESEND_API_KEY está definida, los avisos por canal "email"
 *      se envían de verdad con la API de Resend (https://resend.com).
 *   2. WEBHOOK: si no hay Resend pero MENSAJES_WEBHOOK_URL está definida, se
 *      hace POST JSON a esa URL con { canal, destinatario, titulo, mensaje }.
 *      Sirve para enganchar Zapier, Make, Twilio/Resend/... o cualquier
 *      pasarela con "trigger webhook".
 *   3. Siempre se deja constancia en el log del servidor con el formato
 *      [aviso:canal] destinatario — título.
 *
 * Que un envío externo falle nunca debe tirar la transacción de la cita: por
 * eso ningún error se propaga hacia arriba.
 */

const urlWebhook = () => (process.env.MENSAJES_WEBHOOK_URL || "").trim();
// Se leen en cada llamada, no al cargar el módulo: el .env puede tardar una
// línea más en estar disponible según el orden de importación.
const resendKey = () => (process.env.RESEND_API_KEY || "").trim();
const resendFrom = () => (process.env.RESEND_FROM || "citas@tu-dominio.com").trim();

/**
 * Enlace "Añadir a Google Calendar" con los datos de la cita.
 * Formato: https://calendar.google.com/calendar/render?action=TEMPLATE&...
 */
export function enlaceGoogleAgenda({ titulo, fechaISO, inicio, fin, detalles = "" }) {
  if (!fechaISO || !inicio) {
    return null;
  }
  const aGoogle = (fecha, hora) => `${fecha.replaceAll("-", "")}T${hora.replace(":", "")}00`;
  const inicioG = aGoogle(fechaISO, inicio);
  const finG = fin ? aGoogle(fechaISO, fin) : `${inicioG.slice(0, 8)}T${String(Number(inicio.slice(0, 2)) + 1).padStart(2, "0")}${inicio.slice(3, 5)}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: titulo,
    dates: `${inicioG}/${finG}`,
    details: detalles
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Fecha ISO a "dd/mm/yyyy" para mostrarla bonita en el correo. */
function fechaBonita(fechaISO) {
  if (!fechaISO) {
    return "";
  }
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** HTML amistoso con tarjeta de la cita y botón de Google Calendar. */
function htmlAmistoso({ titulo, mensaje, nombre, agenda }) {
  const enlaceAgenda = agenda ? enlaceGoogleAgenda(agenda) : null;
  const horario = agenda
    ? `${fechaBonita(agenda.fechaISO)}${agenda.inicio ? ` · ${agenda.inicio}${agenda.fin ? `–${agenda.fin}` : ""}` : ""}`
    : "";
  return `
  <div style="margin:0;padding:24px;background:#f0f4ff;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(51,85,209,.12)">
      <div style="background:linear-gradient(135deg,#3366d1,#6a5cff);padding:24px 28px">
        <h1 style="margin:0;color:#ffffff;font-size:20px">📅 ${titulo}</h1>
      </div>
      <div style="padding:24px 28px;color:#33415c">
        <p style="margin:0 0 12px;font-size:16px">¡Hola${nombre ? ` ${nombre}` : ""}! 👋</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.5">${mensaje}</p>
        ${
          agenda
            ? `<div style="border:1px solid #dbe4ff;border-left:5px solid #3366d1;border-radius:10px;padding:16px 18px;background:#f7f9ff">
                <p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#1d2b53">${agenda.titulo}</p>
                <p style="margin:0;color:#5a6b8c">🕐 ${horario}</p>
                ${agenda.detalles ? `<p style="margin:8px 0 0;color:#5a6b8c;font-style:italic">"${agenda.detalles}"</p>` : ""}
              </div>`
            : ""
        }
        ${
          enlaceAgenda
            ? `<p style="text-align:center;margin:24px 0 8px">
                <a href="${enlaceAgenda}" style="display:inline-block;padding:13px 26px;background:#3366d1;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">➕ Añadir a mi agenda de Google</a>
              </p>`
            : ""
        }
        <p style="margin:20px 0 0;font-size:14px;color:#5a6b8c">Te esperamos con ganas 😊. Si necesitas cambiar algo, contáctanos y lo ajustamos.</p>
      </div>
      <div style="padding:14px 28px;background:#f7f9ff;color:#8496b8;font-size:12px;text-align:center">
        Mensaje automático de Gestión de Citas · No respondas a este correo.
      </div>
    </div>
  </div>`;
}

/** Envía un correo real con Resend. Devuelve true si se envió, false si falló. */
async function enviarEmailResend(destinatario, titulo, mensaje, { agenda, nombre } = {}) {
  const enlaceAgenda = agenda ? enlaceGoogleAgenda(agenda) : null;
  const texto = enlaceAgenda ? `${mensaje}\n\nAñadir a tu agenda de Google:\n${enlaceAgenda}` : mensaje;
  const html = htmlAmistoso({ titulo, mensaje, nombre, agenda });
  try {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendKey()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ from: resendFrom(), to: destinatario, subject: titulo, text: texto, html })
    });
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      console.warn(`[aviso:email] Resend respondió ${respuesta.status}: ${detalle}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[aviso:email] No se pudo enviar con Resend: ${error.message}`);
    return false;
  }
}

/** Envía un solo aviso por un canal concreto. Nunca lanza errores. */
async function enviar(canal, destinatario, titulo, mensaje, agenda, nombre) {
  if (!destinatario) {
    return false;
  }
  console.log(`[aviso:${canal}] ${destinatario} — ${titulo}: ${mensaje}`);
  if (canal === "email" && resendKey()) {
    return enviarEmailResend(destinatario, titulo, mensaje, { agenda, nombre });
  }
  if (!urlWebhook()) {
    return true;
  }
  try {
    await fetch(urlWebhook(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canal, destinatario, titulo, mensaje })
    });
  } catch (error) {
    console.warn(`[aviso:${canal}] No se pudo entregar a ${destinatario}: ${error.message}`);
  }
  return true;
}

/**
 * Avisa al cliente dueño de una cita por todos los canales que tenga:
 * correo (el de su cuenta), WhatsApp y SMS (su teléfono de ficha).
 * Se puede llamar con el cliente de Prisma normal o el de una transacción.
 */
export async function avisarCliente(tx, { clientId, title, message, agenda = null }) {
  if (process.env.AVISOS_EXTERNOS === "off") {
    return 0;
  }
  const cliente = await tx.client.findUnique({
    where: { id: clientId },
    select: { nombre: true, telefono: true, user: { select: { email: true, activo: true } } }
  });
  if (!cliente || cliente.user.activo === false) {
    return 0;
  }
  let enviados = 0;
  if (cliente.user.email) {
    enviados += (await enviar("email", cliente.user.email, title, message, agenda, cliente.nombre)) ? 1 : 0;
  }
  if (cliente.telefono) {
    // Normaliza al formato Uruguay (+598) antes de mandarlo por WhatsApp/SMS.
    let telefono = cliente.telefono.replace(/\D/g, "");
    if (telefono && !telefono.startsWith("598")) {
      telefono = `598${telefono.replace(/^0+/, "")}`;
    }
    const enlace = agenda ? enlaceGoogleAgenda(agenda) : null;
    const mensajeWpp = enlace ? `${message}\n\n📅 Añadir a Google Calendar: ${enlace}` : message;
    enviados += (await enviar("whatsapp", telefono, title, mensajeWpp)) ? 1 : 0;
    enviados += (await enviar("sms", telefono, title, mensajeWpp)) ? 1 : 0;
  }
  return enviados;
}
