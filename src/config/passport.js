import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import crypto from "crypto";
import Donante from "../models/Donante.js";
import Admin from "../models/Admin.js";
import Recolector from "../models/Recolector.js";

const buildCallbackUrl = () => {
  const base =
    process.env.API_BASE_URL ||
    process.env.URL_BACKEND ||
    "http://localhost:4000";
  return `${base.replace(/\/$/, "")}/api/donante/google/callback`;
};

const callbackURL = process.env.GOOGLE_CALLBACK_URL || buildCallbackUrl();

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) {
            return done(null, false, { message: "Google no devolvió email" });
          }

          const [adminExistente, recolectorExistente] = await Promise.all([
            Admin.findOne({ email }),
            Recolector.findOne({ email }),
          ]);
          if (adminExistente || recolectorExistente) {
            return done(null, false, {
              message: "El email ya está registrado en otro rol",
            });
          }

          let user = await Donante.findOne({
            $or: [{ googleId: profile.id }, { email }],
          });

          if (!user) {
            const randomPassword = crypto.randomBytes(16).toString("hex");
            user = new Donante({
              nombre: profile.name?.givenName || "Usuario",
              apellido: profile.name?.familyName || "Google",
              direccion: "",
              telefono: "",
              email,
              password: randomPassword,
              rol: "donante",
              perfilCompleto: false,
              status: true,
              confirmEmail: true,
              googleId: profile.id,
            });
            user.password = await user.encryptPassword(randomPassword);
            await user.save();
          } else {
            let changed = false;
            if (!user.googleId) {
              user.googleId = profile.id;
              changed = true;
            }
            if (!user.confirmEmail) {
              user.confirmEmail = true;
              changed = true;
            }
            const perfilCompleto = Boolean(
              (user.nombre || "").trim() &&
              (user.apellido || "").trim() &&
              (user.direccion || "").trim() &&
              (user.telefono || "").trim()
            );
            if (user.perfilCompleto !== perfilCompleto) {
              user.perfilCompleto = perfilCompleto;
              changed = true;
            }
            if (changed) await user.save();
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn("Google OAuth no configurado: falta GOOGLE_CLIENT_ID/SECRET");
}

export default passport;
