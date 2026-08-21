# Guía de contribución

Gracias por ayudar a construir PawFound.

## Antes de empezar

- Revisa los Issues abiertos y evita duplicar trabajo.
- Explica el problema y la propuesta antes de realizar cambios importantes.
- Mantén cada contribución pequeña, enfocada y verificable.

## Flujo de trabajo

```text
main
└── develop
    └── feature/<issue>-<nombre-corto>
```

- `main` es la rama de producción: solo recibe merges de `develop` al completarse todas
  las Issues de una fase (hito).
- `develop` integra el trabajo en curso.
- Cada Issue se resuelve en su propia rama `feature/<issue>-<nombre-corto>` (por ejemplo
  `feature/7-investigacion-duenos-mascotas`), creada desde `develop`.

Pasos:

1. Abre o toma un Issue con contexto, alcance y criterio de aceptación.
2. Crea tu rama `feature/<issue>-<nombre-corto>` desde `develop`.
3. Incluye pruebas o evidencia de validación cuando aplique.
4. Abre un pull request hacia `develop` usando la plantilla, enlazando la Issue que cierra.
5. Atiende la revisión antes de fusionar cambios.
6. Al completarse todas las Issues de una fase (hito) en `develop`, se abre un pull
   request de `develop` a `main`.

## Estándares

- Escribe documentación y mensajes claros en español o inglés.
- No publiques datos personales, ubicaciones precisas ni información sensible de mascotas o personas.
- Conserva la accesibilidad, privacidad y seguridad como requisitos de producto.
- Sigue el [Código de conducta](CODE_OF_CONDUCT.md).

## Propuestas grandes

Para cambios de alcance, arquitectura o políticas, abre primero un Issue de propuesta. Debe incluir la motivación, alternativas y riesgos.
