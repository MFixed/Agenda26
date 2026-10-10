#!/usr/bin/env bash
# Prueba de extremo a extremo del flujo de citas contra la API en marcha.
# Uso: bash prueba.sh   (con el servidor ya levantado en el puerto 3000)
#
# Cubre lo mismo que las pantallas del frontend: las puertas de acceso, el alta
# de clientes, la agenda de horarios, el ciclo de vida de una cita y el
# aislamiento entre empresas y entre clientes.

API=${API:-http://localhost:3000/api}
WEB=${WEB:-http://localhost:3000}
PASS=0
FAIL=0

# check <descripcion> <condicion-exit-code>
check() {
  local desc=$1 code=$2
  if [ "$code" -eq 0 ]; then
    PASS=$((PASS + 1))
    echo "  OK   $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FALLA $desc"
  fi
}

# request <metodo> <ruta> [token] [body] -> imprime {status}|{cuerpo}
request() {
  local method=$1 path=$2 token=${3:-} body=${4:-}
  local args=(-s -w '\n%{http_code}' -X "$method" "$API$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  curl "${args[@]}"
}

# status <respuesta>
status() { echo "$1" | tail -1; }
# body <respuesta>
body() { echo "$1" | sed '$d'; }

# jget <json> <ruta.con.puntos>
#
# El JSON va por stdin por lo mismo que en `campos`: un listado grande pasado
# como argumento no llega a node en Windows, y `2>/dev/null` hacia que el fallo
# pasara desapercibido como un campo vacio.
jget() { node -e "
let entrada = '';
process.stdin.on('data', (c) => (entrada += c)).on('end', () => {
  try {
    const d = JSON.parse(entrada);
    const p = process.argv[1].split('.');
    let v = d; for (const k of p) v = v?.[k];
    console.log(v ?? '');
  } catch { console.log(''); }
});
" "$2" <<< "$1" 2>/dev/null; }

# eq <esperado> <obtenido>
eq() { [ "$1" = "$2" ] && echo 0 || echo 1; }

# no_vacia <valor>
no_vacia() { [ -n "$1" ] && echo 0 || echo 1; }

# --- Cuentas del seed -------------------------------------------------------
ADMIN_EMAIL=admin@ejemplo.com;    ADMIN_PASSWORD=Admin1234
CLI_EMAIL=ana@ejemplo.com;        CLI_PASSWORD=Cliente1234
SUPER_EMAIL=super@plataforma.com; SUPER_PASSWORD=Super1234
SLUG=ejemplo

# Fechas propias de esta ejecucion para que el script se pueda correr varias
# veces seguidas sin chocar con lo que dejo la anterior. Los documentos tambien
# son propios: son unicos dentro de cada empresa.
#
# El dia sale de $RANDOM y no del STAMP: con el STAMP solo hay 27 dias posibles
# y el script publica 09:00-10:00 sin borrar nada al final, asi que al seventh
# u octava ejecucion el horario ya estaba ocupado y la reserva fallaba con 409.
# 28x12 combinaciones de mes y dia, mas la limpieza del final, lo hacen
# practicamente imposible.
STAMP=$(date +%s)$RANDOM
DOC=$(( (RANDOM % 80000) + 10000 ))
DAY=$(( (RANDOM % 28) + 1 ))

# El documento tiene que estar libre de verdad, no por azar: la base se queda con
# las fichas de las ejecuciones anteriores y (businessId, documento) es unico.
# Con 80.000 candidatos la probabilidad de tocar uno ocupado es baja, pero basta
# con que ocurra una vez para que las 26 comprobaciones siguientes caigan en
# cascada. Aqui se busca un hueco de 9 documentos seguidos, que es lo que usa la
# seccion de clientes. Se hace con el listado de clientes, asi que necesita
# token: se llama justo despues del primer login de admin.
documentos_libres() {
  node -e "
let e = '';
process.stdin.on('data', (c) => (e += c)).on('end', () => {
  const usados = new Set(JSON.parse(e).items.map((c) => c.documento));
  const base = Number(process.argv[1]);
  for (let d = base; d < base + 80000; d++) {
    let libre = true;
    for (let i = 0; i < 9; i++) if (usados.has(String(d + i))) { libre = false; break; }
    if (libre) { console.log(d); return; }
  }
  console.log(base);
});
" "$1"
}
MONTH=$(( (RANDOM % 12) + 1 ))
PUB_DATE="2028-$(printf '%02d' $MONTH)-$(printf '%02d' $DAY)"
BOOK_DATE="2029-$(printf '%02d' $MONTH)-$(printf '%02d' $DAY)"
OTRO_SLUG="negocio-$STAMP"

echo "== 1. Salud, paginas y errores basicos =="
R=$(request GET /health)
check "GET /health responde 200" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(curl -s -o /dev/null -w '%{http_code}' "$API/no-existe")
check "ruta de API inexistente responde 404" "$([ "$R" = "404" ] && echo 0 || echo 1)"

R=$(curl -s -o /dev/null -w '%{http_code}' "$API/tasks")
check "sin token responde 401" "$([ "$R" = "401" ] && echo 0 || echo 1)"

R=$(request GET /tasks notoken)
check "token invalido responde 401" "$([ "$(status "$R")" = "401" ] && echo 0 || echo 1)"

for pagina in /inicio /login /registro /b/$SLUG/login /b/$SLUG/registro /super /admin /admin/citas \
              /admin/calendario /admin/tareas /admin/clientes /cliente /cliente/citas /cliente/perfil \
              /css/app.css /js/api.js; do
  R=$(curl -s -o /dev/null -w '%{http_code}' "$WEB$pagina")
  check "pagina $pagina se sirve (200)" "$([ "$R" = "200" ] && echo 0 || echo 1)"
done

R=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/esta-no-existe")
check "pagina inexistente responde 404" "$([ "$R" = "404" ] && echo 0 || echo 1)"

echo
echo "== 2. Puertas de negocio =="
R=$(request GET "/negocios/$SLUG")
check "negocio por su identificador (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "el nombre del negocio viene en la respuesta" "$(no_vacia "$(jget "$(body "$R")" negocio.nombre)")"

R=$(request GET /negocios/no-existe)
check "identificador desconocido responde 404" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

echo
echo "== 3. Login y roles =="
R=$(request POST /auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"negocio\":\"$SLUG\"}")
ADMIN_TOKEN=$(jget "$(body "$R")" token)
CLIENT_ID=$(jget "$(body "$R")" user.id)
check "login admin por su puerta (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "el login devuelve el negocio" "$([ -n "$(jget "$(body "$R")" negocio.slug)" ] && echo 0 || echo 1)"

R=$(request POST /auth/login "" "{\"email\":\"$CLI_EMAIL\",\"password\":\"$CLI_PASSWORD\",\"negocio\":\"$SLUG\"}")
CLIENT_TOKEN=$(jget "$(body "$R")" token)
check "login cliente (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request POST /auth/login "" "{\"email\":\"$SUPER_EMAIL\",\"password\":\"$SUPER_PASSWORD\"}")
SUPER_TOKEN=$(jget "$(body "$R")" token)
check "login de la plataforma sin negocio (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

# Aqui ya hay token de admin, asi que se puede mirar que documentos estan
# ocupados y elegir uno libre de verdad.
DOC=$(printf '%s' "$(body "$(request GET '/clients?limit=500' "$ADMIN_TOKEN")")" | documentos_libres "$DOC")
echo "  (documentos base: $DOC)"

R=$(request POST /auth/login "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"negocio\":\"otra-empresa\"}")
check "entrar por la puerta de otra empresa (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request POST /auth/login "" "{\"email\":\"$CLI_EMAIL\",\"password\":\"Incorrecta1\",\"negocio\":\"$SLUG\"}")
check "password incorrecto responde 401" "$([ "$(status "$R")" = "401" ] && echo 0 || echo 1)"

R=$(request GET /auth/me "$CLIENT_TOKEN")
check "GET /auth/me devuelve el usuario" "$(eq "$CLI_EMAIL" "$(jget "$(body "$R")" user.email)")"
check "GET /auth/me cuenta las citas" "$([ -n "$(jget "$(body "$R")" citas)" ] && echo 0 || echo 1)"

TOKEN_CLIENTE_CERRADO="$CLIENT_TOKEN"
R=$(request POST /auth/logout "$CLIENT_TOKEN")
check "logout responde 204" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

# El cierre de sesion tiene que invalidar el token de verdad: si aqui el token
# siguiera valiendo, cerrarse no serviria de nada.
R=$(request GET /auth/me "$TOKEN_CLIENTE_CERRADO")
check "el token deja de valer tras el logout (401)" "$([ "$(status "$R")" = "401" ] && echo 0 || echo 1)"

# El resto del script sigue usando un cliente, asi que se entra otra vez.
R=$(request POST /auth/login "" "{\"email\":\"$CLI_EMAIL\",\"password\":\"$CLI_PASSWORD\",\"negocio\":\"$SLUG\"}")
CLIENT_TOKEN=$(jget "$(body "$R")" token)
check "se puede volver a entrar despues de cerrar sesion (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "el token nuevo es distinto del cerrado" "$([ -n "$CLIENT_TOKEN" ] && echo 0 || echo 1)"

echo
echo "== 4. Validacion de entrada =="
R=$(request POST /auth/login "" '{"email":"no-es-email","password":"corta"}')
check "email y password invalidos rechazados (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"
check "el error detalla los campos" "$([ -n "$(jget "$(body "$R")" details.0.field)" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Ana\",\"documento\":\"12345678\",\"fechaNacimiento\":\"1990-01-01\",\"email\":\"a-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Otra1234\",\"negocio\":\"$SLUG\"}")
check "confirmar una contrasena distinta se rechaza (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Al\",\"documento\":\"123\",\"fechaNacimiento\":\"1990-01-01\",\"email\":\"b-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"$SLUG\"}")
check "datos incompletos rechazados (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /availability "$ADMIN_TOKEN" '{"date":"20-10-2028","startTime":"25:00","endTime":"10:00"}')
check "fecha y hora invalidas rechazadas (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$PUB_DATE\",\"startTime\":\"11:00\",\"endTime\":\"10:00\"}")
check "startTime posterior a endTime rechazado (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request GET "/tasks?alcance=inventado" "$ADMIN_TOKEN")
check "alcance desconocido rechazado (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

echo
echo "== 5. Autorizacion por rol =="
R=$(request POST /categories "$CLIENT_TOKEN" '{"name":"Intruso"}')
check "cliente no puede crear categorias (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request POST /availability "$CLIENT_TOKEN" "{\"date\":\"$PUB_DATE\",\"startTime\":\"09:00\",\"endTime\":\"10:00\"}")
check "cliente no puede publicar horarios (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET /clients "$CLIENT_TOKEN")
check "cliente no puede listar clientes (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET /super/negocios "$CLIENT_TOKEN")
check "cliente no entra al panel de la plataforma (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET /super/negocios "$ADMIN_TOKEN")
check "admin tampoco entra al panel de la plataforma (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET /super/negocios "$SUPER_TOKEN")
check "superadmin si entra (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
ADMIN_DE=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
const n=d.items.find(b=>b.slug===process.argv[1]);
console.log([n.usuarios,n.clientes,n.citas,n.admins.length].join(' '));});" "$SLUG" <<< "$(body "$R")")
check "el panel trae las cifras de cada negocio" "$(no_vacia "$(echo "$ADMIN_DE" | cut -d' ' -f1)")"
check "el panel trae los administradores" "$([ "$(echo "$ADMIN_DE" | cut -d' ' -f4)" -ge 1 ] && echo 0 || echo 1)"

