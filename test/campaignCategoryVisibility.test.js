import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Categoria from "../src/models/Categoria.js";
import Campana from "../src/models/Campana.js";
import Donacion from "../src/models/Donacion.js";
import {
  listarCategoriasDeCampana,
} from "../src/controllers/categoria_controller.js";
import { listarCampanas } from "../src/controllers/campana_controller.js";

const campaignId = "672a3c4d5e6f708192a3b4c5";
const categoryId = "672a3c4d5e6f708192a3b4c6";

const invokeCampaignCategoryList = async (
  assignedCategoryIds,
  { role = "donante", assignedCollectorIds = [] } = {}
) => {
  const originalFindById = Campana.findById;
  const originalCategoryFind = Categoria.find;
  const originalDonacionExists = Donacion.exists;
  let receivedFilter;

  Donacion.exists = async () => false;
  Campana.findById = async () => ({
    _id: campaignId,
    activa: true,
    fechaInicio: new Date("2000-01-01T00:00:00.000Z"),
    fechaFin: new Date("2099-12-31T00:00:00.000Z"),
    horaInicio: "00:00",
    horaFin: "23:59",
    categoriasPermitidas: assignedCategoryIds,
    puntosRecoleccion: assignedCollectorIds.length
      ? [{
          _id: "672a3c4d5e6f708192a3c4c6",
          activo: true,
          recolectores: assignedCollectorIds,
        }]
      : [],
  });
  Categoria.find = (filter) => {
    receivedFilter = filter;
    return {
      sort() {
        return this;
      },
      lean: async () => [{
          _id: categoryId,
          nombre: "Ropa",
          activa: true,
          subcategorias: [],
        }],
    };
  };

  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await listarCategoriasDeCampana(
      {
        params: { campanaId: campaignId },
        user: {
          _id: role === "recolector"
            ? "collector-1"
            : "672a3c4d5e6f708192a3c4c7",
          rol: role,
        },
      },
      response,
    );
    return { filter: receivedFilter, response };
  } finally {
    Campana.findById = originalFindById;
    Categoria.find = originalCategoryFind;
    Donacion.exists = originalDonacionExists;
  }
};

describe("campaign category visibility", { concurrency: false }, () => {
test("campaign category listing returns active categories assigned by ID", async () => {
  const { filter, response } = await invokeCampaignCategoryList([categoryId]);

  assert.deepEqual(filter, {
    activa: true,
    _id: { $in: [categoryId] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.categorias[0].nombre, "Ropa");
});

test("collector campaign categories require a current assigned active point", async () => {
  const assigned = await invokeCampaignCategoryList([categoryId], {
    role: "recolector",
    assignedCollectorIds: ["collector-1"],
  });
  assert.equal(assigned.response.statusCode, 200);

  const unassigned = await invokeCampaignCategoryList([categoryId], {
    role: "recolector",
    assignedCollectorIds: ["collector-2"],
  });
  assert.equal(unassigned.response.statusCode, 403);
});

test("campaign category listing falls back to categories created in the campaign", async () => {
  const { filter, response } = await invokeCampaignCategoryList([]);

  assert.deepEqual(filter, {
    activa: true,
    campana: campaignId,
  });
  assert.equal(response.statusCode, 200);
});

test("campaign listing serializes names for assigned active categories", async () => {
  const originalFind = Campana.find;
  let populateOptions;
  const campaign = {
    activa: true,
    estado: "activa",
    fechaInicio: new Date("2000-01-01T00:00:00.000Z"),
    fechaFin: new Date("2099-12-31T00:00:00.000Z"),
    horaInicio: "00:00",
    horaFin: "23:59",
    toObject: () => ({
      _id: campaignId,
      activa: true,
      categoriasPermitidas: [{ _id: categoryId, nombre: "Ropa" }],
      puntosRecoleccion: [],
    }),
  };
  Campana.find = () => ({
    populate(options) {
      populateOptions = options;
      return this;
    },
    sort: async () => [campaign],
  });

  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await listarCampanas(
      { user: { rol: "donante" }, query: {} },
      response,
    );
    assert.deepEqual(populateOptions, {
      path: "categoriasPermitidas",
      match: {},
      select: "nombre activa",
    });
    assert.deepEqual(
      response.body.campanas[0].categoriasPermitidasNombres,
      ["Ropa"],
    );
  } finally {
    Campana.find = originalFind;
  }
});
});
