import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCampaignHistoryFilter,
  buildCurrentCollectorCampaignFilter,
  buildCollectorDonationFilter,
  buildPendingCollectorDonationFilter,
  isCurrentCollectorCampaignAvailable,
  isCollectorAssignedToCampaign,
  mapCollectorPointAssignments,
} from "../src/utils/collectorHistory.js";
import {
  buildAssignmentHistoryEntries,
  buildCollectorDonationHistoryItem,
} from "../src/controllers/campana_admin_controller.js";

test("campaign history filters combine collector assignment, stored period and name search", () => {
  assert.deepEqual(
    buildCampaignHistoryFilter({
      collectorId: "collector-1",
      period: "2026-B",
      search: "Donaty.*",
    }),
    {
      $and: [
        {
          $or: [
            { "puntosRecoleccion.recolectores": "collector-1" },
            { "puntosRecoleccion.responsableRecolector": "collector-1" },
            { "historialAsignacionesRecolectores.recolector": "collector-1" },
          ],
        },
        { periodoAcademico: "2026-B" },
        { nombre: /Donaty\.\*/i },
      ],
    }
  );
});

test("collector campaign access requires a current point assignment", () => {
  assert.equal(isCollectorAssignedToCampaign({
    puntosRecoleccion: [{ recolectores: ["collector-1"] }],
  }, "collector-1"), true);
  assert.equal(isCollectorAssignedToCampaign({
    historialAsignacionesRecolectores: [{ recolector: "collector-1" }],
  }, "collector-1"), false);
  assert.equal(isCollectorAssignedToCampaign({
    puntosRecoleccion: [{ recolectores: ["collector-2"] }],
  }, "collector-1"), false);
  assert.equal(isCollectorAssignedToCampaign({
    puntosRecoleccion: [{
      activo: false,
      recolectores: ["collector-1"],
    }],
  }, "collector-1"), false);
});

test("admin collector results include the real principal and secondary point assignments", () => {
  const assignments = mapCollectorPointAssignments(
    ["collector-1", "collector-2"],
    [{
      _id: "campaign-1",
      nombre: "Campaña real",
      puntosRecoleccion: [{
        _id: "point-1",
        nombre: "Punto uno",
        responsableRecolector: "collector-1",
        recolectores: ["collector-1", "collector-2"],
      }],
    }]
  );

  assert.deepEqual(assignments.get("collector-1"), [{
    campanaId: "campaign-1",
    campanaNombre: "Campaña real",
    puntoRecoleccionId: "point-1",
    puntoNombre: "Punto uno",
    rol: "principal",
  }]);
  assert.deepEqual(assignments.get("collector-2"), [{
    campanaId: "campaign-1",
    campanaNombre: "Campaña real",
    puntoRecoleccionId: "point-1",
    puntoNombre: "Punto uno",
    rol: "secundario",
  }]);
});

test("collector campaign list requires a current active point assignment", () => {
  const now = new Date("2026-11-08T17:00:00.000Z");
  const startOfDay = new Date("2026-11-08T00:00:00.000Z");
  const startOfNextDay = new Date("2026-11-09T00:00:00.000Z");
  assert.deepEqual(
    buildCurrentCollectorCampaignFilter({
      collectorId: "collector-1",
      period: "2026-B",
      search: "Donaty.*",
      now,
    }),
    {
      $and: [
        {
          activa: true,
          estado: { $nin: ["borrador", "desactivada", "finalizada"] },
          puntosRecoleccion: {
            $elemMatch: {
              activo: { $ne: false },
              estado: { $ne: "inactivo" },
              $or: [
                { recolectores: "collector-1" },
                { responsableRecolector: "collector-1" },
              ],
            },
          },
          $and: [
            {
              $or: [
                { fechaInicio: null },
                { fechaInicio: { $lt: startOfNextDay } },
              ],
            },
            {
              $or: [
                { fechaFin: null },
                { fechaFin: { $gte: startOfDay } },
              ],
            },
          ],
        },
        { periodoAcademico: "2026-B" },
        { nombre: /Donaty\.\*/i },
      ],
    }
  );
});