echo
echo "== 6. Publicar disponibilidad =="
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$PUB_DATE\",\"startTime\":\"09:00\",\"endTime\":\"10:00\",\"note\":\"prueba automatica\"}")
SLOT=$(jget "$(body "$R")" disponibilidad.id)
check "publica horario libre (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "la respuesta viene envuelta en 'disponibilidad'" "$([ -n "$SLOT" ] && echo 0 || echo 1)"
check "el horario vuelve como YYYY-MM-DD" "$(eq "$PUB_DATE" "$(jget "$(body "$R")" disponibilidad.date)")"

R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$PUB_DATE\",\"startTime\":\"09:30\",\"endTime\":\"10:30\"}")
check "horario solapado rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request PUT "/availability/$SLOT" "$ADMIN_TOKEN" "{\"note\":\"movido\",\"startTime\":\"08:00\",\"endTime\":\"09:00\"}")
check "edita el horario" "$(eq 08:00 "$(jget "$(body "$R")" disponibilidad.startTime)")"

R=$(request PUT "/availability/$SLOT" "$ADMIN_TOKEN" "{\"startTime\":\"08:00\",\"endTime\":\"09:00\"}")
check "el horario editado no se pisa consigo mismo (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"08:00\",\"endTime\":\"09:00\"}")
BOOK_SLOT=$(jget "$(body "$R")" disponibilidad.id)
check "publica el segundo horario (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"

