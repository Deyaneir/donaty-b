import assert from "node:assert/strict";
import test from "node:test";
import Campana from "../src/models/Campana.js";
import Recolector from "../src/models/Recolector.js";
import { actualizarCampana } from "../src/controllers/campana_controller.js";

const campaignId = "672a3c4d5e6f708192a3c4e1";

const makeCampaign = () => ({
  _id: campaignId,
  nombre: "Campaña",
  descripcion: "Descripción",
  ubicacion: "Quito",
  activa: true,
  estado: "activa",
  numeroRecolectores: 0,
  metaDonaciones: 1,
  fechaInicio: new Date("2099-01-01T00:00:00.000Z"),
  fechaFin: new Date("2099-01-02T00:00:00.000Z"),
  horaInicio: "09:00",
  horaFin: "17:00",
  imagenUrl: "https://images.example.test/cover.jpg",
  imagenPublicId: "campaign-cover",
  puntosRecoleccion: [],
  historialAsignacionesRecolectores: [],
  toObject() {
    return {
      _id: this._id,
      nombre: this.nombre,
      descripcion: this.descripcion,
      ubicacion: this.ubicacion,
      activa: this.activa,
      estado: this.estado,
      numeroRecolectores: this.numeroRecolectores,
      metaDonaciones: this.metaDonaciones,
      fechaInicio: this.fechaInicio,
      fechaFin: this.fechaFin,
      horaInicio: this.horaInicio,
      horaFin: this.horaFin,
      imagenUrl: this.imagenUrl,
      imagenPublicId: this.imagenPublicId,
      puntosRecoleccion: this.puntosRecoleccion,
      historialAsignacionesRecolectores: this.historialAsignacionesRecolectores,
    };
  },
  async save() {},
});

const makeResponse = () => ({
  statusCode: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("finalizing or deactivating a campaign preserves its cover image reference", async () => {
  const originalFindById = Campana.findById;
  const originalUpdateMany = Recolector.updateMany;
  const campaign = makeCampaign();
  Campana.findById = async () => campaign;
  Recolector.updateMany = async () => ({ acknowledged: true });

  try {
    for (const body of [{ estado: "finalizada" }, { activa: false }]) {
      const response = makeResponse();
      await actualizarCampana(
        {
          params: { id: campaignId },
          body,
          user: { _id: "672a3c4d5e6f708192a3c4e2" },
        },
        response
      );
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.campana.imagenUrl, "https://images.example.test/cover.jpg");
      assert.equal(response.body.campana.imagenPublicId, "campaign-cover");
    }
  } finally {
    Campana.findById = originalFindById;
    Recolector.updateMany = originalUpdateMany;
  }
});
