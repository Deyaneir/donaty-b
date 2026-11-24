import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Donante from "../models/Donante.js";
import EntregaCampana from "../models/EntregaCampana.js";
import Recolector from "../models/Recolector.js";
import { urlPublica } from "../utils/publicUrl.js";
import { donationStatusLabel } from "../utils/donationStatus.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DONATION_STATES = [
  "pendiente",
  "asignada",
  "pendiente_recoleccion",
  "recolectada",
  "clasificada",
  "en_entrega",
  "entregada",
  "cancelada",
  "devolucion",
  "devuelta",
];
const COLLECTED_STATES = ["recolectada", "clasificada", "en_entrega", "entregada"];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const objectId = (value) => new mongoose.Types.ObjectId(value);

class HistoryRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const badRequest = (message) => {
  throw new HistoryRequestError(400, message);
};

const parsePagination = (query, sortFields, defaultSort) => {
  const parseInteger = (value, fallback, field) => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      badRequest(`El parámetro ${field} debe ser un entero positivo`);
    }
    return parsed;
  };
  const page = parseInteger(query.page, DEFAULT_PAGE, "page");
  const limit = parseInteger(query.limit, DEFAULT_LIMIT, "limit");
  if (limit > MAX_LIMIT) {
    badRequest(`El límite máximo por página es ${MAX_LIMIT}`);
  }
  const sortBy = String(query.sortBy || defaultSort);
  if (!sortFields.includes(sortBy)) {
    badRequest(`El campo de ordenamiento debe ser uno de: ${sortFields.join(", ")}`);
  }
  const order = String(query.order || "desc").toLowerCase();
  if (!["asc", "desc"].includes(order)) {
    badRequest("El orden debe ser asc o desc");
  }
  return { page, limit, skip: (page - 1) * limit, sort: { [sortBy]: order === "asc" ? 1 : -1 } };
};

const parseObjectId = (value, label) => {
  if (!mongoose.isValidObjectId(value)) {
    badRequest(`El identificador de ${label} no es válido`);
  }
  return objectId(String(value));
};

const parseTextFilter = (value, label, maxLength = 100) => {
  if (value === undefined) return "";
  const result = String(value).trim();
  if (result.length > maxLength) badRequest(`${label} no puede superar ${maxLength} caracteres`);
  return result;
};

const parseDateRange = (query) => {
  const fromValue = parseTextFilter(query.fechaDesde, "La fecha inicial", 40);
  const toValue = parseTextFilter(query.fechaHasta, "La fecha final", 40);
  const from = fromValue ? new Date(fromValue) : null;
  const to = toValue ? new Date(toValue) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    badRequest("El rango de fechas no es válido");
  }
  if (from && to && from > to) {
    badRequest("La fecha inicial no puede ser posterior a la fecha final");
  }
  if (to) to.setUTCHours(23, 59, 59, 999);
  return { from, to };
};

const parsePeriod = (value) => {
  const period = parseTextFilter(value, "El período académico", 20);
  if (period && !/^\d{4}-[AB]$/.test(period)) {
    badRequest("El período académico no es válido");
  }
  return period;
};

const parseDonationFilters = (query) => {
  const campaignValue = query.campanaId ?? query.campana;
  const campaignId = campaignValue === undefined
    ? null
    : parseObjectId(campaignValue, "campaña");
  const period = parsePeriod(query.periodoAcademico);
  const type = parseTextFilter(query.tipo, "El tipo de donación", 30).toLowerCase();
  if (type && !["fisica", "monetaria"].includes(type)) {
    badRequest("El tipo de donación no es válido");
  }
  const state = parseTextFilter(query.estado, "El estado de donación", 40).toLowerCase();
  if (state && !DONATION_STATES.includes(state)) {
    badRequest("El estado de donación no es válido");
  }
  return {
    campaignId,
    period,
    type,
    state,
    dateRange: parseDateRange(query),
  };
};

const makeDonationMatch = (filters, campaignIdsForPeriod = []) => {
  const match = {};
  const and = [];
  if (filters.campaignId) match.campana = filters.campaignId;
  if (filters.period) {
    and.push({
      $or: [
        { periodoAcademico: filters.period },
        { campana: { $in: campaignIdsForPeriod } },
      ],
    });
  }
  if (filters.type) match.tipo = filters.type;
  if (filters.state) match.estado = filters.state;
  const date = {};
  if (filters.dateRange.from) date.$gte = filters.dateRange.from;
  if (filters.dateRange.to) date.$lte = filters.dateRange.to;
  if (Object.keys(date).length) {
    and.push({
      $or: [{ fechaRegistro: date }, { createdAt: date }],
    });
  }
  if (and.length) match.$and = and;
  return match;
};

const isEmptyDonationFilter = (filters) =>
  !filters.campaignId && !filters.period && !filters.type && !filters.state
  && !filters.dateRange.from && !filters.dateRange.to;

const paginationResult = (facet, page, limit) => {
  const total = facet?.metadata?.[0]?.total || 0;
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    items: facet?.items || [],
  };
};

const requestError = (res, error, label) => {
  if (error instanceof HistoryRequestError) {
    return res.status(error.status).json({ msg: error.message });
  }
  console.error(label, error);
  return res.status(500).json({ msg: label });
};