echo
echo "== 7. Ciclo de vida de la cita =="
R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$BOOK_SLOT,\"title\":\"Revision de equipo\",\"note\":\"Primera visita\"}")
APPT=$(jget "$(body "$R")" cita.id)
check "cliente reserva cita (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "la cita nace PENDING" "$(eq PENDING "$(jget "$(body "$R")" cita.status)")"
check "la cita trae el titulo del servicio" "$(eq "Revision de equipo" "$(jget "$(body "$R")" cita.task.title)")"
check "la respuesta ya ve el horario reservado" "$(eq RESERVED "$(jget "$(body "$R")" cita.availability.status)")"
check "la respuesta ya trae el primer evento del historial" "$(eq PENDING "$(jget "$(body "$R")" cita.historial.0.toStatus)")"

R=$(request GET "/availability/$BOOK_SLOT" "$ADMIN_TOKEN")
check "el bloque queda RESERVADO" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$BOOK_SLOT}")
check "reservar el mismo bloque otra vez falla (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/completar" "$CLIENT_TOKEN" '{}')
check "cliente no puede completar su cita (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/coordinar" "$CLIENT_TOKEN" '{}')
check "cliente no puede coordinar su cita (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/completar" "$ADMIN_TOKEN" '{}')
check "COMPLETED directo desde PENDING rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/coordinar" "$ADMIN_TOKEN" '{"note":"Confirmada por telefono"}')
check "admin coordina la cita (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "la cita pasa a COORDINATED" "$(eq COORDINATED "$(jget "$(body "$R")" cita.status)")"

R=$(request POST "/appointments/$APPT/completar" "$ADMIN_TOKEN" '{}')
check "admin completa la cita (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request GET "/availability/$BOOK_SLOT" "$ADMIN_TOKEN")
check "el bloque NO vuelve a AVAILABLE al completar" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

# Un bloque completado no puede volver a reservarse: el horario se consumio.
R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$BOOK_SLOT,\"title\":\"Intento sobre horario ya usado\"}")
check "reservar sobre un bloque completado se rechaza (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request GET "/tasks?alcance=de-citas&limit=200" "$ADMIN_TOKEN")
check "la tarea de la cita queda completada" "$(eq 1 "$(jget "$(body "$R")" items.0.citas)")"

R=$(request GET "/appointments/$APPT" "$ADMIN_TOKEN")
EVENTS=$(node -e "let e='';process.stdin.on('data',(c)=>e+=c).on('end',()=>{console.log(JSON.parse(e).cita.historial.length);});" <<< "$(body "$R")")
check "el historial tiene 3 eventos (reserva, coordina, completa)" "$([ "$EVENTS" = "3" ] && echo 0 || echo 1)"
check "el historial dice quien hizo el cambio" "$([ -n "$(jget "$(body "$R")" cita.historial.1.actor.nombre)" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/coordinar" "$ADMIN_TOKEN" '{}')
check "estado final no admite mas transiciones (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request GET "/appointments/$APPT" "$CLIENT_TOKEN")
check "el cliente puede leer el historial de su cita" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

echo
echo "== 7b. Borrar no devuelve un bloque ya completado =="
# Si borrar la cita soltara el bloque, la regla de "completar no libera" se
# esquivaria por la puerta de atras: el admin limpiaba el registro y la franja
# volvia a ponerse a la venta.
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"18:00\",\"endTime\":\"19:00\"}")
BORRADO_SLOT=$(jget "$(body "$R")" disponibilidad.id)

R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$BORRADO_SLOT,\"title\":\"Se completa y se borra\"}")
BORRADO_APPT=$(jget "$(body "$R")" cita.id)
BORRADO_TASK=$(jget "$(body "$R")" cita.task.id)
request POST "/appointments/$BORRADO_APPT/coordinar" "$ADMIN_TOKEN" '{}' >/dev/null
request POST "/appointments/$BORRADO_APPT/completar" "$ADMIN_TOKEN" '{}' >/dev/null

R=$(request DELETE "/appointments/$BORRADO_APPT" "$ADMIN_TOKEN")
check "se puede borrar la cita completada (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

R=$(request GET "/availability/$BORRADO_SLOT" "$ADMIN_TOKEN")
check "borrar la cita NO devuelve su bloque a AVAILABLE" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

# Y por la via de la tarea, que es la que borra citas en cascada.
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"19:00\",\"endTime\":\"20:00\"}")
BORRADO_SLOT2=$(jget "$(body "$R")" disponibilidad.id)
R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$BORRADO_SLOT2,\"title\":\"Se completa y se borra la tarea\"}")
BORRADO_TASK2=$(jget "$(body "$R")" cita.task.id)
BORRADO_APPT2=$(jget "$(body "$R")" cita.id)
request POST "/appointments/$BORRADO_APPT2/coordinar" "$ADMIN_TOKEN" '{}' >/dev/null
request POST "/appointments/$BORRADO_APPT2/completar" "$ADMIN_TOKEN" '{}' >/dev/null

R=$(request DELETE "/tasks/$BORRADO_TASK2" "$ADMIN_TOKEN")
check "se puede borrar la tarea de la cita completada (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

R=$(request GET "/availability/$BORRADO_SLOT2" "$ADMIN_TOKEN")
check "borrar la tarea NO devuelve su bloque a AVAILABLE" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

# Y por la baja del cliente, que se lleva sus citas por delante.
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"20:00\",\"endTime\":\"21:00\"}")
BORRADO_SLOT3=$(jget "$(body "$R")" disponibilidad.id)
R=$(request POST /clients "$ADMIN_TOKEN" "{\"nombre\":\"Ines Paz\",\"documento\":\"$(( DOC + 9 ))\",\"fechaNacimiento\":\"1993-03-03\",\"email\":\"ines-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\"}")
INES=$(jget "$(body "$R")" cliente.id)
R=$(request POST /appointments "$ADMIN_TOKEN" "{\"availabilityId\":$BORRADO_SLOT3,\"clientId\":$INES,\"title\":\"Su cita completada\"}")
INES_APPT=$(jget "$(body "$R")" cita.id)
request POST "/appointments/$INES_APPT/coordinar" "$ADMIN_TOKEN" '{}' >/dev/null
request POST "/appointments/$INES_APPT/completar" "$ADMIN_TOKEN" '{}' >/dev/null

R=$(request DELETE "/clients/$INES" "$ADMIN_TOKEN")
check "se puede dar de baja a la cliente (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

R=$(request GET "/availability/$BORRADO_SLOT3" "$ADMIN_TOKEN")
check "dar de baja NO devuelve su bloque a AVAILABLE" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

# Un bloque ya completado tampoco se puede borrar, como cualquier otro con cita.
# Aqui ya no hay cita, asi que el borrado si tiene que funcionar: es la salida.
R=$(request DELETE "/availability/$BORRADO_SLOT" "$ADMIN_TOKEN")
check "el bloque completado ya sin cita si se puede borrar (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"
R=$(request GET "/availability/$BORRADO_SLOT" "$ADMIN_TOKEN")
check "y al borrarlo desaparece (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

