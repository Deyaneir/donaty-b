// Página puente: abre la app Donaty-EC desde el enlace del correo.
// No confirma ni gasta ningún token: eso lo hace la app con el backend.

const TOKEN_REGEX = /^[a-f0-9]{32}$/i;

const APP_SCHEME = process.env.APP_SCHEME || "donaty";
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || "com.example.donaty_movil";

const frontUrl = () =>
  (
    process.env.URL_FRONTEND ||
    process.env.CLIENT_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");

const backendUrl = (req) =>
  (process.env.URL_BACKEND || `${req.protocol}://${req.get("host")}`).replace(
    /\/$/,
    ""
  );

const ACCIONES = {
  confirmar: {
    titulo: "Confirma tu correo",
    texto:
      "Toca el botón para abrir la app Donaty-EC y terminar de confirmar tu correo.",
    boton: "Confirmar mi correo en la app",
    web: (token) => `${frontUrl()}/confirm/${token}`,
  },
  recuperar: {
    titulo: "Restablece tu contraseña",
    texto:
      "Toca el botón para abrir la app Donaty-EC y crear tu nueva contraseña.",
    boton: "Restablecer mi contraseña en la app",
    web: (token) => `${frontUrl()}/reset/${token}`,
  },
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderPage = ({ titulo, cuerpo, script = "" }) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(titulo)} – DONATY-EC</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f8; margin: 0; padding: 24px; color: #1f1f2e; }
    .card { max-width: 420px; margin: 40px auto; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 4px 16px rgba(0,0,0,.08); text-align: center; }
    h1 { font-size: 22px; margin-top: 0; }
    p { line-height: 1.5; }
    .btn { display: block; margin: 20px 0 12px; padding: 14px 20px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; }
    .aviso { background: #fff7e6; border: 1px solid #ffd591; border-radius: 10px; padding: 12px; font-size: 14px; }
    .small { font-size: 13px; color: #555; }
    a { color: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    ${cuerpo}
  </div>
  ${script}
</body>
</html>`;

const appLinkPage = (accion) => (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'",
  });

  const config = ACCIONES[accion];
  const { token } = req.params;

  if (!config || !TOKEN_REGEX.test(token || "")) {
    return res.status(400).send(
      renderPage({
        titulo: "Enlace no válido",
        cuerpo: `
          <h1>Enlace no válido</h1>
          <p>Este enlace no es válido. Solicita uno nuevo desde la app.</p>
        `,
      })
    );
  }

  const sinApp = req.query.sinapp === "1";
  const schemeUrl = `${APP_SCHEME}://${accion}?token=${token}`;
  const fallbackUrl = `${backendUrl(req)}/app/${accion}/${token}?sinapp=1`;
  const intentUrl =
    `intent://${accion}?token=${token}#Intent;scheme=${APP_SCHEME};` +
    `package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

  const avisoSinApp = sinApp
    ? `<p class="aviso">No pudimos abrir la app Donaty-EC. Verifica que esté instalada en este celular e intenta de nuevo desde el correo.</p>`
    : "";

  const cuerpo = `
    <h1>${escapeHtml(config.titulo)}</h1>
    <p>${escapeHtml(config.texto)}</p>
    ${avisoSinApp}
    <a class="btn" href="${escapeHtml(intentUrl)}">${escapeHtml(config.boton)}</a>
    <p class="small">¿El botón no funciona? <a href="${escapeHtml(schemeUrl)}">Intenta con este enlace</a>.</p>
    <p class="small">¿No tienes la app? <a href="${escapeHtml(config.web(token))}">Continúa en la web</a>.</p>
    <p class="small">Si estás en una computadora, abre este correo desde tu celular.</p>
  `;

  // Intento automático de abrir la app (Android). El botón siempre queda como alternativa.
  const script = sinApp
    ? ""
    : `<script>
        (function () {
          if (!/Android/i.test(navigator.userAgent)) return;
          setTimeout(function () {
            window.location.href = ${JSON.stringify(intentUrl)};
          }, 300);
        })();
      </script>`;

  return res
    .status(200)
    .send(renderPage({ titulo: config.titulo, cuerpo, script }));
};

export { appLinkPage };