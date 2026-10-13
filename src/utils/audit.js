import { prisma } from '../../config/driver.js';
import { logger } from '../../config/logger.js';

/**
 * Rastro de auditoria.
 *
 * Se escribe "en segundo plano": la peticion no espera a que se guarde. Perder
 * una linea de auditoria por un corte de conexion es aceptable; hacer que el
 * cliente espere a un INSERT que no necesita para su resultado, no.
 *
 * Solo se guarda lo que no lleva datos sensibles. Los `payload` se pasan ya
 * recortados por quien llama (el campo y el valor nuevo), nunca el objeto
 * entero: un audit log con el `passwordHash` dentro es una copia de la tabla de
 * usuarios en un sitio con menos protecciones.
 *
 * `payload` es TEXT con el JSON serializado y no una columna JSON: SQLite no tiene
 * ese tipo. Se serializa aqui una vez y se deserializa al leer.
 */
export function serializarPayload(payload) {
  if (payload === null || payload === undefined) return null;

  try {
    return JSON.stringify(payload);
  } catch {
    /// Si un payload trae algo que no se puede serializar (una Date en un Map, un
    /// ciclo), perder ese registro entero seria peor que perder los detalles.
    return JSON.stringify({ error: 'payload no serializable' });
  }
}

export function auditar({ businessId, actorId, action, entity, entityId, payload, req }) {
  const entrada = {
    businessId: businessId ?? null,
    actorId: actorId ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    payload: serializarPayload(payload),
    ip: req?.ip ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 500) ?? null,
  };

  // Un fallo aqui no puede tumbar la peticion que ya se responded bien.
  prisma.auditLog
    .create({ data: entrada })
    .catch((error) => logger.error('no se pudo escribir el audit log', { action, entity, entityId, error }));

  return entrada;
}

/**
 * Recorta un objeto a los campos interesting antes de auditarlo.
 *
 * Sin esto, auditar `{ ...ficha }` guarda el email y el documento de todo el
 * mundo en una tabla que nadie audita a su vez.
 */
export function cambios(antes, despues, campos) {
  const lista = campos ?? [...new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})])];

  const salida = {};

  for (const campo of lista) {
    const a = antes?.[campo];
    const b = despues?.[campo];

    if (a !== b) {
      salida[campo] = { antes: a ?? null, despues: b ?? null };
    }
  }

  return Object.keys(salida).length > 0 ? salida : null;
}

export default { auditar, cambios };