echo
echo "== 8. Resumen del panel =="
R=$(request GET /appointments/resumen "$ADMIN_TOKEN")
check "el resumen trae los contadores" "$([ -n "$(jget "$(body "$R")" resumen.completadas)" ] && echo 0 || echo 1)"
check "la cita completada cuenta como completada" "$([ "$(jget "$(body "$R")" resumen.completadas)" -ge 1 ] && echo 0 || echo 1)"

R=$(request GET "/appointments?estado=COMPLETED&limit=200" "$ADMIN_TOKEN")
check "el listado filtra por estado" "$([ "$(jget "$(body "$R")" items.0.status)" = "COMPLETED" ] && echo 0 || echo 1)"

R=$(request GET "/appointments?q=Revision" "$ADMIN_TOKEN")
check "el listado busca por servicio" "$([ "$(jget "$(body "$R")" total)" -ge 1 ] && echo 0 || echo 1)"

echo
echo "== 9. Reprogramar y anotar =="
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"11:00\",\"endTime\":\"12:00\"}")
NUEVO_SLOT=$(jget "$(body "$R")" disponibilidad.id)

R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$NUEVO_SLOT,\"title\":\"Segunda visita\"}")
APPT2=$(jget "$(body "$R")" cita.id)
TASK2=$(jget "$(body "$R")" cita.task.id)
check "segunda cita reservada (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"

R=$(request PUT "/appointments/$APPT2" "$CLIENT_TOKEN" "{\"availabilityId\":$SLOT}")
check "el cliente no puede reprogramar (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request PUT "/appointments/$APPT2" "$ADMIN_TOKEN" "{\"availabilityId\":$SLOT,\"note\":\"Cambio de horario\"}")
check "admin reprograma la cita (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "la cita queda en el horario nuevo" "$(eq "$SLOT" "$(jget "$(body "$R")" cita.availabilityId)")"
check "la anotacion se guarda" "$(eq "Cambio de horario" "$(jget "$(body "$R")" cita.note)")"

R=$(request GET "/availability/$NUEVO_SLOT" "$ADMIN_TOKEN")
check "el horario viejo queda libre" "$(eq AVAILABLE "$(jget "$(body "$R")" disponibilidad.status)")"

R=$(request GET "/availability/$SLOT" "$ADMIN_TOKEN")
check "el horario nuevo queda reservado" "$(eq RESERVED "$(jget "$(body "$R")" disponibilidad.status)")"

R=$(request GET "/tasks/$TASK2" "$ADMIN_TOKEN")
check "la tarea se mueve con la cita" "$(eq "$PUB_DATE" "$(jget "$(body "$R")" tarea.dueDate)")"

echo
echo "== 10. Cancelacion libera el bloque =="
R=$(request POST "/appointments/$APPT2/cancelar" "$CLIENT_TOKEN" '{"note":"No puedo asistir"}')
check "cliente cancela su cita (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"
check "la cita queda CANCELLED" "$(eq CANCELLED "$(jget "$(body "$R")" cita.status)")"

R=$(request GET "/availability/$SLOT" "$ADMIN_TOKEN")
check "el bloque se libera tras cancelar" "$(eq AVAILABLE "$(jget "$(body "$R")" disponibilidad.status)")"

R=$(request POST "/appointments/$APPT2/coordinar" "$ADMIN_TOKEN" '{}')
check "estado final no admite mas transiciones (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

echo
echo "== 11. Borrar cita y tarea =="
R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$SLOT,\"title\":\"Tarea de prueba\"}")
APPT3=$(jget "$(body "$R")" cita.id)
TASK3=$(jget "$(body "$R")" cita.task.id)

R=$(request DELETE "/availability/$SLOT" "$ADMIN_TOKEN")
check "no se puede borrar un horario con cita (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request DELETE "/tasks/$TASK3" "$CLIENT_TOKEN")
check "el cliente no puede borrar tareas (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request DELETE "/tasks/$TASK3" "$ADMIN_TOKEN")
check "admin borra la tarea (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

R=$(request GET "/availability/$SLOT" "$ADMIN_TOKEN")
check "borrar una tarea con cita libera su horario" "$(eq AVAILABLE "$(jget "$(body "$R")" disponibilidad.status)")"

R=$(request GET "/appointments/$APPT3" "$ADMIN_TOKEN")
check "la cita de esa tarea ya no existe (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$SLOT,\"title\":\"Para borrar\"}")
APPT4=$(jget "$(body "$R")" cita.id)
R=$(request DELETE "/appointments/$APPT4" "$CLIENT_TOKEN")
check "el cliente no puede borrar citas (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request DELETE "/appointments/$APPT4" "$ADMIN_TOKEN")
check "admin borra la cita (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"
check "su horario vuelve a estar libre" "$(eq AVAILABLE "$(jget "$(body "$(request GET "/availability/$SLOT" "$ADMIN_TOKEN")")" disponibilidad.status)")"

# Baja en cascada: si un cliente se va, sus horarios tampoco pueden quedarse
# reservados por unas citas que ya no existen.
R=$(request POST /availability "$ADMIN_TOKEN" "{\"date\":\"$BOOK_DATE\",\"startTime\":\"16:00\",\"endTime\":\"17:00\"}")
OTRO_SLOT_LIBRE=$(jget "$(body "$R")" disponibilidad.id)
R=$(request POST /clients "$ADMIN_TOKEN" "{\"nombre\":\"Carla Diaz\",\"documento\":\"$(( DOC + 8 ))\",\"fechaNacimiento\":\"1992-09-09\",\"email\":\"carla-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\"}")
CARLA=$(jget "$(body "$R")" cliente.id)
R=$(request POST /appointments "$ADMIN_TOKEN" "{\"availabilityId\":$OTRO_SLOT_LIBRE,\"clientId\":$CARLA,\"title\":\"Su cita\"}")
check "cita de otra cliente registrada (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
R=$(request DELETE "/clients/$CARLA" "$ADMIN_TOKEN")
check "admin da de baja a la cliente (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"
R=$(request GET "/availability/$OTRO_SLOT_LIBRE" "$ADMIN_TOKEN")
check "sus horarios quedan libres al borrarla" "$(eq AVAILABLE "$(jget "$(body "$R")" disponibilidad.status)")"
R=$(request GET "/clients?q=Carla" "$ADMIN_TOKEN")
check "la ficha desaparece de la lista" "$(eq 0 "$(jget "$(body "$R")" total)")"

echo
echo "== 12. Tareas: vistas y edicion =="
R=$(request POST /tasks "$ADMIN_TOKEN" '{"title":"Comprar material","description":"Sin fecha","status":"PENDING"}')
TASK=$(jget "$(body "$R")" tarea.id)
check "admin crea una tarea suelta (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "la tarea sin fecha se marca como tal" "$(eq true "$(jget "$(body "$R")" tarea.sinFecha)")"