const profileProjection = {
  _id: 1,
  nombre: 1,
  apellido: 1,
  email: 1,
  ciudad: 1,
  universidad: 1,
  carrera: 1,
  semestre: 1,
  perteneceAsociacion: 1,
  asociacionEstudiantil: 1,
  cargoAsociacion: 1,
  status: 1,
  createdAt: 1,
  updatedAt: 1,
};

const collectorCampaignLookup = (filters = {}) => {
  const historyConditions = [
    { $eq: ["$$entry.recolector", "$$collectorId"] },
  ];
  if (filters.dateRange?.from) {
    historyConditions.push({ $gte: ["$$entry.fecha", filters.dateRange.from] });
  }
  if (filters.dateRange?.to) {
    historyConditions.push({ $lte: ["$$entry.fecha", filters.dateRange.to] });
  }
  if (filters.role === "principal") {
    historyConditions.push({ $eq: ["$$entry.rolPunto", "principal"] });
  } else if (filters.role === "secundario") {
    historyConditions.push({
      $in: ["$$entry.rolPunto", ["secundario", "apoyo"]],
    });
  }

  const pointConditions = [
    {
      $or: [
        { $eq: ["$$point.responsableRecolector", "$$collectorId"] },
        { $in: ["$$collectorId", { $ifNull: ["$$point.recolectores", []] }] },
      ],
    },
  ];
  if (filters.role === "principal") {
    pointConditions.push({ $eq: ["$$point.responsableRecolector", "$$collectorId"] });
  } else if (filters.role === "secundario") {
    pointConditions.push({
      $and: [
        { $ne: ["$$point.responsableRecolector", "$$collectorId"] },
        { $in: ["$$collectorId", { $ifNull: ["$$point.recolectores", []] }] },
      ],
    });
  }
  if (filters.dateRange?.from || filters.dateRange?.to) {
    pointConditions.push({ $eq: [true, false] });
  }

  const campaignMatch = {};
  if (filters.campaignId) campaignMatch._id = filters.campaignId;
  if (filters.period) campaignMatch.periodoAcademico = filters.period;

  return [
    { $match: campaignMatch },
    {
      $set: {
        _matchingHistory: {
          $filter: {
            input: { $ifNull: ["$historialAsignacionesRecolectores", []] },
            as: "entry",
            cond: { $and: historyConditions },
          },
        },
        _matchingPoints: {
          $filter: {
            input: { $ifNull: ["$puntosRecoleccion", []] },
            as: "point",
            cond: { $and: pointConditions },
          },
        },
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            { $gt: [{ $size: "$_matchingHistory" }, 0] },
            { $gt: [{ $size: "$_matchingPoints" }, 0] },
          ],
        },
      },
    },
    {
      $project: {
        _id: 1,
        nombre: 1,
        periodoAcademico: 1,
        fechaInicio: 1,
        fechaFin: 1,
        estado: 1,
        puntosRecoleccion: 1,
        _matchingHistory: 1,
        _matchingPoints: 1,
        _latestAssignment: { $max: "$_matchingHistory.fecha" },
      },
    },
  ];
};

const collectorFilterLookup = (filters) => ({
  $lookup: {
    from: Campana.collection.name,
    let: { collectorId: "$_id" },
    pipeline: collectorCampaignLookup(filters),
    as: "_matchingCampaigns",
  },
});

const collectorCampaignStatsLookup = {
  $lookup: {
    from: Campana.collection.name,
    let: { collectorId: "$_id" },
    pipeline: [
      ...collectorCampaignLookup(),
      {
        $group: {
          _id: null,
          campaignIds: { $addToSet: "$_id" },
          latestAssignmentAt: { $max: "$_latestAssignment" },
        },
      },
    ],
    as: "_campaignStats",
  },
};

