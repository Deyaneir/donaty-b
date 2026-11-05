import test from "node:test";
import assert from "node:assert/strict";
import { normalizePickupPoints } from "../src/controllers/campana_controller.js";
import {
  buildPickupPointsResponse,
  serializeCollectorAssignments,
  serializePickupPoints,
  serializeTracePickupPoint,
} from "../src/utils/pickupPoints.js";

const mobilePayload = {
  campanaId: "507f1f77bcf86cd799439011",
  edificioId: 16,
  nombreEdificio: "Facultad de Ingeniería",
  edificio: "16 - Facultad de Ingeniería",
  piso: "2",
  aula: "203",
  latitud: -0.210145,
  longitud: -78.488712,
  descripcion: "Entrada junto a biblioteca",
  direccion: "Campus principal",
  referenciasLugar: "Puerta lateral",
  telefonoContacto: "022222222",
  estado: "activo",
};

test("normalizes the mobile collection-point payload for persistence", () => {
  const [point] = normalizePickupPoints([mobilePayload]);

  assert.equal(point.edificioId, 16);
  assert.equal(point.nombreEdificio, "Facultad de Ingeniería");
  assert.equal(point.edificio, "16 - Facultad de Ingeniería");
  assert.equal(point.piso, "2");
  assert.equal(point.aula, "203");
  assert.equal(point.estado, "activo");
  assert.equal(point.activo, true);
  assert.equal(point.nombre, "Facultad de Ingeniería");
  assert.equal(point.latitud, -0.210145);
  assert.equal(point.longitud, -78.488712);
  assert.equal(point.descripcion, "Entrada junto a biblioteca");
  assert.equal(point.direccion, "Campus principal");
  assert.equal(point.referenciasLugar, "Puerta lateral");
  assert.equal(point.telefonoContacto, "022222222");
  assert.ok(point.claveUnica);
});

test("accepts mobile building, floor and classroom fields without explicit name", () => {
  const [point] = normalizePickupPoints([{
    edificio: "Edificio de Ciencias",
    piso: "2",
    aula: "203",
  }]);
  assert.equal(point.nombre, "Edificio de Ciencias");
  assert.equal(point.latitud, null);
  assert.equal(point.longitud, null);
});

test("requires building, floor and classroom without requiring weekly schedules", () => {
  assert.throws(
    () => normalizePickupPoints([{
      ...mobilePayload,
      piso: "",
    }], [], true),
    { statusCode: 400 },
    "This baseline payload omits building, floor and classroom"
  );
  const [point] = normalizePickupPoints([{
    ...mobilePayload,
    edificio: "Edificio de prueba",
    piso: "2",
    aula: "203",
  }], [], true);
  assert.deepEqual(point.horariosAtencion, []);
});