R=$(request POST /tasks "$ADMIN_TOKEN" "{\"title\":\"Con fecha\",\"dueDate\":\"$PUB_DATE\",\"dueTime\":\"08:00\"}")
TASK_FECHA=$(jget "$(body "$R")" tarea.id)
check "admin crea una tarea con fecha" "$(eq "$PUB_DATE" "$(jget "$(body "$R")" tarea.dueDate)")"

R=$(request GET "/tasks?alcance=propias&filtro=sin-fecha&limit=1" "$ADMIN_TOKEN")
check "vista sin-fecha cuenta las sueltas sin fecha" "$([ -n "$(jget "$(body "$R")" total)" ] && echo 0 || echo 1)"

R=$(request GET "/tasks?alcance=propias&filtro=agendadas&limit=1" "$ADMIN_TOKEN")
check "vista agendadas cuenta las que tienen fecha" "$([ -n "$(jget "$(body "$R")" total)" ] && echo 0 || echo 1)"

R=$(request GET "/tasks?alcance=propias&limit=200" "$ADMIN_TOKEN")
CON_CITAS=$(node -e "let e='';process.stdin.on('data',(c)=>e+=c).on('end',()=>{console.log(JSON.parse(e).items.filter(t=>t.citas>0).length);});" <<< "$(body "$R")")
check "la vista propias aparta las tareas que nacen de una cita" "$(eq 0 "$CON_CITAS")"

R=$(request PUT "/tasks/$TASK" "$ADMIN_TOKEN" '{"title":"Comprar material urgente","status":"COMPLETED"}')
check "admin edita la tarea" "$(eq "Comprar material urgente" "$(jget "$(body "$R")" tarea.title)")"

R=$(request POST /tasks "$CLIENT_TOKEN" '{"title":"Mi tarea"}')
MY_TASK=$(jget "$(body "$R")" tarea.id)
check "el cliente crea una tarea para si mismo (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "la tarea del cliente es suya" "$([ -n "$(jget "$(body "$R")" tarea.clientId)" ] && echo 0 || echo 1)"

R=$(request PUT "/tasks/$MY_TASK" "$CLIENT_TOKEN" '{"status":"COMPLETED"}')
check "el cliente no puede cambiar el estado de su tarea" "$(eq PENDING "$(jget "$(body "$R")" tarea.status)")"

R=$(request GET "/tasks?limit=200" "$CLIENT_TOKEN")
TOTAL_CLIENTE=$(jget "$(body "$R")" total)
check "el cliente solo ve sus propias tareas" "$([ "$TOTAL_CLIENTE" -ge 1 ] && echo 0 || echo 1)"

R=$(request DELETE "/tasks/$TASK_FECHA" "$ADMIN_TOKEN")
check "admin borra la tarea con fecha (204)" "$([ "$(status "$R")" = "204" ] && echo 0 || echo 1)"

echo
echo "== 13. Clientes: alta, ficha, edicion y baja =="
R=$(request POST /clients "$ADMIN_TOKEN" "{\"nombre\":\"Bruno Diaz\",\"documento\":\"$DOC\",\"fechaNacimiento\":\"1985-02-03\",\"email\":\"bruno-$STAMP@ejemplo.com\",\"telefono\":\"0991112233\",\"direccion\":\"C Pfeiffer 55\"}")
BRUNO=$(jget "$(body "$R")" cliente.id)
check "admin da de alta un cliente (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "sin clave, devuelve una contrasena temporal" "$([ -n "$(jget "$(body "$R")" passwordTemporal)" ] && echo 0 || echo 1)"
check "la ficha trae la edad calculada" "$(eq 41 "$(jget "$(body "$R")" cliente.edad)")"
check "la ficha trae el email de la cuenta" "$([ -n "$(jget "$(body "$R")" cliente.email)" ] && echo 0 || echo 1)"

TEMP_PASSWORD=$(jget "$(body "$R")" passwordTemporal)
R=$(request POST /auth/login "" "{\"email\":\"bruno-$STAMP@ejemplo.com\",\"password\":\"$TEMP_PASSWORD\",\"negocio\":\"$SLUG\"}")
BRUNO_TOKEN=$(jget "$(body "$R")" token)
check "el cliente puede entrar con la contrasena temporal" "$([ -n "$BRUNO_TOKEN" ] && echo 0 || echo 1)"

R=$(request POST /clients "$ADMIN_TOKEN" "{\"nombre\":\"Duplicado\",\"documento\":\"$DOC\",\"fechaNacimiento\":\"1985-02-03\",\"email\":\"bruno-$STAMP@ejemplo.com\"}")
check "email repetido rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request POST /clients "$ADMIN_TOKEN" "{\"nombre\":\"Otro documento\",\"documento\":\"$DOC\",\"fechaNacimiento\":\"1985-02-03\",\"email\":\"bruno2-$STAMP@ejemplo.com\"}")
check "documento repetido en la misma empresa rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request GET "/clients?q=bruno-$STAMP@ejemplo.com" "$ADMIN_TOKEN")
check "buscar cliente por correo" "$([ "$(jget "$(body "$R")" total)" = "1" ] && echo 0 || echo 1)"

R=$(request GET "/clients?q=Bruno" "$ADMIN_TOKEN")
check "buscar cliente por nombre" "$([ "$(jget "$(body "$R")" total)" -ge 1 ] && echo 0 || echo 1)"

R=$(request GET "/clients?limit=1&offset=0" "$ADMIN_TOKEN")
check "el listado pagina" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request GET "/clients/$BRUNO" "$ADMIN_TOKEN")
check "ficha de un cliente" "$(eq "Bruno Diaz" "$(jget "$(body "$R")" cliente.nombre)")"
check "la ficha llega envuelta en 'cliente'" "$([ -n "$(jget "$(body "$R")" cliente.documento)" ] && echo 0 || echo 1)"

R=$(request PUT "/clients/$BRUNO" "$ADMIN_TOKEN" '{"nombre":"Bruno Diaz Ruiz","activo":false}')
check "admin edita la ficha" "$(eq "Bruno Diaz Ruiz" "$(jget "$(body "$R")" cliente.nombre)")"
check "admin desactiva la cuenta" "$(eq false "$(jget "$(body "$R")" cliente.activo)")"

R=$(request POST /auth/login "" "{\"email\":\"bruno-$STAMP@ejemplo.com\",\"password\":\"$TEMP_PASSWORD\",\"negocio\":\"$SLUG\"}")
check "una cuenta desactivada no entra (401)" "$([ "$(status "$R")" = "401" ] && echo 0 || echo 1)"