test("collector campaign availability follows publication and calendar dates", () => {
  const now = new Date("2026-11-08T17:00:00.000Z");
  const activeCampaign = {
    activa: true,
    estado: "activa",
    fechaInicio: new Date("2026-11-01T00:00:00.000Z"),
    fechaFin: new Date("2026-11-30T00:00:00.000Z"),
    horaInicio: "09:00",
    horaFin: "17:00",
  };
  assert.equal(isCurrentCollectorCampaignAvailable(activeCampaign, now), true);
  assert.equal(isCurrentCollectorCampaignAvailable({
    ...activeCampaign,
    estado: "borrador",
  }, now), false);
  assert.equal(isCurrentCollectorCampaignAvailable({
    ...activeCampaign,
    fechaInicio: new Date("2026-11-09T00:00:00.000Z"),
  }, now), false);
  assert.equal(isCurrentCollectorCampaignAvailable({
    ...activeCampaign,
    fechaFin: new Date("2026-11-07T00:00:00.000Z"),
  }, now), false);
  assert.equal(isCurrentCollectorCampaignAvailable({
    ...activeCampaign,
    fechaInicio: new Date("2026-11-08T00:00:00.000Z"),
    fechaFin: new Date("2026-11-08T00:00:00.000Z"),
  }, now), true);
});

test("donation history filters use current assignment for collectors and assignment history for admins", () => {
  assert.deepEqual(
    buildCollectorDonationFilter("campaign-1", "collector-1"),
    { campana: "campaign-1", tipo: "fisica", recolector: "collector-1" }
  );
  assert.deepEqual(
    buildCollectorDonationFilter("campaign-1", "collector-1", {
      includeAssignmentHistory: true,
    }),
    {
      campana: "campaign-1",
      tipo: "fisica",
      $or: [
        { recolector: "collector-1" },
        { "historialRecolectores.recolectorAnterior": "collector-1" },
        { "historialRecolectores.recolectorNuevo": "collector-1" },
      ],
    }
  );
});

test("pending donation filter limits campaign donations to the collector's assigned campaign points", () => {
  assert.deepEqual(
    buildPendingCollectorDonationFilter({
      campaignPoints: [
        { campaignId: "campaign-1", pointIds: ["point-1"] },
        { campaignId: "campaign-2", pointIds: ["point-2", "point-3"] },
      ],
    }),
    {
      tipo: "fisica",
      estado: "pendiente",
      recolector: null,
      $or: [
        { campana: null },
        { campana: "campaign-1", puntoRecoleccionRef: { $in: ["point-1"] } },
        {
          campana: "campaign-2",
          puntoRecoleccionRef: { $in: ["point-2", "point-3"] },
        },
      ],
    }
  );
  assert.deepEqual(
    buildPendingCollectorDonationFilter(),
    {
      tipo: "fisica",
      estado: "pendiente",
      recolector: null,
      $or: [{ campana: null }],
    }
  );
});

test("assignment history preserves collector names and assignment time for admin history", () => {
  const entries = buildAssignmentHistoryEntries({
    _id: "campaign-1",
    nombre: "Campaña real",
    historialAsignacionesRecolectores: [
      {
        _id: "history-1",
        recolector: { _id: "collector-1", nombre: "Ana", apellido: "Pérez" },
        fecha: "2026-02-10T10:00:00.000Z",
        vigente: true,
        motivo: "Asignación inicial",
      },
      {
        _id: "history-2",
        recolector: { _id: "collector-2", nombre: "Luis", apellido: "García" },
        fecha: "2026-02-11T11:00:00.000Z",
        vigente: false,
        motivo: "Retiro",
      },
    ],
  }, new Map([
    ["collector-1", { _id: "collector-1", nombre: "Ana", apellido: "Pérez" }],
    ["collector-2", { _id: "collector-2", nombre: "Luis", apellido: "García" }],
  ]));

  assert.deepEqual(entries.map((entry) => ({
    recolectorId: entry.recolectorId,
    recolectorNombre: entry.recolectorNombre,
    accion: entry.accion,
    fecha: entry.fecha,
  })), [
    {
      recolectorId: "collector-2",
      recolectorNombre: "Luis García",
      accion: "retirada",
      fecha: "2026-02-11T11:00:00.000Z",
    },
    {
      recolectorId: "collector-1",
      recolectorNombre: "Ana Pérez",
      accion: "asignada",
      fecha: "2026-02-10T10:00:00.000Z",
    },
  ]);
});