test("persists multiple non-overlapping weekly point hours", () => {
  const [point] = normalizePickupPoints([{
    ...mobilePayload,
    horariosAtencion: [
      { diaSemana: 1, horaInicio: "07:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "13:00", horaFin: "19:00" },
      { diaSemana: 5, horaInicio: "08:00", horaFin: "17:00" },
    ],
  }]);

  assert.deepEqual(point.horariosAtencion, [
    { diaSemana: 1, horaInicio: "07:00", horaFin: "12:00" },
    { diaSemana: 1, horaInicio: "13:00", horaFin: "19:00" },
    { diaSemana: 5, horaInicio: "08:00", horaFin: "17:00" },
  ]);
});

test("rejects invalid and overlapping weekly point hours", () => {
  assert.throws(() => normalizePickupPoints([{
    ...mobilePayload,
    horariosAtencion: [
      { diaSemana: 1, horaInicio: "07:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "11:00", horaFin: "19:00" },
    ],
  }]), { statusCode: 400 });
  assert.throws(() => normalizePickupPoints([{
    ...mobilePayload,
    horariosAtencion: [
      { diaSemana: 8, horaInicio: "07:00", horaFin: "12:00" },
    ],
  }]), { statusCode: 400 });
});

test("accepts standard latitude and longitude aliases without fabricating coordinates", () => {
  const [point] = normalizePickupPoints([{
    nombre: "Entrada norte",
    latitude: "-0.21",
    longitude: "-78.48",
    description: "Acceso principal",
    address: "Calle 1",
    referencias: "Junto al parque",
  }]);

  assert.equal(point.latitud, -0.21);
  assert.equal(point.longitud, -78.48);
  assert.equal(point.descripcion, "Acceso principal");
  assert.equal(point.direccion, "Calle 1");
  assert.equal(point.referenciasLugar, "Junto al parque");
});

test("preserves point data when editing with only building, floor and classroom", () => {
  const [existing] = normalizePickupPoints([mobilePayload]);
  const [updated] = normalizePickupPoints(
    [{ _id: existing._id, edificio: "16 - Facultad de Ingeniería", piso: "3", aula: "305" }],
    [existing]
  );

  assert.equal(updated.edificioId, 16);
  assert.equal(updated.nombreEdificio, "Facultad de Ingeniería");
  assert.equal(updated.piso, "3");
  assert.equal(updated.aula, "305");
  assert.equal(updated.estado, "activo");
});

test("rejects invalid building identifiers and point states", () => {
  assert.throws(
    () => normalizePickupPoints([{ ...mobilePayload, edificioId: 0 }]),
    { statusCode: 400 }
  );
  assert.throws(
    () => normalizePickupPoints([{ ...mobilePayload, estado: "eliminado" }]),
    { statusCode: 400 }
  );
});

test("serializes active mobile points with IDs, campaign and location fields", () => {
  const [point] = normalizePickupPoints([{
    nombre: "Entrada norte",
    latitud: -0.21,
    longitud: -78.48,
    telefonoContacto: "022222222",
  }]);
  const [responsePoint] = serializePickupPoints([point], "campaign-id", {
    includeAssignments: false,
    activeOnly: true,
  });

  assert.equal(responsePoint.id, String(point._id));
  assert.equal(responsePoint._id, String(point._id));
  assert.equal(responsePoint.campanaId, "campaign-id");
  assert.equal(responsePoint.estado, "activo");
  assert.equal(responsePoint.latitude, -0.21);
  assert.equal(responsePoint.longitude, -78.48);
  assert.equal(responsePoint.telefonoContacto, "022222222");
  assert.equal(responsePoint.descripcion, "");
  assert.equal(responsePoint.direccion, "");
  assert.equal(responsePoint.referenciasLugar, "");
  assert.equal("recolectores" in responsePoint, false);
});

test("does not return inactive points in the mobile active-points response", () => {
  const points = normalizePickupPoints([
    { nombre: "Punto activo" },
    { nombre: "Punto inactivo", estado: "inactivo" },
  ]);
  const response = serializePickupPoints(points, "campaign-id", {
    includeAssignments: false,
    activeOnly: true,
  });

  assert.equal(response.length, 1);
  assert.equal(response[0].nombre, "Punto activo");
});

test("builds the endpoint response envelope and returns zero for no points", () => {
  assert.deepEqual(
    buildPickupPointsResponse({ _id: "campaign-id", puntosRecoleccion: [] }, {
      includeAssignments: false,
      activeOnly: true,
    }),
    {
      campanaId: "campaign-id",
      totalPuntos: 0,
      puntos: [],
    }
  );
});

test("serializes only active points assigned to the collector", () => {
  const activePoint = {
    _id: "507f1f77bcf86cd799439011",
    nombre: "Facultad de Ingeniería",
    edificioId: 16,
    nombreEdificio: "Facultad de Ingeniería",
    edificio: "16 - Facultad de Ingeniería",
    piso: "2",
    aula: "203",
    latitud: -0.210145,
    longitud: -78.488712,
    horariosAtencion: [],
    direccion: "Campus principal",
    referenciasLugar: "Puerta lateral",
    estado: "activo",
    activo: true,
    responsableRecolector: "507f1f77bcf86cd799439021",
    recolectores: ["507f1f77bcf86cd799439021"],
  };
  const otherCollectorPoint = {
    ...activePoint,
    _id: "507f1f77bcf86cd799439012",
    responsableRecolector: "507f1f77bcf86cd799439022",
    recolectores: ["507f1f77bcf86cd799439022"],
  };
  const inactivePoint = {
    ...activePoint,
    _id: "507f1f77bcf86cd799439013",
    estado: "inactivo",
    activo: false,
  };
  const assignments = serializeCollectorAssignments([{
    _id: "507f1f77bcf86cd799439031",
    nombre: "Campaña de prueba",
    puntosRecoleccion: [activePoint, otherCollectorPoint, inactivePoint],
  }], "507f1f77bcf86cd799439021");

  assert.deepEqual(assignments, [{
    campanaId: "507f1f77bcf86cd799439031",
    campanaNombre: "Campaña de prueba",
    puntoRecoleccionId: "507f1f77bcf86cd799439011",
    puntoNombre: "Facultad de Ingeniería",
    edificioId: 16,
    nombreEdificio: "Facultad de Ingeniería",
    edificio: "16 - Facultad de Ingeniería",
    piso: "2",
    aula: "203",
    latitud: -0.210145,
    longitud: -78.488712,
    horariosAtencion: [],
    direccion: "Campus principal",
    referenciasLugar: "Puerta lateral",
  }]);
});

test("serializes trace point details and coordinates without adding missing data", () => {
  const point = serializeTracePickupPoint({
    _id: "507f1f77bcf86cd799439011",
    nombre: "Entrada norte",
    edificioId: 16,
    nombreEdificio: "Facultad de Ingeniería",
    edificio: "16 - Facultad de Ingeniería",
    piso: "2",
    aula: "203",
    latitud: -0.210145,
    longitud: -78.488712,
  });

  assert.deepEqual(point, {
    _id: "507f1f77bcf86cd799439011",
    nombre: "Entrada norte",
    edificioId: 16,
    nombreEdificio: "Facultad de Ingeniería",
    edificio: "16 - Facultad de Ingeniería",
    piso: "2",
    aula: "203",
    latitud: -0.210145,
    longitud: -78.488712,
    direccion: "",
    referenciasLugar: "",
  });
  assert.equal(serializeTracePickupPoint(null), null);
});
