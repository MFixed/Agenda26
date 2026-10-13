/**
 * Escapado de HTML para las plantillas de correo.
 *
 * Va en su propio archivo porque lo usan tres servicios distintos (correo de
 * confirmacion, de cancelacion y de lista de espera) y porque es el unico sitio
 * donde se decide que es seguro meter en un `innerHTML`.
 *
 * Lo que sale de la base lo escribe el usuario: un cliente que se llama
 * `<script>` rompe el correo de confirmacion de todos los que usan el mismo
 * nombre. Es un ataque tonto pero gratis, y por eso se escapa SIEMPRE y no solo
 * cuando "el valor parece peligroso".
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default escapeHtml;
