import passport from "passport";
import { crearTokenJWT } from "../middlewares/JWT.js";

const googleCallback = (req, res, next) => {
  passport.authenticate("google", { session: false }, (err, user, info) => {
    if (err || !user) {
      const msg = info?.message || "No autorizado";
      return res.status(401).json({ msg });
    }

    const token = crearTokenJWT(user._id, user.rol);
    const payload = {
      token,
      rol: user.rol,
      nombre: user.nombre,
      apellido: user.apellido,
      direccion: user.direccion,
      telefono: user.telefono,
      perfilCompleto: Boolean(
        (user.nombre || "").trim() &&
        (user.apellido || "").trim() &&
        (user.direccion || "").trim() &&
        (user.telefono || "").trim()
      ),
      _id: user._id,
      correo: user.email,
    };

    const redirect = process.env.GOOGLE_SUCCESS_REDIRECT;
    if (redirect) {
      const url = new URL(redirect);
      url.searchParams.set("token", token);
      url.searchParams.set("rol", user.rol);
      return res.redirect(url.toString());
    }

    if (!payload.perfilCompleto) {
      return res.status(200).json({
        ...payload,
        msg: "Completa tu perfil (nombre, apellido, dirección y teléfono)",
      });
    }

    return res.status(200).json(payload);
  })(req, res, next);
};

export { googleCallback };
