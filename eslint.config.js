import js from '@eslint/js';
import globals from 'globals';

/**
 * ESLint plano (v9).
 *
 * Se queda en lo que atrapa bugs reales y no en lo que|datum el estilo: el
 * formateo lo lleva Prettier. Poner las dos reglas peleandose por los mismos
 * espacios produce conflictos endless que se resuelven desactivando una de las dos.
 *
 * El proyecto no usa TypeScript ni JSX, asi que no hay que configurar los parsers
 * de esos: `sourceType: module` y el parser de espree bastan.
 */
export default [
  {
    ignores: ['node_modules/**', 'views/js/**', 'coverage/**'],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        // El frontend se sirve desde el mismo Express pero es codigo de navegador:
        // esta regla solo aplica a lo que hay en `src/` y `config/`, pero dejarlo
        // declarado evita el error en cualquier archivo que se mueva.
        ...globals.browser,
      },
    },

    rules: {
      /* --- Lo que atrapa bugs de verdad --- */

      //olvidar el await de una promesa es el bug mas comun de un backend con async.
      'no-return-await': 'error',

      // Comparar con `==` deja fuera las conversiones sutiles. Se usa `===` siempre.
      eqeqeq: ['error', 'smart'],

      // Un `catch (e) {}` vacio se traga el error. Al menos tiene que comentar.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Declarar `var` es codigo de 2010.
      'no-var': 'error',

      // Variables de un solo uso declaradas como tales: una variable que SOLO se
      // usa para reasignarse no aporta nada.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],

      /* --- Correcciones que se pagan solas --- */

      // La coma suelta y la coma final incongruente confunden al revisar.
      //
      // `imports` y `exports` van en `always-multiline` porque es lo que hace
      // Prettier con `trailingComma: "es5"` en `.prettierrc.json`. Antes ponian
      // `never` aqui, y las dos herramientas acababan peleandose por la misma
      // coma: `npm run format` la ponia en los imports multilinea y el lint
      // siguiente la senalaba. Como `npm run check` es `lint && format:check && test`,
      // no podia pasar nunca y acababa sin ejecutarse, que es lo peor que puede
      // pasarle a un comando de verificacion.
      //
      // El formateo es de Prettier. El lint se limita a lo que Prettier no toca.
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'always-multiline',
          exports: 'always-multiline',
          functions: 'never',
        },
      ],

      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
      'no-console': 'off',
    },
  },

  {
    files: ['prisma/**/*.js', 'tests/**/*.js'],
    rules: {
      // La semilla y los tests escriben en consola a proposito: es su salida.
      'no-console': 'off',
    },
  },

  {
    /*
     * El BOM (U+FEFF) al principio de una cadena es una excepcion legitima.
     *
     * El exportador de CSV antepone `\uFEFF` a proposito: es lo unico que hace que
     * Excel abra los acentos bien, y quitarlo devuelve el primer "me sale Mart?nez"
     * de quien exporta. La regla `no-irregular-whitespace` lo marca como error,
     * asi que aqui se permite SOLO ese caracter y solo en archivos de exportacion:
     * cualquier otro espacio raro (espacios duros, saltos raros) sigue senalado.
     */
    files: ['src/api/report/**/*.js'],
    rules: {
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipTemplates: true, skipRegExps: true },
      ],
    },
  },
];