const collectorDonationStatsLookup = {
  $lookup: {
    from: Donacion.collection.name,
    let: { collectorId: "$_id" },
    pipeline: [
      {
        $match: {
          $expr: {
            $or: [
              { $eq: ["$recolector", "$$collectorId"] },
              { $eq: ["$registradoPorRecolector", "$$collectorId"] },
              {
                $in: [
                  "$$collectorId",
                  { $ifNull: ["$historialRecolectores.recolectorAnterior", []] },
                ],
              },
              {
                $in: [
                  "$$collectorId",
                  { $ifNull: ["$historialRecolectores.recolectorNuevo", []] },
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalGestionadas: { $sum: 1 },
          totalAsignadas: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$recolector", "$$collectorId"] },
                    {
                      $in: [
                        "$$collectorId",
                        { $ifNull: ["$historialRecolectores.recolectorNuevo", []] },
                      ],
                    },
                    {
                      $in: [
                        "$$collectorId",
                        { $ifNull: ["$historialRecolectores.recolectorAnterior", []] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalRecolectadas: {
            $sum: {
              $cond: [
                {
                  $or: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ["$historialEstados", []] },
                              as: "event",
                              cond: {
                                $and: [
                                  { $eq: ["$$event.estado", "recolectada"] },
                                  { $eq: ["$$event.responsable", "$$collectorId"] },
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    {
                      $and: [
                        { $eq: ["$recolector", "$$collectorId"] },
                        { $in: ["$estado", COLLECTED_STATES] },
                        {
                          $eq: [
                            {
                              $size: {
                                $filter: {
                                  input: { $ifNull: ["$historialEstados", []] },
                                  as: "event",
                                  cond: { $eq: ["$$event.estado", "recolectada"] },
                                },
                              },
                            },
                            0,
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          latestDonationAt: {
            $max: {
              $ifNull: ["$updatedAt", { $ifNull: ["$fechaRegistro", "$createdAt"] }],
            },
          },
          donationCampaignIds: { $addToSet: "$campana" },
        },
      },
    ],
    as: "_donationStats",
  },
};

const campaignPeriodIds = async (period) => {
  if (!period) return [];
  return Campana.distinct("_id", { periodoAcademico: period });
};

const campaignAssignmentRole = (entry, point, collectorId) => {
  if (entry?.rolPunto === "principal") return "principal";
  if (["secundario", "apoyo"].includes(entry?.rolPunto)) return "secundario";
  if (entry?.vigente !== false && point) {
    const principalId = String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "");
    if (principalId === collectorId) return "principal";
    if ((point.recolectores || []).some((id) => String(id?._id ?? id) === collectorId)) {
      return "secundario";
    }
  }
  return null;
};

const eventDate = (events, state) => {
  const event = [...events]
    .sort((left, right) => new Date(left.fecha) - new Date(right.fecha))
    .find((item) => item.estado === state);
  return event?.fecha ?? null;
};

const serializeDonationEvidenceUrls = (evidences = [], collector = null) =>
  evidences.map((evidence) => {
    const responsible = evidence.recolector || collector;
    const collectorId = responsible?._id
      ? String(responsible._id)
      : responsible && typeof responsible !== "object"
        ? String(responsible)
        : null;
    return {
      ...(evidence._id ? { id: String(evidence._id) } : {}),
      etapa: evidence.etapa || "entrega",
      imagenUrl: urlPublica(evidence.imagenUrl),
      fecha: evidence.fecha ?? null,
      recolector: {
        id: collectorId,
        nombre: responsible?.nombre || null,
        apellido: responsible?.apellido || null,
      },
    };
  });

const makeStateTimeline = async (entries = []) => {
  const modelsByRole = new Map([
    ["admin", Admin],
    ["donante", Donante],
    ["recolector", Recolector],
  ]);
  const idsByRole = new Map();
  const sortedEntries = entries
    .map((entry, index) => ({
      ...(typeof entry.toObject === "function" ? entry.toObject() : entry),
      _sequence: index,
    }))
    .sort((left, right) =>
      new Date(left.fecha).getTime() - new Date(right.fecha).getTime()
      || left._sequence - right._sequence
    );

  for (const entry of sortedEntries) {
    const role = String(entry.rolResponsable || "").toLowerCase();
    const id = entry.responsable ? String(entry.responsable) : "";
    if (!id || !modelsByRole.has(role)) continue;
    if (!idsByRole.has(role)) idsByRole.set(role, new Set());
    idsByRole.get(role).add(id);
  }
  const peopleByRole = new Map();
  await Promise.all([...idsByRole].map(async ([role, ids]) => {
    const people = await modelsByRole.get(role)
      .find({ _id: { $in: [...ids] } })
      .select("_id nombre apellido")
      .lean();
    peopleByRole.set(role, new Map(people.map((person) => [String(person._id), person])));
  }));

  return sortedEntries.map((entry, index) => {
    const role = String(entry.rolResponsable || "").toLowerCase();
    const person = entry.responsable
      ? peopleByRole.get(role)?.get(String(entry.responsable))
      : null;
    const previous = index > 0 ? sortedEntries[index - 1] : null;
    const { _sequence, ...storedEntry } = entry;
    return {
      estadoAnterior: entry.estadoAnterior ?? previous?.estado ?? null,
      estadoNuevo: entry.estadoNuevo ?? entry.estado ?? null,
      estadoLabel: donationStatusLabel(entry.estadoNuevo ?? entry.estado),
      fecha: entry.fecha ?? null,
      usuarioResponsable: person
        ? {
            _id: person._id,
            nombre: person.nombre,
            apellido: person.apellido,
            rol: role,
          }
        : entry.responsable
          ? { _id: entry.responsable, nombre: null, apellido: null, rol: role || null }
          : null,
      observacion: entry.observaciones ?? "",
      ...storedEntry,
    };
  });
};

const findDonationDelivery = (donation, campaignDelivery) => {
  const trace = campaignDelivery?.donaciones?.find(
    (item) => String(item.donacion) === String(donation._id)
  );
  return trace
    ? {
        campanaId: campaignDelivery.campana,
        fechaEntrega: campaignDelivery.fechaEntrega,
        estado: campaignDelivery.estado,
        receptor: campaignDelivery.receptor,
        descripcionBienes: campaignDelivery.descripcionBienes,
        evidencias: serializeDonationEvidenceUrls(
          campaignDelivery.evidencias || [],
          {
            _id: campaignDelivery.recolectorPrincipal,
            nombre: campaignDelivery.recolectorPrincipalNombre,
            apellido: campaignDelivery.recolectorPrincipalApellido,
          }
        ),
        donacion: trace,
      }
    : null;
};

const serializeIndividualDeliveries = (deliveries = []) => deliveries.map((delivery) => {
  const collector = delivery.recolector;
  const collectorId = collector?._id ? String(collector._id) : collector ? String(collector) : null;
  const evidence = delivery.imagenUrl
    ? [{
        etapa: "finalizacion",
        imagenUrl: urlPublica(delivery.imagenUrl),
        fecha: delivery.fecha ?? null,
        recolector: {
          id: collectorId,
          nombre: collector?.nombre || null,
          apellido: collector?.apellido || null,
        },
      }]
    : [];
  return {
    ...(delivery._id ? { id: String(delivery._id) } : {}),
    nombresReceptor: delivery.nombresReceptor,
    apellidosReceptor: delivery.apellidosReceptor,
    telefonoReceptor: delivery.telefonoReceptor,
    cargoReceptor: delivery.cargoReceptor,
    descripcionBienes: delivery.descripcionBienes,
    recolector: {
      id: collectorId,
      nombre: collector?.nombre || null,
      apellido: collector?.apellido || null,
    },
    fecha: delivery.fecha,
    imagenUrl: urlPublica(delivery.imagenUrl),
    evidencias: evidence,
  };
});

const donationCard = (donation, campaignDelivery) => {
  const campaign = donation.campana;
  const point = campaign?.puntosRecoleccion?.find(
    (item) => String(item._id) === String(donation.puntoRecoleccionRef)
  );
  return {
    _id: donation._id,
    codigo: `DONATY:${donation._id}`,
    codigoQr: `DONATY:${donation._id}`,
    tipo: donation.tipo,
    descripcion: donation.descripcion ?? "",
    nombreBien: donation.nombreBien ?? "",
    categoria: donation.categoria ?? "",
    subcategoria: donation.subcategoria ?? "",
    cantidad: donation.cantidad ?? null,
    fechaRegistro: donation.fechaRegistro ?? donation.createdAt ?? null,
    estado: donation.estado,
    estadoLabel: donationStatusLabel(donation.estado),
    campana: campaign
      ? {
          _id: campaign._id,
          nombre: campaign.nombre,
          periodoAcademico: campaign.periodoAcademico ?? null,
        }
      : null,
    puntoRecoleccion: point
      ? { _id: point._id, nombre: point.nombre }
      : donation.puntoRecoleccionRef
        ? { _id: donation.puntoRecoleccionRef, nombre: null }
        : null,
    recolector: donation.recolector
      ? {
          _id: donation.recolector._id ?? donation.recolector,
          nombre: donation.recolector.nombre ?? null,
          apellido: donation.recolector.apellido ?? null,
        }
      : null,
    clasificacion: donation.clasificacionId ?? null,
    evidencias: serializeDonationEvidenceUrls(donation.evidencias || []),
    entrega: {
      individual: serializeIndividualDeliveries(donation.entregas || []),
      general: findDonationDelivery(donation, campaignDelivery),
    },
  };
};

const getCampaignDonationDelivery = (donations, campaignDelivery) => donations.map(
  (donation) => donationCard(donation, campaignDelivery)
);

const listHistorialRecolectores = async (req, res) => {
  try {
    const query = req.query || {};
    const pagination = parsePagination(
      query,
      ["nombre", "apellido", "email", "createdAt"],
      "createdAt"
    );
    const search = parseTextFilter(query.q ?? query.busqueda, "La búsqueda");
    const campaignValue = query.campanaId ?? query.campana;
    const filters = {
      campaignId: campaignValue === undefined
        ? null
        : parseObjectId(campaignValue, "campaña"),
      period: parsePeriod(query.periodoAcademico),
      dateRange: parseDateRange(query),
      role: parseTextFilter(query.rol ?? query.rolDesempenado, "El rol", 30).toLowerCase(),
    };
    if (filters.role === "apoyo") filters.role = "secundario";
    if (filters.role && !["principal", "secundario"].includes(filters.role)) {
      badRequest("El rol debe ser principal o secundario");
    }
    const accountStatus = parseTextFilter(query.estadoCuenta, "El estado de cuenta", 20).toLowerCase();
    const statusFilter = {};
    if (accountStatus) {
      if (["activa", "activo", "true"].includes(accountStatus)) statusFilter.status = true;
      else if (["inactiva", "inactivo", "false"].includes(accountStatus)) statusFilter.status = false;
      else badRequest("El estado de cuenta debe ser activa o inactiva");
    }
    const match = { ...statusFilter };
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      match.$or = [{ nombre: regex }, { apellido: regex }, { email: regex }];
    }
    const pipeline = [{ $match: match }];
    const hasCampaignFilters = Boolean(
      filters.campaignId || filters.period || filters.role
      || filters.dateRange.from || filters.dateRange.to
    );
    if (hasCampaignFilters) {
      pipeline.push(
        collectorFilterLookup(filters),
        { $match: { "_matchingCampaigns.0": { $exists: true } } }
      );
    }
    pipeline.push({
      $facet: {
        metadata: [{ $count: "total" }],
        items: [
          { $sort: pagination.sort },
          { $skip: pagination.skip },
          { $limit: pagination.limit },
          collectorCampaignStatsLookup,
          collectorDonationStatsLookup,
          {
            $set: {
              _campaignStats: { $ifNull: [{ $arrayElemAt: ["$_campaignStats", 0] }, {}] },
              _donationStats: { $ifNull: [{ $arrayElemAt: ["$_donationStats", 0] }, {}] },
            },
          },
          {
            $project: {
              ...profileProjection,
              estadoCuenta: "$status",
              totalCampanas: {
                $size: {
                  $filter: {
                    input: {
                      $setUnion: [
                        { $ifNull: ["$_campaignStats.campaignIds", []] },
                        { $ifNull: ["$_donationStats.donationCampaignIds", []] },
                      ],
                    },
                    as: "campaignId",
                    cond: { $ne: ["$$campaignId", null] },
                  },
                },
              },
              totalDonacionesAsignadas: { $ifNull: ["$_donationStats.totalAsignadas", 0] },
              totalDonacionesRecolectadas: { $ifNull: ["$_donationStats.totalRecolectadas", 0] },
              totalDonacionesGestionadas: { $ifNull: ["$_donationStats.totalGestionadas", 0] },
              fechaUltimaActividad: {
                $max: [
                  "$updatedAt",
                  "$_campaignStats.latestAssignmentAt",
                  "$_donationStats.latestDonationAt",
                ],
              },
            },
          },
        ],
      },
    });
    const [facet] = await Recolector.aggregate(pipeline);
    return res.status(200).json(paginationResult(facet, pagination.page, pagination.limit));
  } catch (error) {
    return requestError(res, error, "Error al consultar el historial de recolectores");
  }
};

const getCollectorCampaigns = async (collectorId) => {
  const donationCampaignIds = await Donacion.distinct("campana", {
    campana: { $ne: null },
    $or: [
      { recolector: collectorId },
      { registradoPorRecolector: collectorId },
      { "historialRecolectores.recolectorAnterior": collectorId },
      { "historialRecolectores.recolectorNuevo": collectorId },
    ],
  });
  const campaigns = await Campana.find({
    $or: [
      { "historialAsignacionesRecolectores.recolector": collectorId },
      { "puntosRecoleccion.recolectores": collectorId },
      { "puntosRecoleccion.responsableRecolector": collectorId },
      ...(donationCampaignIds.length ? [{ _id: { $in: donationCampaignIds } }] : []),
    ],
  })
    .select("_id nombre periodoAcademico fechaInicio fechaFin estado puntosRecoleccion historialAsignacionesRecolectores")
    .lean();
  const id = String(collectorId);
  return campaigns.flatMap((campaign) => {
    const histories = (campaign.historialAsignacionesRecolectores || [])
      .filter((entry) => String(entry.recolector?._id ?? entry.recolector) === id)
      .sort((left, right) => new Date(left.fecha || 0) - new Date(right.fecha || 0));
    const pointsById = new Map(
      (campaign.puntosRecoleccion || []).map((point) => [String(point._id), point])
    );
    const rows = [];
    histories.forEach((entry, index) => {
      if (!entry.puntoNuevo) return;
      const nextEvent = entry.fecha
        ? histories.slice(index + 1).find((candidate) =>
            candidate.fecha && new Date(candidate.fecha) >= new Date(entry.fecha)
          )
        : null;
      const pointId = String(entry.puntoNuevo);
      const point = pointsById.get(pointId);
      const isCurrent = entry.vigente !== false && !nextEvent;
      rows.push({
        campanaId: campaign._id,
        campanaNombre: campaign.nombre,
        periodoAcademico: campaign.periodoAcademico ?? null,
        fechaInicio: campaign.fechaInicio ?? null,
        fechaFin: campaign.fechaFin ?? null,
        fechaAsignacion: entry.fecha ?? null,
        puntoRecoleccion: point
          ? { _id: point._id, nombre: point.nombre }
          : { _id: entry.puntoNuevo, nombre: null },
        rolDesempenado: campaignAssignmentRole(entry, point, id),
        estadoParticipacion: isCurrent ? "vigente" : "finalizada",
        fechaDesvinculacion: isCurrent ? null : nextEvent?.fecha ?? null,
      });
    });

    for (const point of campaign.puntosRecoleccion || []) {
      const assigned = String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "") === id
        || (point.recolectores || []).some((collector) =>
          String(collector?._id ?? collector) === id
        );
      if (!assigned) continue;
      const hasCurrentHistory = rows.some((row) =>
        String(row.puntoRecoleccion?._id) === String(point._id)
        && row.estadoParticipacion === "vigente"
      );
      if (hasCurrentHistory) continue;
      rows.push({
        campanaId: campaign._id,
        campanaNombre: campaign.nombre,
        periodoAcademico: campaign.periodoAcademico ?? null,
        fechaInicio: campaign.fechaInicio ?? null,
        fechaFin: campaign.fechaFin ?? null,
        fechaAsignacion: null,
        puntoRecoleccion: { _id: point._id, nombre: point.nombre },
        rolDesempenado: campaignAssignmentRole({ vigente: true }, point, id),
        estadoParticipacion: "vigente",
        fechaDesvinculacion: null,
      });
    }
    return rows;
  });
};

const listHistorialRecolectorDetail = async (req, res) => {
  try {
    const collectorId = parseObjectId(req.params.recolectorId, "recolector");
    const pagination = parsePagination(req.query || {}, ["createdAt"], "createdAt");
    const collector = await Recolector.findById(collectorId).select(
      "_id nombre apellido email universidad carrera perteneceAsociacion asociacionEstudiantil cargoAsociacion status createdAt updatedAt"
    ).lean();
    if (!collector) return res.status(404).json({ msg: "El recolector no existe" });

    const campanas = await getCollectorCampaigns(collectorId);
    const donationFilter = {
      $or: [
        { recolector: collectorId },
        { registradoPorRecolector: collectorId },
        { "historialRecolectores.recolectorAnterior": collectorId },
        { "historialRecolectores.recolectorNuevo": collectorId },
      ],
    };
    const [totalDonaciones, donaciones] = await Promise.all([
      Donacion.countDocuments(donationFilter),
      Donacion.find(donationFilter)
        .select("_id nombreBien categoria subcategoria descripcion tipo fechaRegistro fechaAsignacion estado campana donante donanteExterno nombreDonante recolector registradoPorRecolector puntoRecoleccionRef clasificacionId historialRecolectores historialEstados entregas createdAt")
        .sort(pagination.sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate("donante", "nombre apellido")
        .populate("campana", "nombre periodoAcademico")
        .lean(),
    ]);
    const donations = donaciones.map((donation) => {
      const assignedHistory = (donation.historialRecolectores || [])
        .filter((entry) => String(entry.recolectorNuevo) === String(collectorId))
        .sort((left, right) => new Date(left.fecha || 0) - new Date(right.fecha || 0))
        .at(-1);
      return {
        _id: donation._id,
        codigo: `DONATY:${donation._id}`,
        donante: donation.donante
          ? { _id: donation.donante._id, nombre: donation.donante.nombre, apellido: donation.donante.apellido }
          : donation.donanteExterno ?? (donation.nombreDonante ? { nombreCompleto: donation.nombreDonante } : null),
        campana: donation.campana
          ? { _id: donation.campana._id, nombre: donation.campana.nombre, periodoAcademico: donation.campana.periodoAcademico }
          : null,
        fechaAsignacion: assignedHistory?.fecha
          ?? (String(donation.recolector) === String(collectorId) ? donation.fechaAsignacion : null),
        estado: donation.estado,
        fechaRecoleccion: eventDate(donation.historialEstados || [], "recolectada"),
        fechaEntrega: eventDate(donation.historialEstados || [], "entregada")
          ?? donation.entregas?.find((delivery) => delivery.fecha)?.fecha
          ?? null,
      };
    });
    return res.status(200).json({
      recolector: {
        _id: collector._id,
        nombre: collector.nombre,
        apellido: collector.apellido,
        email: collector.email,
        universidad: collector.universidad ?? "",
        carrera: collector.carrera ?? "",
        perteneceAsociacion: collector.perteneceAsociacion ?? null,
        asociacionEstudiantil: collector.asociacionEstudiantil ?? "",
        estadoCuenta: collector.status,
      },
      campanas,
      donaciones: {
        total: totalDonaciones,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(totalDonaciones / pagination.limit),
        items: donations,
      },
    });
  } catch (error) {
    return requestError(res, error, "Error al consultar el detalle histórico del recolector");
  }
};

const listHistorialDonantes = async (req, res) => {
  try {
    const query = req.query || {};
    const pagination = parsePagination(
      query,
      ["nombre", "apellido", "email", "createdAt"],
      "createdAt"
    );
    const search = parseTextFilter(query.q ?? query.busqueda, "La búsqueda");
    const donationFilters = parseDonationFilters(query);
    const periodCampaignIds = await campaignPeriodIds(donationFilters.period);
    const match = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      match.$or = [{ nombre: regex }, { apellido: regex }, { email: regex }];
    }
    const pipeline = [{ $match: match }];
    if (!isEmptyDonationFilter(donationFilters)) {
      pipeline.push(
        {
          $lookup: {
            from: Donacion.collection.name,
            let: { donorId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$donante", "$$donorId"] } } },
              { $match: makeDonationMatch(donationFilters, periodCampaignIds) },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: "_matchingDonations",
          },
        },
        { $match: { "_matchingDonations.0": { $exists: true } } }
      );
    }
    pipeline.push({
      $facet: {
        metadata: [{ $count: "total" }],
        items: [
          { $sort: pagination.sort },
          { $skip: pagination.skip },
          { $limit: pagination.limit },
          {
            $lookup: {
              from: Donacion.collection.name,
              let: { donorId: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$donante", "$$donorId"] } } },
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    fisicas: { $sum: { $cond: [{ $eq: ["$tipo", "fisica"] }, 1, 0] } },
                    monetarias: { $sum: { $cond: [{ $eq: ["$tipo", "monetaria"] }, 1, 0] } },
                    campanas: { $addToSet: "$campana" },
                    ultimaDonacion: {
                      $max: { $ifNull: ["$fechaRegistro", "$createdAt"] },
                    },
                  },
                },
              ],
              as: "_donationStats",
            },
          },
          {
            $set: {
              _donationStats: { $ifNull: [{ $arrayElemAt: ["$_donationStats", 0] }, {}] },
            },
          },
          {
            $project: {
              ...profileProjection,
              estadoCuenta: "$status",
              totalCampanas: {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$_donationStats.campanas", []] },
                    as: "campaignId",
                    cond: { $ne: ["$$campaignId", null] },
                  },
                },
              },
              totalDonaciones: { $ifNull: ["$_donationStats.total", 0] },
              donacionesFisicas: { $ifNull: ["$_donationStats.fisicas", 0] },
              donacionesMonetarias: { $ifNull: ["$_donationStats.monetarias", 0] },
              fechaUltimaDonacion: { $ifNull: ["$_donationStats.ultimaDonacion", null] },
            },
          },
        ],
      },
    });
    const [facet] = await Donante.aggregate(pipeline);
    return res.status(200).json(paginationResult(facet, pagination.page, pagination.limit));
  } catch (error) {
    return requestError(res, error, "Error al consultar el historial de donantes");
  }
};

const getDonorCampaignHistory = async (donorId) => Donacion.aggregate([
  {
    $match: {
      donante: donorId,
      campana: { $ne: null },
    },
  },
  {
    $group: {
      _id: "$campana",
      fechaParticipacion: { $min: { $ifNull: ["$fechaRegistro", "$createdAt"] } },
      totalDonaciones: { $sum: 1 },
    },
  },
  {
    $lookup: {
      from: Campana.collection.name,
      localField: "_id",
      foreignField: "_id",
      as: "campaign",
    },
  },
  { $unwind: { path: "$campaign", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 0,
      campanaId: "$_id",
      campanaNombre: { $ifNull: ["$campaign.nombre", null] },
      periodoAcademico: { $ifNull: ["$campaign.periodoAcademico", null] },
      fechaParticipacion: 1,
      totalDonaciones: 1,
      estadoCampana: { $ifNull: ["$campaign.estado", null] },
    },
  },
  { $sort: { fechaParticipacion: -1 } },
]);

const listHistorialDonanteDetail = async (req, res) => {
  try {
    const donorId = parseObjectId(req.params.donanteId, "donante");
    const donor = await Donante.findById(donorId).select(
      "_id nombre apellido email direccion telefono ciudad sector fechaNacimiento universidad carrera semestre perteneceAsociacion asociacionEstudiantil cargoAsociacion status createdAt"
    ).lean();
    if (!donor) return res.status(404).json({ msg: "El donante no existe" });
    const campanas = await getDonorCampaignHistory(donorId);
    return res.status(200).json({
      donante: {
        _id: donor._id,
        nombre: donor.nombre,
        apellido: donor.apellido,
        email: donor.email,
        direccion: donor.direccion ?? "",
        telefono: donor.telefono ?? "",
        ciudad: donor.ciudad ?? "",
        sector: donor.sector ?? "",
        fechaNacimiento: donor.fechaNacimiento ?? null,
        universidad: donor.universidad ?? "",
        carrera: donor.carrera ?? "",
        semestre: donor.semestre ?? "",
        perteneceAsociacion: donor.perteneceAsociacion ?? null,
        asociacionEstudiantil: donor.asociacionEstudiantil ?? "",
        cargoAsociacion: donor.cargoAsociacion ?? "",
        estadoCuenta: donor.status,
      },
      campanas,
    });
  } catch (error) {
    return requestError(res, error, "Error al consultar el detalle histórico del donante");
  }
};

const listDonorCampaignDonations = async (req, res) => {
  try {
    const donorId = parseObjectId(req.params.donanteId, "donante");
    const campaignId = parseObjectId(req.params.campanaId, "campaña");
    const pagination = parsePagination(
      req.query || {},
      ["createdAt", "fechaRegistro", "estado"],
      "createdAt"
    );
    const filters = parseDonationFilters(req.query || {});
    const donor = await Donante.exists({ _id: donorId });
    if (!donor) return res.status(404).json({ msg: "El donante no existe" });
    const campaign = await Campana.findById(campaignId)
      .select("_id nombre periodoAcademico puntosRecoleccion")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });

    const periodCampaignIds = await campaignPeriodIds(filters.period);
    const match = {
      donante: donorId,
      campana: campaignId,
      ...makeDonationMatch({ ...filters, campaignId: null }, periodCampaignIds),
    };
    const [total, donations] = await Promise.all([
      Donacion.countDocuments(match),
      Donacion.find(match)
        .select("_id donante campana tipo descripcion nombreBien categoria subcategoria cantidad fechaRegistro createdAt estado puntoRecoleccionRef recolector clasificacionId entregas evidencias")
        .sort(pagination.sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate("recolector", "nombre apellido")
        .populate("clasificacionId", "_id nombre campana puntoRecoleccionRef")
        .populate("entregas.recolector", "_id nombre apellido")
        .populate("evidencias.recolector", "_id nombre apellido")
        .lean(),
    ]);
    const donationIds = donations.map((donation) => donation._id);
    const campaignDelivery = donationIds.length
      ? await EntregaCampana.findOne({
          campana: campaignId,
          "donaciones.donacion": { $in: donationIds },
        })
          .select("campana receptor fechaEntrega descripcionBienes estado donaciones evidencias recolectorPrincipal recolectorPrincipalNombre recolectorPrincipalApellido")
          .lean()
      : null;
    const items = getCampaignDonationDelivery(
      donations.map((donation) => ({ ...donation, campana: campaign })),
      campaignDelivery
    );
    return res.status(200).json({
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
      items,
    });
  } catch (error) {
    return requestError(res, error, "Error al consultar las donaciones del donante");
  }
};

const listDonationTrace = async (req, res) => {
  try {
    const donationId = parseObjectId(req.params.donacionId, "donación");
    const donation = await Donacion.findById(donationId)
      .select("_id donante donanteExterno nombreDonante recolector registradoPorRecolector campana periodoAcademico puntoRecoleccionRef tipo categoria categoriaRef nombreBien subcategoria descripcion cantidad fechaRegistro estado clasificacionId entregas evidencias productosClasificados historialEstados historialRecolectores createdAt")
      .populate("donante", "_id nombre apellido")
      .populate("recolector", "_id nombre apellido")
      .populate("registradoPorRecolector", "_id nombre apellido")
      .populate("clasificacionId", "_id nombre campana puntoRecoleccionRef")
      .populate("categoriaRef", "_id nombre")
      .populate("campana", "_id nombre periodoAcademico fechaInicio fechaFin estado puntosRecoleccion")
      .populate("entregas.recolector", "_id nombre apellido")
      .populate("evidencias.recolector", "_id nombre apellido")
      .lean();
    if (!donation) return res.status(404).json({ msg: "La donación no existe" });

    const historialEstados = await makeStateTimeline(donation.historialEstados || []);
    const collectorIds = [...new Set(
      (donation.historialRecolectores || []).flatMap((entry) =>
        [entry.recolectorAnterior, entry.recolectorNuevo]
          .filter(Boolean)
          .map(String)
      )
    )];
    const collectors = collectorIds.length
      ? await Recolector.find({ _id: { $in: collectorIds } })
        .select("_id nombre apellido")
        .lean()
      : [];
    const collectorsById = new Map(collectors.map((item) => [String(item._id), item]));
    const administratorIds = [...new Set(
      (donation.historialRecolectores || [])
        .map((entry) => String(entry.administrador || ""))
        .filter(Boolean)
    )];
    const administrators = administratorIds.length
      ? await Admin.find({ _id: { $in: administratorIds } })
        .select("_id nombre apellido")
        .lean()
      : [];
    const administratorsById = new Map(
      administrators.map((item) => [String(item._id), item])
    );
    const historialRecolectores = (donation.historialRecolectores || [])
      .map((entry) => {
        const previousCollector = entry.recolectorAnterior
          ? collectorsById.get(String(entry.recolectorAnterior)) ?? null
          : null;
        const newCollector = entry.recolectorNuevo
          ? collectorsById.get(String(entry.recolectorNuevo)) ?? null
          : null;
        const administrator = entry.administrador
          ? administratorsById.get(String(entry.administrador)) ?? null
          : null;
        return {
          ...entry,
          changedAt: entry.fecha,
          previousCollector: previousCollector
            ? {
                id: String(previousCollector._id),
                fullName: `${previousCollector.nombre || ""} ${previousCollector.apellido || ""}`.trim(),
              }
            : null,
          newCollector: newCollector
            ? {
                id: String(newCollector._id),
                fullName: `${newCollector.nombre || ""} ${newCollector.apellido || ""}`.trim(),
              }
            : null,
          changedBy: administrator
            ? {
                id: String(administrator._id),
                fullName: `${administrator.nombre || ""} ${administrator.apellido || ""}`.trim() || null,
              }
            : entry.administrador
              ? { id: String(entry.administrador), fullName: null }
              : null,
          recolectorAnteriorDetalle: previousCollector,
          recolectorNuevoDetalle: newCollector,
        };
      })
      .sort((left, right) => new Date(left.fecha) - new Date(right.fecha));
    const delivery = donation.campana
      ? await EntregaCampana.findOne({
          campana: donation.campana._id,
          "donaciones.donacion": donationId,
        })
          .select("campana receptor fechaEntrega descripcionBienes estado donaciones evidencias recolectorPrincipal recolectorPrincipalNombre recolectorPrincipalApellido")
          .lean()
      : null;
    const [donationDetails] = getCampaignDonationDelivery(
      [donation],
      delivery
    );
    return res.status(200).json({
      donacion: donationDetails,
      historialEstados,
      historialRecolectores,
    });
  } catch (error) {
    return requestError(res, error, "Error al consultar la trazabilidad de la donación");
  }
};

export {
  listHistorialRecolectores,
  listHistorialRecolectorDetail,
  listHistorialDonantes,
  listHistorialDonanteDetail,
  listDonorCampaignDonations,
  listDonationTrace,
};