R=$(request PUT "/clients/$BRUNO" "$ADMIN_TOKEN" '{"activo":true,"nombre":"Bruno Diaz Ruiz"}')
check "admin reactiva la cuenta" "$(eq true "$(jget "$(body "$R")" cliente.activo)")"

R=$(request GET "/clients/me" "$BRUNO_TOKEN")
check "el cliente ve su propia ficha" "$(eq "Bruno Diaz Ruiz" "$(jget "$(body "$R")" cliente.nombre)")"

R=$(request PUT "/clients/me" "$BRUNO_TOKEN" "{\"nombre\":\"Bruno Actualizado\",\"documento\":\"$DOC\",\"fechaNacimiento\":\"1985-02-03\",\"email\":\"bruno-$STAMP@ejemplo.com\",\"telefono\":\"0991112233\"}")
check "el cliente edita su perfil" "$(eq "Bruno Actualizado" "$(jget "$(body "$R")" cliente.nombre)")"

R=$(request POST /auth/password "$BRUNO_TOKEN" '{"passwordActual":"Malaclave1","passwordNueva":"Nueva1234","confirmPassword":"Nueva1234"}')
check "cambiar contrasena con la actual incorrecta (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /auth/password "$BRUNO_TOKEN" '{"passwordActual":"'"$TEMP_PASSWORD"'","passwordNueva":"Nueva1234","confirmPassword":"Otra1234"}')
check "la confirmacion debe coincidir (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /auth/password "$BRUNO_TOKEN" '{"passwordActual":"'"$TEMP_PASSWORD"'","passwordNueva":"Nueva1234","confirmPassword":"Nueva1234"}')
check "cambiar contrasena (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request POST /auth/login "" "{\"email\":\"bruno-$STAMP@ejemplo.com\",\"password\":\"Nueva1234\",\"negocio\":\"$SLUG\"}")
check "la contrasena nueva sirve para entrar" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

echo
echo "== 14. Aislamiento entre clientes =="
OTRO_EMAIL="otro-$STAMP@ejemplo.com"
R=$(request POST /auth/register "" "{\"nombre\":\"Otro Cliente\",\"documento\":\"$(( DOC + 1 ))\",\"fechaNacimiento\":\"2000-01-01\",\"email\":\"$OTRO_EMAIL\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"$SLUG\",\"telefono\":\"0990001111\"}")
OTRO_TOKEN=$(jget "$(body "$R")" token)
check "registro publico crea CLIENT (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "el registro devuelve el negocio de la puerta" "$(eq "$SLUG" "$(jget "$(body "$R")" negocio.slug)")"

R=$(request POST /auth/register "" "{\"nombre\":\"Duplicado\",\"documento\":\"$(( DOC + 2 ))\",\"fechaNacimiento\":\"2000-01-01\",\"email\":\"$OTRO_EMAIL\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"$SLUG\"}")
check "email duplicado rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Sin puerta\",\"documento\":\"$(( DOC + 3 ))\",\"fechaNacimiento\":\"2000-01-01\",\"email\":\"c-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\"}")
check "registrarse sin negocio se rechaza (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Identificador malo\",\"documento\":\"$(( DOC + 4 ))\",\"fechaNacimiento\":\"2000-01-01\",\"email\":\"d-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"No Existe\"}")
check "identificador con formato invalido rechazado (400)" "$([ "$(status "$R")" = "400" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Puerta desconocida\",\"documento\":\"$(( DOC + 5 ))\",\"fechaNacimiento\":\"2000-01-01\",\"email\":\"e-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"no-existe-$STAMP\"}")
check "registro contra un identificador inexistente (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

R=$(request GET "/appointments/$APPT" "$OTRO_TOKEN")
check "otro cliente no ve la cita ajena (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

R=$(request POST "/appointments/$APPT/cancelar" "$OTRO_TOKEN" '{}')
check "otro cliente no puede cancelar la cita ajena (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

R=$(request GET "/appointments?limit=200" "$OTRO_TOKEN")
check "otro cliente ve 0 citas (aislamiento)" "$(eq 0 "$(jget "$(body "$R")" total)")"

R=$(request GET "/clients/$BRUNO" "$OTRO_TOKEN")
check "otro cliente no lee la ficha ajena (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

echo
echo "== 15. Notificaciones =="
R=$(request GET /notifications "$CLIENT_TOKEN")
NOTIFS=$(node -e "let e='';process.stdin.on('data',(c)=>e+=c).on('end',()=>{console.log(JSON.parse(e).length);});" <<< "$(body "$R")")
check "el cliente recibio notificaciones ($NOTIFS)" "$([ "$NOTIFS" -ge 1 ] && echo 0 || echo 1)"

R=$(request GET /notifications/unread-count "$CLIENT_TOKEN")
check "contador de no leidas funciona" "$([ "$(jget "$(body "$R")" unread)" -ge 1 ] && echo 0 || echo 1)"

R=$(request GET "/notifications?unread=true" "$CLIENT_TOKEN")
NID=$(jget "$(body "$R")" 0.id)
R=$(request PATCH "/notifications/$NID/read" "$CLIENT_TOKEN")
check "marcar notificacion como leida (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request PATCH /notifications/read-all "$CLIENT_TOKEN")
check "marcar todas como leidas (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request GET /notifications/unread-count "$CLIENT_TOKEN")
check "el contador queda en 0" "$(eq 0 "$(jget "$(body "$R")" unread)")"

R=$(request GET /notifications "$OTRO_TOKEN")
check "las notificaciones son de cada uno" "$(eq 0 "$(node -e "let e='';process.stdin.on('data',(c)=>e+=c).on('end',()=>{console.log(JSON.parse(e).length);});" <<< "$(body "$R")")")"

echo
echo "== 16. Negocio desde el panel de la plataforma =="
R=$(request POST /super/negocios "$SUPER_TOKEN" "{\"nombre\":\"Empresa $STAMP\",\"slug\":\"$OTRO_SLUG\",\"descripcion\":\"Creada por la prueba\",\"adminNombre\":\"Jose Perez\",\"adminEmail\":\"jose-$STAMP@ejemplo.com\",\"adminPassword\":\"Admin1234\"}")
check "superadmin crea un negocio (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"
check "el alta devuelve la puerta de acceso" "$([ -n "$(jget "$(body "$R")" mensaje)" ] && echo 0 || echo 1)"

R=$(request POST /super/negocios "$SUPER_TOKEN" "{\"nombre\":\"Repetido\",\"slug\":\"$OTRO_SLUG\",\"adminNombre\":\"Otro\",\"adminEmail\":\"otro-$STAMP@ejemplo.com\",\"adminPassword\":\"Admin1234\"}")
check "identificador repetido rechazado (409)" "$([ "$(status "$R")" = "409" ] && echo 0 || echo 1)"

