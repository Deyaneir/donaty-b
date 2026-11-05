import test from "node:test";
import assert from "node:assert/strict";
import { validateMobileRegistrationProfile } from "../src/utils/mobileRegistrationValidation.js";

const validProfile = {
  ciudad: "Quito",
  sector: "La Floresta",
  fechaNacimiento: "2000-02-29",
  universidad: "Escuela Politécnica Nacional",
  carrera: "Ingeniería",
  semestre: "5",
  perteneceAsociacion: false,
  aceptaTerminos: true,
  aceptaPrivacidad: true,
};

test("validates and normalizes all mobile registration profile fields", () => {
  const result = validateMobileRegistrationProfile(validProfile);

  assert.equal(result.error, undefined);
  assert.equal(result.profile.ciudad, "Quito");
  assert.equal(result.profile.perteneceAsociacion, false);
  assert.equal(result.profile.asociacionEstudiantil, "");
  assert.equal(result.profile.aceptaTerminos, true);
  assert.ok(result.profile.fechaNacimiento instanceof Date);
});

test("rejects incomplete profile, invalid birth date, missing consent, and incomplete affiliation", () => {
  assert.match(
    validateMobileRegistrationProfile({ ...validProfile, sector: " " }).error,
    /datos personales/
  );
  assert.match(
    validateMobileRegistrationProfile({
      ...validProfile,
      fechaNacimiento: "2023-02-29",
    }).error,
    /fecha de nacimiento/
  );
  assert.match(
    validateMobileRegistrationProfile({
      ...validProfile,
      aceptaPrivacidad: false,
    }).error,
    /aceptar/
  );
  assert.match(
    validateMobileRegistrationProfile({
      ...validProfile,
      perteneceAsociacion: true,
      asociacionEstudiantil: "Asociación",
    }).error,
    /cargo/
  );
});
