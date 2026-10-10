#!/usr/bin/env bash
# Prueba del limitador de peticiones.
#
# No va en prueba.sh porque ahi los limites van apagados: 181 peticiones seguidas
# contra la API real no son un trafico hostil sino una comprobacion. Aqui se
# arranca el servidor con los limites bajos a proposito.
#
# El limite del login y el general se prueban por separado, porque comparten la
# IP: con los dos bajos a la vez, el general se agota primero y el del login no
# llega aVerse.
#
#   bash prueba-limite.sh login
#     RATE_LIMIT_MAX=300 LOGIN_RATE_LIMIT_MAX=4 npm start
#
#   bash prueba-limite.sh general
#     RATE_LIMIT_MAX=5 LOGIN_RATE_LIMIT_MAX=300 npm start
#
# El servidor tiene que estar levantado antes, con esos valores.

API=${API:-http://localhost:3000/api}
MODO=${1:-login}
PASS=0
FAIL=0

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

status() { echo "$1" | tail -1; }
body() { echo "$1" | sed '$d'; }

jget() { node -e "
const d=JSON.parse(process.argv[1]);
const p=process.argv[2].split('.');
let v=d; for (const k of p) v = v?.[k];
console.log(v ?? '');
" "$1" "$2" 2>/dev/null; }

STAMP=$(date +%s)$RANDOM

# login mal, una vez
fallo() {
  curl -s -w '\n%{http_code}' -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"ClaveMala1\"}"
}

if [ "$MODO" = "login" ]; then
  echo "== Limite del login =="

  # El tope se lee de la cabecera que manda el servidor, en vez de suponerlo:
  # asi el script no depende del valor con el que se arranco.
  CAB=$(curl -s -D - -o /dev/null -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"nadie@ejemplo.com","password":"ClaveMala1"}')
  TOPE=$(sed -n 's/^ratelimit-policy: *\([0-9]*\);.*/\1/ip' <<<"$CAB")
  echo "  (tope configurado: ${TOPE:-desconocido})"
  check "el servidor anuncia su tope de peticiones" "$([ -n "$TOPE" ] && echo 0 || echo 1)"

  # Se intenta entrar con una clave que existe pero esta mal, muchas veces
  # seguidas. El limite deberia cortar antes de agotar la cuenta.
  for i in $(seq 1 $(( TOPE + 3 ))); do
    R=$(fallo "admin@ejemplo.com")
    S=$(status "$R")

    if [ "$i" -le "$TOPE" ]; then
      check "intento $i de clave erronea responde 401" "$([ "$S" = "401" ] && echo 0 || echo 1)"
    elif [ "$S" = "429" ]; then
      check "el login se limita justo despues del tope (429 en el $i)" "$(echo 0)"
      check "el error del limite viene en JSON con la forma de la API" \
        "$([ "$(jget "$(body "$R")" error)" ] && echo 0 || echo 1)"
      break
    else
      check "intento $i deberia haberse limitado (429) y fue $S" "$(echo 1)"
    fi
  done

  # Un acceso correcto no gasta cupo: si lo gastara, un usuario normal que
  # entra y sale varias veces acabaria bloqueado por su propio uso.
  R=$(curl -s -w '\n%{http_code}' -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"ana@ejemplo.com","password":"Cliente1234","negocio":"ejemplo"}')
  check "el acceso correcto de otro usuario no se limita (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

  # Y el del que se equivoco tampoco: el fallo anterior no puede haber gastado
  # el cupo del acierto.
  R=$(curl -s -w '\n%{http_code}' -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"ana@ejemplo.com","password":"Cliente1234","negocio":"ejemplo"}')
  check "el mismo usuario puede entrar dos veces seguidas (200)" "$([ "$(status "$R")" = "200" ] && echo 0 || echo 1)"

  # El limite es por email: uno agotado no arrastra a los demas. Por IP sola un
  # atacante con muchos correos no se frenaria nunca.
  R=$(fallo "bruno-$STAMP@ejemplo.com")
  check "otro email no hereda el limite del anterior" "$([ "$(status "$R")" = "401" ] && echo 0 || echo 1)"

  # Un request sin email legible no puede compartir contador con todos los
  # demas: si shareara, bastaria con no mandar email para tener limite
  # infinito... o para tumbar la API, segun de que lado se mire.
  R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' -d '{"password":"ClaveMala1"}')
  check "el login con datos invalidos responde 400, no 429" "$([ "$R" = "400" ] && echo 0 || echo 1)"

else
  echo "== Limite general de la API =="
  LIMITADOS=0
  for i in $(seq 1 9); do
    R=$(curl -s -o /dev/null -w '%{http_code}' "$API/negocios")
    [ "$R" = "429" ] && LIMITADOS=$((LIMITADOS + 1))
  done
  check "el limite general corta las peticiones de mas" "$([ "$LIMITADOS" -gt 0 ] && echo 0 || echo 1)"

  # El error del limite tiene que llevar la forma de la API, no un texto plano:
  # el frontend ya sabe leer { error }.
  R=$(curl -s "$API/negocios")
  check "el limite general responde con { error }" "$([ "$(jget "$R" error)" ] && echo 0 || echo 1)"

  # /api/health esta exenta a proposito: un monitor que consulta la salud cada
  # pocos segundos no puede gastar el cupo de la API ni ser bloqueado.
  R=$(curl -s -o /dev/null -w '%{http_code}' "$API/health")
  check "la salud sigue respondiendo aunque se haya agotado el limite" "$([ "$R" = "200" ] && echo 0 || echo 1)"

  # La documentacion tampoco: es un sitio estatico, no una peticion de negocio.
  R=$(curl -s -o /dev/null -w '%{http_code}' "$API/docs/openapi.json")
  check "la documentacion no consume el limite de la API" "$([ "$R" = "200" ] && echo 0 || echo 1)"
fi

echo
echo "============================"
echo "Pasaron: $PASS  |  Fallaron: $FAIL"
echo "============================"
[ "$FAIL" -eq 0 ]