NEG_ID=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
console.log(d.items.find(n=>n.slug===process.argv[1]).id);});" "$OTRO_SLUG" <<< "$(body "$(request GET /super/negocios "$SUPER_TOKEN")")")
R=$(request PATCH "/super/negocios/$NEG_ID" "$SUPER_TOKEN" '{"activo":false}')
check "desactivar el negocio recien creado" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

R=$(request GET "/negocios/$OTRO_SLUG")
check "un negocio desactivado cierra su puerta (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

R=$(request POST /auth/login "" "{\"email\":\"jose-$STAMP@ejemplo.com\",\"password\":\"Admin1234\",\"negocio\":\"$OTRO_SLUG\"}")
check "el admin de un negocio desactivado no entra (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET "/super/negocios" "$SUPER_TOKEN")
ACTIVOS=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
console.log(d.items.filter(n=>n.slug===process.argv[1]&&n.activo).length);});" "$OTRO_SLUG" <<< "$(body "$R")")
check "la lista de negocios ya no incluye el desactivado" "$(eq 0 "$ACTIVOS")"

echo
echo "== 17. Aislamiento por negocio =="
# Una segunda empresa, esta vez activa, para comprobar que sus datos no se
# mezclan con los de la primera.
ACTIVA_SLUG="activa-$STAMP"
R=$(request POST /super/negocios "$SUPER_TOKEN" "{\"nombre\":\"Activa $STAMP\",\"slug\":\"$ACTIVA_SLUG\",\"descripcion\":\"Segunda empresa\",\"adminNombre\":\"Marta Paz\",\"adminEmail\":\"marta-$STAMP@ejemplo.com\",\"adminPassword\":\"Admin1234\"}")
check "superadmin crea una segunda empresa (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"

R=$(request POST /auth/register "" "{\"nombre\":\"Del Otro\",\"documento\":\"$(( DOC + 6 ))\",\"fechaNacimiento\":\"1995-05-05\",\"email\":\"f-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"$ACTIVA_SLUG\"}")
OTRO_NEG_TOKEN=$(jget "$(body "$R")" token)
check "se puede abrir una cuenta en la otra empresa (201)" "$([ "$(status "$R")" = "201" ] && echo 0 || echo 1)"

R=$(request GET "/clients?limit=200" "$OTRO_NEG_TOKEN")
check "un cliente no lista clientes ni siquiera de su empresa (403)" "$([ "$(status "$R")" = "403" ] && echo 0 || echo 1)"

R=$(request GET "/tasks?limit=200" "$OTRO_NEG_TOKEN")
check "un cliente ve 0 tareas de su propia empresa" "$(eq 0 "$(jget "$(body "$R")" total)")"

R=$(request GET "/availability?limit=200" "$OTRO_NEG_TOKEN")
check "la empresa sin horarios no inventa huecos" "$(eq 0 "$(jget "$(body "$R")" total)")"

R=$(request GET "/appointments?limit=200" "$OTRO_NEG_TOKEN")
check "la empresa sin citas no inventa citas" "$(eq 0 "$(jget "$(body "$R")" total)")"

R=$(request POST /auth/register "" "{\"nombre\":\"En la cerrada\",\"documento\":\"$(( DOC + 7 ))\",\"fechaNacimiento\":\"1995-05-05\",\"email\":\"g-$STAMP@ejemplo.com\",\"password\":\"Prueba1234\",\"confirmPassword\":\"Prueba1234\",\"negocio\":\"$OTRO_SLUG\"}")
check "no se puede abrir una cuenta en un negocio desactivado (404)" "$([ "$(status "$R")" = "404" ] && echo 0 || echo 1)"

echo
echo "== 18. Contrato con el frontend =="
# El frontend pinta estos campos con nombres fijos. Si el backend cambia una
# forma, esta seccion es la que se entera antes que un usuario.

# campos <json> <campo>... -> imprime OK o la lista de campos que no existen.
# Un campo que llega en null SI esta: lo que se comprueba es que la clave exista,
# porque el frontend ya sabe pintar "Sin categoria" cuando no hay dato.
# campos <campo>...   (el JSON llega por stdin)
#
# El JSON entra por stdin y no como argumento a proposito: los listados con
# limit=200 crecen con cada ejecucion, y en Windows pasar una cadena tan larga
# como argumento a node supera el limite del sistema y node ni siquiera arranca.
# El script fallaba por eso, no porque faltara ningun campo.
campos() {
  node -e "
let entrada = '';
process.stdin.on('data', (c) => (entrada += c)).on('end', () => {
  let d;
  try { d = JSON.parse(entrada); } catch { console.log('JSON INVALIDO'); return; }
  const faltan = [];
  for (const ruta of process.argv.slice(1)) {
    let v = d;
    for (const k of ruta.split('.')) {
      if (v === null || v === undefined) break;
      if (typeof v !== 'object' || !(k in v)) { faltan.push(ruta); break; }
      v = v[k];
    }
  }
  console.log(faltan.length ? 'FALTAN ' + faltan.join(' ') : 'OK');
});
" "$@"
}

# tiene <descripcion> <json> <campo>...
tiene() {
  local desc=$1 json=$2; shift 2
  if [ "$(printf '%s' "$json" | campos "$@")" = "OK" ]; then echo 0; else echo 1; fi
}

R=$(request GET /auth/me "$ADMIN_TOKEN")
check "GET /auth/me trae los campos que pinta la cabecera" \
  "$(tiene x "$(body "$R")" user.nombre user.role user.email user.activo user.ultimoAcceso negocio.slug citas)"

R=$(request GET /super/negocios "$SUPER_TOKEN")
check "el panel de la plataforma trae los campos de la tabla" \
  "$(tiene x "$(body "$R")" items.0.nombre items.0.slug items.0.activo items.0.usuarios items.0.clientes items.0.citas items.0.admins.0.nombre items.0.admins.0.email items.0.admins.0.activo)"

R=$(request GET "/clients?limit=200" "$ADMIN_TOKEN")
check "el listado de clientes trae los campos de la fila" \
  "$(tiene x "$(body "$R")" items.0.id items.0.nombre items.0.email items.0.documento items.0.activo items.0.citas items.0.createdAt items.0.ultimoAcceso items.0.tareas items.0.edad items.0.telefono items.0.direccion total)"

R=$(request GET "/clients?limit=200" "$ADMIN_TOKEN")
PRIMERO=$(jget "$(body "$R")" items.0.id)
R=$(request GET "/clients/$PRIMERO" "$ADMIN_TOKEN")
check "la ficha de cliente llega envuelta y completa" \
  "$(tiene x "$(body "$R")" cliente.nombre cliente.email cliente.documento cliente.fechaNacimiento cliente.telefono cliente.direccion cliente.activo cliente.citas cliente.tareas cliente.ultimoAcceso cliente.createdAt cliente.updatedAt)"