test("assignment history loads current principal and support assignments without inventing legacy dates", () => {
  const entries = buildAssignmentHistoryEntries({
    _id: "campaign-1",
    nombre: "Campaña real",
    puntosRecoleccion: [{
      _id: "point-1",
      nombre: "Punto uno",
      direccion: "Dirección uno",
      responsableRecolector: "collector-1",
      recolectores: ["collector-1", "collector-2"],
    }],
    historialAsignacionesRecolectores: [],
  }, new Map([
    ["collector-1", { _id: "collector-1", nombre: "Ana", apellido: "Pérez" }],
    ["collector-2", { _id: "collector-2", nombre: "Luis", apellido: "García" }],
  ]));

  assert.deepEqual(entries.map((entry) => ({
    recolectorNombre: entry.recolectorNombre,
    puntoNombre: entry.puntoNombre,
    rolPunto: entry.rolPunto,
    fecha: entry.fecha,
    fechaRealDisponible: entry.fechaRealDisponible,
    fuente: entry.fuente,
  })), [
    {
      recolectorNombre: "Ana Pérez",
      puntoNombre: "Punto uno",
      rolPunto: "principal",
      fecha: null,
      fechaRealDisponible: false,
      fuente: "asignacion_vigente",
    },
    {
      recolectorNombre: "Luis García",
      puntoNombre: "Punto uno",
      rolPunto: "secundario",
      fecha: null,
      fechaRealDisponible: false,
      fuente: "asignacion_vigente",
    },
  ]);
});

test("collector donation history returns donor, category, date, collector and assigned point", () => {
  const campaign = {
    _id: "campaign-1",
    nombre: "Campaña real",
    periodoAcademico: "2026-B",
    puntosRecoleccion: [{
      _id: "point-1",
      nombre: "Punto uno",
      direccion: "Dirección uno",
      responsableRecolector: "collector-1",
      recolectores: ["collector-1", "collector-2"],
    }],
  };
  const donations = [
    {
      _id: "donation-1",
      donante: { nombre: "Ana", apellido: "Pérez" },
      recolector: { _id: "collector-1", nombre: "Luis", apellido: "García" },
      puntoRecoleccionRef: "point-1",
      categoria: "",
      categoriaRef: { _id: "category-1", nombre: "Categoría dinámica" },
      nombreBien: "Alimento",
      fechaRegistro: "2026-10-10T09:00:00.000Z",
    },
    {
      _id: "donation-2",
      donanteExterno: { nombre: "Eva", apellido: "López" },
      recolector: { _id: "collector-2", nombre: "Mario", apellido: "Vega" },
      puntoRecoleccionRef: "point-1",
      categoria: "Ropa",
      nombreBien: "Abrigo",
      createdAt: "2026-10-11T09:00:00.000Z",
    },
  ];

  const items = donations.map((donation) =>
    buildCollectorDonationHistoryItem(donation, campaign)
  );

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => ({
    id: item.id,
    donante: item.donante,
    categoria: item.categoria,
    nombreDonacion: item.nombreDonacion,
    fechaDonacion: item.fechaDonacion,
    recolector: item.recolector,
    puntoRecoleccion: item.puntoRecoleccion,
    rolPunto: item.rolPunto,
  })), [
    {
      id: "donation-1",
      donante: { nombre: "Ana", apellido: "Pérez" },
      categoria: "Categoría dinámica",
      nombreDonacion: "Alimento",
      fechaDonacion: "2026-10-10T09:00:00.000Z",
      recolector: { _id: "collector-1", nombre: "Luis", apellido: "García" },
      puntoRecoleccion: {
        _id: "point-1",
        id: "point-1",
        nombre: "Punto uno",
        direccion: "Dirección uno",
      },
      rolPunto: "principal",
    },
    {
      id: "donation-2",
      donante: { nombre: "Eva", apellido: "López" },
      categoria: "Ropa",
      nombreDonacion: "Abrigo",
      fechaDonacion: "2026-10-11T09:00:00.000Z",
      recolector: { _id: "collector-2", nombre: "Mario", apellido: "Vega" },
      puntoRecoleccion: {
        _id: "point-1",
        id: "point-1",
        nombre: "Punto uno",
        direccion: "Dirección uno",
      },
      rolPunto: "secundario",
    },
  ]);
});
