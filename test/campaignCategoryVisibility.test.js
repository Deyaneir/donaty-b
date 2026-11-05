import assert from "node:assert/strict";
import test from "node:test";
import Categoria from "../src/models/Categoria.js";
import Campana from "../src/models/Campana.js";
import {
  listarCategoriasDeCampana,
} from "../src/controllers/categoria_controller.js";
import { listarCampanas } from "../src/controllers/campana_controller.js";

const campaignId = "672a3c4d5e6f708192a3b4c5";
const categoryId = "672a3c4d5e6f708192a3b4c6";

const invokeCampaignCategoryList = async (assignedCategoryIds) => {
  const originalFindById = Campana.findById;
  const originalCategoryFind = Categoria.find;
  let receivedFilter;

  Campana.findById = async () => ({
    _id: campaignId,
    activa: true,
    categoriasPermitidas: assignedCategoryIds,
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
      { params: { campanaId: campaignId }, user: { rol: "donante" } },
      response,
    );
    return { filter: receivedFilter, response };
  } finally {
    Campana.findById = originalFindById;
    Categoria.find = originalCategoryFind;
  }
};

test("campaign category listing returns active categories assigned by ID", async () => {
  const { filter, response } = await invokeCampaignCategoryList([categoryId]);

  assert.deepEqual(filter, {
    activa: true,
    _id: { $in: [categoryId] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.categorias[0].nombre, "Ropa");
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
      match: { activa: true },
      select: "nombre",
    });
    assert.deepEqual(
      response.body.campanas[0].categoriasPermitidasNombres,
      ["Ropa"],
    );
  } finally {
    Campana.find = originalFind;
  }
});