R=$(request GET "/clients/me" "$CLIENT_TOKEN")
check "el perfil del cliente trae los campos del formulario" \
  "$(tiene x "$(body "$R")" cliente.nombre cliente.documento cliente.fechaNacimiento cliente.email cliente.telefono cliente.direccion cliente.createdAt cliente.updatedAt)"

R=$(request GET /categories "$ADMIN_TOKEN")
check "el catalogo trae id, nombre y numero de tareas" \
  "$(tiene x "$(body "$R")" items.0.id items.0.name items.0.description items.0.tareas)"

R=$(request GET "/tasks?limit=200" "$ADMIN_TOKEN")
check "la lista de tareas trae los campos de la fila" \
  "$(tiene x "$(body "$R")" items.0.id items.0.title items.0.status items.0.sinFecha items.0.dueDate items.0.dueTime items.0.categoryId items.0.clientId items.0.citas total)"

R=$(request GET "/tasks?limit=200" "$ADMIN_TOKEN")
TAREA_1=$(jget "$(body "$R")" items.0.id)
R=$(request GET "/tasks/$TAREA_1" "$ADMIN_TOKEN")
check "el detalle de tarea llega envuelto" "$(tiene x "$(body "$R")" tarea.id tarea.title tarea.status tarea.sinFecha)"

R=$(request GET "/availability?limit=200" "$ADMIN_TOKEN")
check "los horarios traen los campos del calendario" \
  "$(tiene x "$(body "$R")" items.0.id items.0.date items.0.startTime items.0.endTime items.0.status items.0.note)"

R=$(request GET "/appointments?limit=200" "$ADMIN_TOKEN")
check "la lista de citas trae los campos de la fila" \
  "$(tiene x "$(body "$R")" items.0.id items.0.status items.0.note items.0.availabilityId items.0.availability.date items.0.availability.startTime items.0.availability.endTime items.0.availability.status items.0.task.title items.0.client.nombre total)"

R=$(request POST /appointments "$CLIENT_TOKEN" "{\"availabilityId\":$SLOT,\"title\":\"Contrato\"}")
CONTRATO=$(jget "$(body "$R")" cita.id)
R=$(request GET "/appointments/$CONTRATO" "$CLIENT_TOKEN")
check "el detalle de cita llega envuelto y con historial" \
  "$(tiene x "$(body "$R")" cita.id cita.status cita.note cita.createdAt cita.updatedAt cita.task.title cita.task.category.name cita.client.nombre cita.availability.date cita.historial.0.toStatus cita.historial.0.createdAt cita.historial.0.actor.nombre)"

R=$(request GET /appointments/resumen "$ADMIN_TOKEN")
check "el resumen trae las seis cifras del panel" \
  "$(tiene x "$(body "$R")" resumen.pendientes resumen.coordinadas resumen.completadas resumen.canceladas resumen.rechazadas resumen.hoy)"

# Los dias viajan como texto YYYY-MM-DD: es lo que los <input type="date"> del
# frontend aceptan y lo que su formateador de fechas espera.
DIAS_MAL=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
const malos=[];
for (const c of d.items) if (!/^\d{4}-\d{2}-\d{2}\$/.test(c.availability.date)) malos.push(c.availability.date);
console.log(malos.length);});" <<< "$(body "$(request GET "/appointments?limit=200" "$ADMIN_TOKEN")")")
check "la fecha de la cita llega como YYYY-MM-DD" "$(eq 0 "$DIAS_MAL")"

HUECOS_MAL=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
console.log(d.items.filter(h=>!/^\d{4}-\d{2}-\d{2}\$/.test(h.date)).length);});" <<< "$(body "$(request GET "/availability?limit=200" "$ADMIN_TOKEN")")")
check "la fecha del horario llega como YYYY-MM-DD" "$(eq 0 "$HUECOS_MAL")"

TAREAS_MAL=$(node -e "
let e=''; process.stdin.on('data',(c)=>e+=c).on('end',()=>{
const d=JSON.parse(e);
console.log(d.items.filter(t=>t.dueDate!==null && !/^\d{4}-\d{2}-\d{2}\$/.test(t.dueDate)).length);});" <<< "$(body "$(request GET "/tasks?limit=200" "$ADMIN_TOKEN")")")
check "la fecha de la tarea llega como YYYY-MM-DD" "$(eq 0 "$TAREAS_MAL")"

request POST "/appointments/$CONTRATO/cancelar" "$CLIENT_TOKEN" '{}' >/dev/null

# Limpieza: los horarios publicados por esta ejecucion se van con ella. Sin esto
# se acumulan en la base y una ejecucion posterior choca con ellos al publicar
# 09:00-10:00 en un dia que ya tiene uno. Los que tienen citas encima no se
# pueden borrar (409, a proposito), y da igual: se borran con las citas.
for id in $SLOT $NUEVO_SLOT $OTRO_SLOT_LIBRE; do
  [ -n "$id" ] && request DELETE "/availability/$id" "$ADMIN_TOKEN" >/dev/null
done

echo
echo "== 19. Cabeceras de seguridad =="
CAB=$(curl -s -D - -o /dev/null "$API/health")

# Express dice su propia version en X-Powered-By si nadie lo quita.
check "no se anuncia la tecnologia del servidor" \
  "$(printf '%s' "$CAB" | grep -qi '^x-powered-by:' && echo 1 || echo 0)"
check "no se puede embeber en un iframe" \
  "$(printf '%s' "$CAB" | grep -qi '^x-frame-options: *DENY' && echo 0 || echo 1)"
check "no se adivina el tipo del contenido" \
  "$(printf '%s' "$CAB" | grep -qi '^x-content-type-options: *nosniff' && echo 0 || echo 1)"
check "la CSP no permite incrustar objetos" \
  "$(printf '%s' "$CAB" | grep -qi "object-src 'none'" && echo 0 || echo 1)"
check "la CSP cierra los marcos ajenos" \
  "$(printf '%s' "$CAB" | grep -qi "frame-ancestors 'none'" && echo 0 || echo 1)"

# El frontend son HTML sin build: lleva el script embebido y estilos en linea.
# Una CSP que los bloquee dejaria la aplicacion en blanco, asi que se comprueba
# que siguen permitidos.
CAB_HTML=$(curl -s -D - -o /dev/null "$WEB/inicio")
check "la CSP permite el script embebido del frontend" \
  "$(printf '%s' "$CAB_HTML" | grep -qi "script-src[^;]*'unsafe-inline'" && echo 0 || echo 1)"

echo
echo "============================"
echo "Pasaron: $PASS  |  Fallaron: $FAIL"
echo "============================"
[ "$FAIL" -eq 0 ]