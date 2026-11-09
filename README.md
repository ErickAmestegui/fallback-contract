# Fallback Contract

Base técnica de una puerta para aprobar o rechazar sustituciones de modelos
según contratos funcionales. El proyecto usa React + TypeScript + Vite en
Cloudflare Workers, con el gateway Otari preparado server-side.

## Misión 07

Esta versión contiene la interfaz inicial y el endpoint local `GET /api/status`.
No ejecuta comparaciones ni muestra resultados inventados. La interfaz marca
claramente que la evaluación real pertenece a una misión posterior.

## Desarrollo

```bash
npm install
npm run dev
```

La clave de Otari no se configura en el frontend. Para una futura ejecución
local del Worker, usar un secreto de Wrangler (`wrangler secret put
OTARI_API_KEY`) o el mecanismo equivalente del entorno; no crear `.env` con
credenciales ni incluirla en Git.

## Checks

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

Gateway configurado server-side: `https://api.otari.ai/api/v1`.
La integración no se presenta como verificada por una completion en esta
misión; solo se validan tipos, errores y respuestas controladas localmente.

## Seguridad

- `OTARI_API_KEY` nunca llega al bundle React.
- No se habilitan herramientas web.
- No se acepta código arbitrario.
- Los errores upstream se redactan antes de devolverlos.
