import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Donante from "../models/Donante.js";
import Categoria from "../models/Categoria.js";
import Recolector from "../models/Recolector.js";
import EntregaCampana from "../models/EntregaCampana.js";
import Clasificacion from "../models/Clasificacion.js";
import { publishCampaignEvent } from "../services/domainEvents.js";
import { notifyCampaignAssignmentChanges } from "../services/campaignAssignmentNotifications.js";
import { resolveAcademicPeriod } from "../utils/academicPeriod.js";
import {
  normalizePickupPoints,
  resolveCampaignState,
  countAssignedCollectors,
  assertNoOverlappingAssignments,
  validateAssignableCollectors,
  reserveCollectorsForCampaign,
  rollbackCollectorReservations,
} from "./campana_controller.js";
import {
  buildPickupPointsResponse,
  isCollectorAssignedToPoint,
  isPickupPointActive,
  serializePickupPoint,
} from "../utils/pickupPoints.js";
import { buildClassificationByPoint } from "../utils/donationClassification.js";
import { resolverPuntoId } from "../utils/pickupPointResolver.js";
import {
  getCampaignDeliveryReadiness,
  isCampaignFinished,
} from "../services/campaignDelivery.js";
import {
  buildCampaignHistoryFilter,
  buildCollectorDonationFilter,
  isCollectorAssignedToCampaign,
} from "../utils/collectorHistory.js";
import {
  buildInitialAssignmentHistory,
  buildPointAssignmentHistoryChanges,
} from "../utils/campaignAssignmentHistory.js";

const normalizePointText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const pointUniqueKey = (point) => [
  point.edificioId !== undefined && point.edificioId !== null
    ? `id:${point.edificioId}`
    : `nombre:${normalizePointText(point.edificio || point.nombreEdificio)}`,
  normalizePointText(point.piso),
  normalizePointText(point.aula),
].join("|");

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildAssignmentHistoryEntries = (campaign, collectorsById = new Map()) => {
  const pointsById = new Map(
    (campaign?.puntosRecoleccion || []).map((point) => [String(point._id), point])
  );
  const historyEntries = (campaign?.historialAsignacionesRecolectores || [])
    .map((entry) => {
      const collectorId = String(entry?.recolector?._id ?? entry?.recolector ?? "").trim();
      const collector = collectorId ? collectorsById.get(collectorId) || null : null;
      const collectorName = collector
        ? `${collector.nombre || ""} ${collector.apellido || ""}`.trim()
        : null;
      const pointId = String(entry?.puntoNuevo ?? entry?.puntoAnterior ?? "");
      const point = pointId ? pointsById.get(pointId) || null : null;
      const parsedDate = entry?.fecha ? new Date(entry.fecha) : null;
      const fecha = parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : null;
      return {
        _id: String(entry?._id ?? `${campaign?._id ?? "campaign"}:${collectorId}:${pointId}`),
        recolectorId: collectorId,
        recolectorNombre: collectorName,
        campanaId: String(campaign?._id ?? ""),
        campanaNombre: campaign?.nombre ?? "",
        fecha,
        fechaOriginal: entry?.fecha ?? null,
        accion: entry?.vigente === false ? "retirada" : "asignada",
        vigente: entry?.vigente !== false,
        motivo: entry?.motivo ?? "",
        puntoId: pointId || null,
        puntoNombre: point?.nombre ?? null,
        punto: point
          ? { _id: pointId, nombre: point.nombre ?? "", direccion: point.direccion ?? "" }
          : null,
        rolPunto: entry?.rolPunto
          ?? (entry?.vigente !== false && point
            ? String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "") === collectorId
              ? "principal"
              : (point.recolectores || []).some((id) =>
                  String(id?._id ?? id) === collectorId
                )
                ? "secundario"
                : null
            : null),
        fechaRealDisponible: fecha !== null,
        fuente: "historial",
      };
    })
    .filter((entry) => entry.recolectorId)
    .sort((left, right) => {
      const leftTime = left.fechaOriginal ? new Date(left.fechaOriginal).getTime() : 0;
      const rightTime = right.fechaOriginal ? new Date(right.fechaOriginal).getTime() : 0;
      return rightTime - leftTime;
    });

  const currentAssignments = [];
  for (const point of campaign?.puntosRecoleccion || []) {
    const collectorIds = new Set([
      ...(point.recolectores || []).map((id) => String(id?._id ?? id)),
      ...(point.responsableRecolector
        ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
        : []),
    ]);
    for (const collectorId of collectorIds) {
      if (!collectorId) continue;
      const hasCurrentHistory = historyEntries.some((entry) =>
        entry.vigente
        && entry.recolectorId === collectorId
        && entry.puntoId === String(point._id)
      );
      if (hasCurrentHistory) continue;
      const collector = collectorsById.get(collectorId) || null;
      currentAssignments.push({
        _id: `current:${campaign?._id ?? "campaign"}:${point._id}:${collectorId}`,
        recolectorId: collectorId,
        recolectorNombre: collector
          ? `${collector.nombre || ""} ${collector.apellido || ""}`.trim()
          : null,
        campanaId: String(campaign?._id ?? ""),
        campanaNombre: campaign?.nombre ?? "",
        fecha: null,
        fechaOriginal: null,
        accion: "asignada",
        vigente: true,
        motivo: "",
        puntoId: String(point._id),
        puntoNombre: point.nombre ?? null,
        punto: {
          _id: String(point._id),
          nombre: point.nombre ?? "",
          direccion: point.direccion ?? "",
        },
        rolPunto: String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "") === collectorId
          ? "principal"
          : "secundario",
        fechaRealDisponible: false,
        fuente: "asignacion_vigente",
      });
    }
  }

  return [...historyEntries, ...currentAssignments].sort((left, right) => {
    const leftTime = left.fecha ? new Date(left.fecha).getTime() : 0;
    const rightTime = right.fecha ? new Date(right.fecha).getTime() : 0;
    return rightTime - leftTime;
  });
};

const buildCollectorDonationHistoryItem = (donation, campaign) => {
  const id = String(donation._id);
  const collector = donation.recolector
    && typeof donation.recolector === "object"
    && ("nombre" in donation.recolector || "apellido" in donation.recolector)
    ? donation.recolector
    : null;
  const collectorId = String(collector?._id ?? donation.recolector ?? "");
  const pointId = donation.puntoRecoleccionRef
    ? String(donation.puntoRecoleccionRef)
    : null;
  const point = pointId
    ? (campaign.puntosRecoleccion || []).find((entry) => String(entry._id) === pointId) || null
    : null;
  const roleAtPoint = point && collectorId
    ? String(point.responsableRecolector || "") === collectorId
      ? "principal"
      : (point.recolectores || []).some((assignedId) => String(assignedId) === collectorId)
        ? "secundario"
        : null
    : null;
  const donationDate = donation.fechaRegistro || donation.createdAt || null;

  return {
    ...donation,
    id,
    codigo: `DONATY:${id}`,
    fecha: donationDate,
    fechaDonacion: donationDate,
    periodoAcademico: donation.periodoAcademico || campaign.periodoAcademico || null,
    campana: {
      _id: campaign._id,
      nombre: campaign.nombre,
      periodoAcademico: campaign.periodoAcademico ?? null,
    },
    donante: donation.donante || donation.donanteExterno || {
      nombre: donation.nombreDonante,
      apellido: "",
    },
    categoria: donation.categoria || donation.categoriaRef?.nombre || null,
    categoriaId: donation.categoriaRef?._id
      ? String(donation.categoriaRef._id)
      : null,
    nombreDonacion: donation.nombreBien || null,
    puntoRecoleccion: point
      ? {
          _id: String(point._id),
          id: String(point._id),
          nombre: point.nombre ?? "",
          direccion: point.direccion ?? "",
        }
      : null,
    recolector: collector
      ? {
          _id: String(collector._id),
          nombre: collector.nombre ?? "",
          apellido: collector.apellido ?? "",
        }
      : null,
    recolectorNombre: collector
      ? `${collector.nombre} ${collector.apellido}`.trim()
      : null,
    rolPunto: roleAtPoint,
  };
};

const listarCampanasAdmin = async (_req, res) => {
  try {
    const [campanas, conteos, entregas] = await Promise.all([
      Campana.find().sort({ createdAt: -1 }).lean(),
      Donacion.aggregate([
        { $match: { campana: { $ne: null } } },
        { $group: { _id: "$campana", total: { $sum: 1 } } },
      ]),
      EntregaCampana.find().select("_id campana").lean(),
    ]);

    const porCampana = new Map(conteos.map((c) => [String(c._id), c.total]));
    const entregaPorCampana = new Map(
      entregas.map((entrega) => [String(entrega.campana), entrega])
    );

    return res.status(200).json({
      msg: "Campañas consultadas correctamente",
      total: campanas.length,
      campanas: campanas.map((c) => ({
        ...c,
        estado: resolveCampaignState(c),
        periodoAcademico:
          c.periodoAcademico
          || resolveAcademicPeriod(c.fechaInicio || c.createdAt),
        totalPuntos: c.puntosRecoleccion?.length ?? 0,
        totalDonaciones: porCampana.get(String(c._id)) ?? 0,
        entregaRegistrada: entregaPorCampana.has(String(c._id)),
        cerrada:
          isCampaignFinished(c)
          && entregaPorCampana.has(String(c._id)),
        entregaGeneralId: entregaPorCampana.get(String(c._id))?._id ?? null,
      })),
    });
  } catch (error) {
    console.error("Error al listar campañas (admin):", error);
    return res.status(500).json({ msg: "Error al consultar las campañas" });
  }
};

const consultarClasificacionesDePunto = async (req, res) => {
  try {
    const campaignId = req.params.campaignId || req.params.campanaId;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const campaign = await Campana.findById(campaignId)
      .select("_id puntosRecoleccion")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    const pointId = resolverPuntoId(
      req.user,
      req.query?.puntoId ?? req.params.pointId,
      campaign
    );

    const classifications = await Clasificacion.find({
      campana: campaign._id,
      puntoRecoleccionRef: pointId,
    }).sort({ nombre: 1 }).lean();
    const donations = classifications.length
      ? await Donacion.find({
          campana: campaign._id,
          puntoRecoleccionRef: pointId,
          clasificacionId: { $in: classifications.map((item) => item._id) },
        })
        .select("_id clasificacionId nombreBien cantidad metadata estado donante donanteExterno nombreDonante")
        .populate("donante", "nombre apellido")
        .sort({ _id: 1 })
        .lean()
      : [];
    const quantityByClassification = new Map();
    for (const donation of donations) {
      const key = String(donation.clasificacionId);
      const rawQuantity = donation.metadata?.cantidad ?? donation.cantidad;
      const quantity = Number(rawQuantity);
      if (Number.isSafeInteger(quantity) && quantity > 0) {
        quantityByClassification.set(
          key,
          (quantityByClassification.get(key) || 0) + quantity
        );
      }
    }

    return res.status(200).json(
      classifications.map((classification) => ({
        id: String(classification._id),
        nombre: classification.nombre,
        total: quantityByClassification.get(String(classification._id)) || 0,
      }))
    );
  } catch (error) {
    console.error("Error consultando clasificaciones de punto:", error.message || error);
    return res.status(error.statusCode || 500).json({
      ...(error.statusCode ? { msg: error.message } : {}),
      ...(!error.statusCode
        ? { msg: "No se pudieron consultar las clasificaciones de este punto" }
        : {}),
    });
  }
};

const listarPuntosDeCampana = async (req, res) => {
  try {
    const { campanaId } = req.params;
    if (!mongoose.isValidObjectId(campanaId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const role = String(req.user?.rol || "").toLowerCase();
    const admin = role === "admin";
    const query = admin
      ? { _id: campanaId }
      : { _id: campanaId, activa: true };
    const campana = await Campana.findOne(query)
      .select("_id activa diasAtencion periodoAcademico puntosRecoleccion")
      .lean();
    if (!campana) return res.status(404).json({ msg: "La campaña no existe" });

    const collectorCampaign = role === "recolector"
      ? {
          ...campana,
          puntosRecoleccion: (campana.puntosRecoleccion || []).filter((point) =>
            isPickupPointActive(point)
            && (point.recolectores || []).some(
              (collectorId) => String(collectorId) === String(req.user._id)
            )
          ),
        }
      : campana;
    return res.status(200).json(
      buildPickupPointsResponse(collectorCampaign, {
        includeAssignments: admin,
        activeOnly: !admin,
      })
    );
  } catch (error) {
    console.error("Error al consultar puntos de campaña:", error);
    return res.status(500).json({ msg: "Error al consultar los puntos de recolección" });
  }
};

const donacionesDeCampana = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ msg: "El identificador de la campaña no es válido" });
    }

    const campana = await Campana.findById(id);
    if (!campana) {
      return res.status(404).json({ msg: "La campaña no existe" });
    }

    const collectorRole = String(req.user?.rol || "").toLowerCase() === "recolector";
    const collectorPoints = collectorRole
      ? (campana.puntosRecoleccion || []).filter((point) =>
        isPickupPointActive(point)
        && isCollectorAssignedToPoint(point, req.user?._id)
      )
      : campana.puntosRecoleccion || [];
    if (collectorRole && collectorPoints.length === 0) {
      return res.status(403).json({
        msg: "No tienes un punto activo asignado en esta campaña",
      });
    }

    const donationFilter = { campana: id };
    if (collectorRole) {
      donationFilter.puntoRecoleccionRef = {
        $in: collectorPoints.map((point) => point._id),
      };
    }
    const [donaciones, entregaGeneral] = await Promise.all([
      Donacion.find(donationFilter)
        .sort({ createdAt: -1 })
        .populate("donante", "nombre apellido email telefono")
        .populate("recolector", "nombre apellido")
        .populate("registradoPorRecolector", "nombre apellido"),
      collectorRole ? Promise.resolve(null) : EntregaCampana.findOne({ campana: id })
        .populate("recolectorPrincipal", "nombre apellido email")
        .populate("donaciones.donacion", "nombreBien categoria subcategoria metadata estado")
        .populate("donaciones.recolectorAsignado", "nombre apellido")
        .populate("productos.donaciones", "nombreBien categoria subcategoria metadata")
        .lean(),
    ]);
    const deliveryReadiness = collectorRole
      ? await getCampaignDeliveryReadiness({
          campaign: campana,
          collectorId: req.user._id,
        })
      : null;
    const entregaRegistrada = collectorRole
      ? deliveryReadiness.entregaRegistrada
      : Boolean(entregaGeneral);
    const campaignPayload = {
      ...campana.toObject(),
      cerrada: isCampaignFinished(campana) && Boolean(entregaRegistrada),
      ...(collectorRole
        ? { puedeEntregar: deliveryReadiness.puedeEntregar }
        : {}),
      ...(collectorRole
        && process.env.CAMPAIGN_DELIVERY_DEBUG === "true"
        ? { debug: deliveryReadiness.debug }
        : {}),
      periodoAcademico:
        campana.periodoAcademico
        || resolveAcademicPeriod(campana.fechaInicio || campana.createdAt),
    };
    if (collectorRole) {
      campaignPayload.puntosRecoleccion = collectorPoints.map((point) =>
        serializePickupPoint(point, campana._id, { includeAssignments: false })
      );
      delete campaignPayload.historialAsignacionesRecolectores;
    }

    return res.status(200).json({
      msg: "Donaciones consultadas correctamente",
      campana: campaignPayload,
      total: donaciones.length,
      donaciones,
      clasificacionPorPunto: buildClassificationByPoint(
        donaciones,
        collectorPoints
      ),
      ...(collectorRole
        ? {}
        : {
            entregaGeneral: entregaGeneral || {
              registrada: false,
              mensaje: "La entrega general de esta campaña aún no ha sido registrada",
            },
          }),
    });
  } catch (error) {
    console.error("Error al consultar donaciones de campaña:", error);
    return res
      .status(500)
      .json({ msg: "Error al consultar las donaciones de la campaña" });
  }
};

const listarHistorialCampanas = async (req, res) => {
  try {
    const collectorRole = String(req.user?.rol || "").toLowerCase() === "recolector";
    const donorRole = String(req.user?.rol || "").toLowerCase() === "donante";
    const period = req.query?.periodoAcademico
      ? String(req.query.periodoAcademico).trim()
      : "";
    const search = req.query?.q ? String(req.query.q).trim() : "";
    if (period && !/^\d{4}-[AB]$/.test(period)) {
      return res.status(400).json({ msg: "Período académico inválido" });
    }
    if (search.length > 100) {
      return res.status(400).json({ msg: "La búsqueda no puede superar 100 caracteres" });
    }
    const campaignIdFilter = req.query?.campanaId
      ? String(req.query.campanaId).trim()
      : "";
    if (campaignIdFilter && !mongoose.isValidObjectId(campaignIdFilter)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    const campaignStateFilter = req.query?.estado
      ? String(req.query.estado).trim().toLowerCase()
      : "";
    if (
      campaignStateFilter
      && !["borrador", "activa", "finalizada", "desactivada"].includes(campaignStateFilter)
    ) {
      return res.status(400).json({ msg: "Estado de campaña inválido" });
    }

    let collectorId = collectorRole ? req.user._id : null;
    if (!collectorRole && req.query?.recolectorId !== undefined) {
      collectorId = String(req.query.recolectorId).trim();
      if (!mongoose.isValidObjectId(collectorId)) {
        return res.status(400).json({ msg: "El identificador del recolector no es válido" });
      }
      const collectorExists = await Recolector.exists({ _id: collectorId });
      if (!collectorExists) {
        return res.status(404).json({ msg: "El recolector no existe" });
      }
    }

    let campaignFilter;
    if (donorRole) {
      const donorCampaignIds = await Donacion.distinct("campana", {
        donante: req.user._id,
        campana: { $ne: null },
      });
      campaignFilter = { _id: { $in: donorCampaignIds } };
      const donorFilters = [
        period ? { periodoAcademico: period } : null,
        search ? { nombre: new RegExp(escapeRegex(search), "i") } : null,
        campaignIdFilter ? { _id: campaignIdFilter } : null,
      ].filter(Boolean);
      if (donorFilters.length) campaignFilter.$and = donorFilters;
    } else {
      campaignFilter = buildCampaignHistoryFilter({
        collectorId,
        period,
        search,
      });
      if (campaignIdFilter) campaignFilter._id = campaignIdFilter;
    }

    let campaigns = await Campana.find(campaignFilter)
      .sort({ createdAt: -1 })
      .lean();
    if (campaignStateFilter) {
      campaigns = campaigns.filter(
        (campaign) => resolveCampaignState(campaign) === campaignStateFilter
      );
    }
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const deliveredCampaignIds = campaignIds.length
      ? new Set((await EntregaCampana.distinct("campana", {
          campana: { $in: campaignIds },
        })).map(String))
      : new Set();
    const assignedCollectorIds = donorRole ? [] : [...new Set(
      campaigns.flatMap((campaign) => [
        ...(campaign.puntosRecoleccion || []).flatMap((point) =>
          [
            ...(point.recolectores || []).map((id) => String(id?._id ?? id)),
            ...(point.responsableRecolector
              ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
              : []),
          ]
        ),
        ...(campaign.historialAsignacionesRecolectores || []).map((entry) =>
          String(entry.recolector)
        ),
      ])
    )];
    const [donationCounts, deliveryReadinessEntries, collectors] = await Promise.all([
      Donacion.aggregate([
        {
          $match: {
            campana: { $in: campaignIds },
            ...(donorRole
              ? { donante: req.user._id }
              : { tipo: "fisica", estado: { $ne: "cancelada" } }),
          },
        },
        {
          $group: {
            _id: "$campana",
            totalDonaciones: { $sum: 1 },
          },
        },
      ]),
      collectorRole
        ? Promise.all(campaigns.map(async (campaign) => [
            String(campaign._id),
            await getCampaignDeliveryReadiness({
              campaign,
              collectorId: req.user._id,
            }),
          ]))
        : Promise.resolve([]),
      Recolector.find({ _id: { $in: assignedCollectorIds } })
        .select("_id nombre apellido")
        .lean(),
    ]);
    const donationCountsByCampaign = new Map(
      donationCounts.map((item) => [String(item._id), item.totalDonaciones])
    );
    const deliveryReadinessByCampaign = new Map(deliveryReadinessEntries);
    const collectorsById = new Map(
      collectors.map((collector) => [String(collector._id), collector])
    );

    return res.status(200).json({
      total: campaigns.length,
      campanas: campaigns.map((campaign) => {
        const assignedIds = [...new Set([
          ...(campaign.puntosRecoleccion || []).flatMap((point) =>
            [
              ...(point.recolectores || []).map((id) => String(id?._id ?? id)),
              ...(point.responsableRecolector
                ? [String(point.responsableRecolector?._id ?? point.responsableRecolector)]
                : []),
            ]
          ),
          ...(campaign.historialAsignacionesRecolectores || []).map((entry) =>
            String(entry.recolector)
          ),
        ])];
        const collectorNames = collectorRole
          ? [String(req.user._id)]
              .map((id) => collectorsById.get(id))
              .filter(Boolean)
              .map((collector) =>
                `${collector.nombre} ${collector.apellido}`.trim()
              )
          : assignedIds
              .map((id) => collectorsById.get(id))
              .filter(Boolean)
              .map((collector) =>
                `${collector.nombre} ${collector.apellido}`.trim()
              );
        return {
          _id: String(campaign._id),
          nombre: campaign.nombre,
          fechaRegistro: campaign.createdAt ?? campaign.fechaRegistro ?? null,
          fechaInicio: campaign.fechaInicio ?? null,
          fechaFin: campaign.fechaFin ?? null,
          periodoAcademico: campaign.periodoAcademico ?? null,
          imagenUrl: campaign.imagenUrl ?? "",
          cantidadTotalBienes: null,
          totalDonaciones: donationCountsByCampaign.get(String(campaign._id)) ?? 0,
          estado: resolveCampaignState(campaign),
          cerrada: isCampaignFinished(campaign)
            && deliveredCampaignIds.has(String(campaign._id)),
          ...(collectorRole
            ? {
                puedeEntregar: Boolean(
                  deliveryReadinessByCampaign.get(String(campaign._id))?.puedeEntregar
                ),
                ...(process.env.CAMPAIGN_DELIVERY_DEBUG === "true"
                  ? {
                      debug: deliveryReadinessByCampaign.get(String(campaign._id))
                        ?.debug,
                    }
                  : {}),
              }
            : {}),
          recolectores: donorRole ? [] : [...new Set(collectorNames)],
          historialAsignaciones: donorRole
            ? []
            : buildAssignmentHistoryEntries(campaign, collectorsById),
        };
      }),
    });
  } catch (error) {
    console.error("Error al consultar el historial de campañas:", error);
    return res.status(500).json({ msg: "Error al consultar el historial de campañas" });
  }
};

const listarHistorialDonacionesRecolector = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }
    const role = String(req.user?.rol || "").toLowerCase();
    let collectorId = req.user?._id;
    if (role === "admin") {
      collectorId = String(req.query?.recolectorId || "").trim();
      if (!mongoose.isValidObjectId(collectorId)) {
        return res.status(400).json({ msg: "El identificador del recolector no es válido" });
      }
      const collectorExists = await Recolector.exists({ _id: collectorId });
      if (!collectorExists) {
        return res.status(404).json({ msg: "El recolector no existe" });
      }
    }

    const campaign = await Campana.findById(id)
      .select("_id nombre periodoAcademico fechaInicio createdAt puntosRecoleccion historialAsignacionesRecolectores");
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    if (
      role === "recolector"
      && !isCollectorAssignedToCampaign(campaign, collectorId)
    ) {
      const hasAssignedDonations = await Donacion.exists({
        campana: id,
        recolector: collectorId,
        tipo: "fisica",
      });
      if (!hasAssignedDonations) {
        return res.status(403).json({
          msg: "No tienes una asignación vigente en esta campaña",
        });
      }
    }

    const donationFilter = buildCollectorDonationFilter(
      id,
      collectorId,
      { includeAssignmentHistory: role === "admin" }
    );
    const queryText = req.query?.q ? String(req.query.q).trim() : "";
    if (queryText.length > 100) {
      return res.status(400).json({ msg: "La búsqueda no puede superar 100 caracteres" });
    }
    if (queryText) {
      const escapedQuery = escapeRegex(queryText);
      const donorIds = await Donante.find({
        $or: [
          { nombre: new RegExp(escapedQuery, "i") },
          { apellido: new RegExp(escapedQuery, "i") },
        ],
      }).distinct("_id");
      donationFilter.$and = [{
        $or: [
          { nombreBien: new RegExp(escapedQuery, "i") },
          { categoria: new RegExp(escapedQuery, "i") },
          { subcategoria: new RegExp(escapedQuery, "i") },
          { nombreDonante: new RegExp(escapedQuery, "i") },
          { "donanteExterno.nombre": new RegExp(escapedQuery, "i") },
          { "donanteExterno.apellido": new RegExp(escapedQuery, "i") },
          ...(donorIds.length ? [{ donante: { $in: donorIds } }] : []),
        ],
      }];
    }
    if (req.query?.categoria !== undefined) {
      const categoria = String(req.query.categoria).trim();
      if (!categoria) {
        return res.status(400).json({ msg: "La categoría no es válida" });
      }
      const categoryFilter = mongoose.isValidObjectId(categoria)
        ? { categoriaRef: categoria }
        : { categoria: new RegExp(escapeRegex(categoria), "i") };
      donationFilter.$and = [
        ...(donationFilter.$and || []),
        {
          $or: [
            categoryFilter,
            ...(categoryFilter.categoria ? [{ categoria: categoryFilter.categoria }] : []),
          ],
        },
      ];
    }
    if (req.query?.fechaDesde !== undefined || req.query?.fechaHasta !== undefined) {
      const fromValue = req.query?.fechaDesde ? String(req.query.fechaDesde).trim() : "";
      const toValue = req.query?.fechaHasta ? String(req.query.fechaHasta).trim() : "";
      const fromDate = fromValue ? new Date(fromValue) : null;
      const toDate = toValue ? new Date(toValue) : null;
      if ((fromValue && Number.isNaN(fromDate.getTime())) || (toValue && Number.isNaN(toDate.getTime()))) {
        return res.status(400).json({ msg: "Las fechas de historial deben ser válidas" });
      }
      if (fromDate || toDate) {
        const range = {};
        if (fromDate) range.$gte = fromDate;
        if (toDate) {
          const endOfDay = new Date(toDate);
          endOfDay.setHours(23, 59, 59, 999);
          range.$lte = endOfDay;
        }
        donationFilter.$and = [
          ...(donationFilter.$and || []),
          {
            $or: [
              { fechaRegistro: range },
              { createdAt: range },
            ],
          },
        ];
      }
    }
    if (req.query?.estado !== undefined) {
      const state = String(req.query.estado).trim().toLowerCase();
      if (!["pendiente", "asignada", "pendiente_recoleccion", "recolectada", "clasificada", "en_entrega", "entregada", "cancelada", "devolucion", "devuelta"].includes(state)) {
        return res.status(400).json({ msg: "Estado de donación inválido" });
      }
      donationFilter.estado = state;
    }
    if (req.query?.periodoAcademico !== undefined) {
      const period = String(req.query.periodoAcademico).trim();
      if (!/^\d{4}-[AB]$/.test(period)) {
        return res.status(400).json({ msg: "Período académico inválido" });
      }
      donationFilter.$and = [
        ...(donationFilter.$and || []),
        {
          $or: [
            { periodoAcademico: period },
            ...(campaign.periodoAcademico === period
              ? [{ periodoAcademico: null }]
              : []),
          ],
        },
      ];
    }

    const items = await Donacion.find(donationFilter)
      .select(
        "_id campana donante donanteExterno nombreDonante recolector periodoAcademico tipo createdAt fechaRegistro cantidad nombreBien categoria categoriaRef subcategoria descripcion metadata productosClasificados estado entregas evidencias puntoRecoleccionRef"
      )
      .sort({ createdAt: -1 })
      .populate("donante", "nombre apellido")
      .populate("recolector", "nombre apellido")
      .populate("categoriaRef", "nombre")
      .lean();
    return res.status(200).json({
      total: items.length,
      items: items.map((item) => buildCollectorDonationHistoryItem(item, campaign)),
    });
  } catch (error) {
    console.error("Error consultando historial de donaciones del recolector:", error);
    return res.status(500).json({
      msg: "Error al consultar el historial de donaciones",
    });
  }
};

const eliminarCampana = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ msg: "El identificador de la campaña no es válido" });
    }

    const campana = await Campana.findById(id);
    if (!campana) {
      return res.status(404).json({ msg: "La campaña no existe" });
    }

    const total = await Donacion.countDocuments({ campana: id });
    if (total > 0) {
      return res.status(409).json({
        msg:
          `No se puede eliminar la campaña porque tiene ${total} donación(es) ` +
          "asociada(s). Puedes desactivarla para que deje de recibir donaciones.",
      });
    }

    const totalCategorias = await Categoria.countDocuments({ campana: id });
    if (totalCategorias > 0) {
      return res.status(409).json({
        msg:
          `No se puede eliminar la campaña porque tiene ${totalCategorias} categoría(s) asociada(s). ` +
          "Elimina primero las categorías que no tengan donaciones.",
        totalCategorias,
      });
    }

    await Campana.findByIdAndDelete(id);

    return res.status(200).json({
      msg: "Campaña eliminada correctamente",
      id,
    });
  } catch (error) {
    console.error("Error al eliminar campaña:", error);
    return res.status(500).json({ msg: "Error al eliminar la campaña" });
  }
};

const crearPuntoRecoleccion = async (req, res) => {
  let reservations = [];
  let reservationCampaignId = null;
  try {
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ msg: "El identificador de campaña no es válido" });
    }

    const input = req.body?.punto ?? req.body;
    if (input?.campanaId && String(input.campanaId) !== String(campaignId)) {
      return res.status(400).json({ msg: "El punto debe pertenecer a la campaña de la ruta" });
    }
    const [punto] = normalizePickupPoints([input], [], true, true);
    const currentCampaign = await Campana.findById(campaignId)
      .select("_id __v nombre fechaInicio fechaFin horaInicio horaFin diasAtencion numeroRecolectores puntosRecoleccion historialAsignacionesRecolectores")
      .lean();
    if (!currentCampaign) return res.status(404).json({ msg: "La campaña no existe" });
    const collectorIds = (punto.recolectores || []).map(String);
    const alreadyAssigned = new Set(
      (currentCampaign.puntosRecoleccion || []).flatMap((point) =>
        (point.recolectores || []).map(String)
      )
    );
    if (collectorIds.some((collectorId) => alreadyAssigned.has(collectorId))) {
      return res.status(409).json({
        msg: "Un recolector no puede asignarse a más de un punto de la misma campaña",
      });
    }
    await validateAssignableCollectors(collectorIds);
    const candidateCampaign = {
      ...currentCampaign,
      puntosRecoleccion: [...(currentCampaign.puntosRecoleccion || []), punto],
    };
    if (punto.activo) {
      await assertNoOverlappingAssignments(candidateCampaign, collectorIds);
    }

    const duplicate = (currentCampaign.puntosRecoleccion || []).some((existing) =>
      isPickupPointActive(existing)
      && pointUniqueKey(existing) === punto.claveUnica
    );
    if (punto.activo && duplicate) {
      return res.status(409).json({
        msg: "Ya existe un punto activo para ese edificio, piso y aula",
      });
    }
    const activeCount = (currentCampaign.puntosRecoleccion || [])
      .filter(isPickupPointActive).length;
    if (punto.activo && activeCount >= Number(currentCampaign.numeroRecolectores || 0)) {
      return res.status(409).json({
        msg: "No hay capacidad de recolectores disponible para agregar otro punto activo",
      });
    }

    const filter = {
      _id: campaignId,
      $or: [
        { __v: currentCampaign.__v ?? 0 },
        { __v: { $exists: false } },
      ],
    };
    if (punto.activo) {
      filter.puntosRecoleccion = {
        $not: {
          $elemMatch: {
            claveUnica: punto.claveUnica,
            activo: { $ne: false },
            estado: { $ne: "inactivo" },
          },
        },
      };
      filter.$expr = {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$puntosRecoleccion", []] },
                as: "point",
                cond: {
                  $and: [
                    { $ne: ["$$point.activo", false] },
                    {
                      $ne: [
                        { $toLower: { $ifNull: ["$$point.estado", ""] } },
                        "inactivo",
                      ],
                    },
                  ],
                },
              },
            },
          },
          { $ifNull: ["$numeroRecolectores", 0] },
        ],
      };
    }
    if (punto.activo) {
      reservations = await reserveCollectorsForCampaign(candidateCampaign, collectorIds);
      reservationCampaignId = currentCampaign._id;
    }
    const assignedAt = new Date();
    const assignmentHistory = buildInitialAssignmentHistory({
      points: [punto],
      campaignId: currentCampaign._id,
      administratorId: req.user._id,
      assignedAt,
    });
    const campana = await Campana.findOneAndUpdate(
      filter,
      {
        $push: {
          puntosRecoleccion: punto,
          historialAsignacionesRecolectores: { $each: assignmentHistory },
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!campana) {
      await rollbackCollectorReservations(reservationCampaignId, reservations);
      reservations = [];
      return res.status(409).json({
        msg: "El punto duplicado o la capacidad disponible cambió; vuelve a consultar",
      });
    }
    reservations = [];
    const createdPoint = campana.puntosRecoleccion.at(-1);
    const notificaciones = await notifyCampaignAssignmentChanges(
      campana,
      campana.puntosRecoleccion.slice(0, -1),
      { eventPrefix: "campaign-point-created-assignment" }
    );
    await publishCampaignEvent(req, "campaign.pickup-point.created", campana);

    return res.status(201).json({
      msg: "Punto de recolección creado correctamente",
      campanaId: String(campana._id),
      punto: serializePickupPoint(createdPoint, campana._id),
      totalPuntos: campana.puntosRecoleccion.length,
      notificaciones,
    });
  } catch (error) {
    if (reservations.length && reservationCampaignId) {
      await rollbackCollectorReservations(reservationCampaignId, reservations);
    }
    console.error("Error al crear punto de recolección:", error);
    if (error.statusCode || error.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ msg: error.message });
    }
    return res.status(500).json({ msg: "Error al crear el punto de recolección" });
  }
};

const actualizarPuntoRecoleccion = async (req, res) => {
  let reservations = [];
  let reservationCampaignId = null;
  try {
    const { campaignId, pointId } = req.params;
    if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(pointId)) {
      return res.status(400).json({ msg: "Los identificadores de campaña y punto no son válidos" });
    }
    const input = req.body?.punto ?? req.body;
    if (input?.campanaId && String(input.campanaId) !== String(campaignId)) {
      return res.status(400).json({ msg: "El punto debe pertenecer a la campaña de la ruta" });
    }

    const campaign = await Campana.findById(campaignId)
      .select("_id __v nombre fechaInicio fechaFin horaInicio horaFin diasAtencion numeroRecolectores puntosRecoleccion historialAsignacionesRecolectores");
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });
    const currentPoint = campaign.puntosRecoleccion.id(pointId);
    if (!currentPoint) return res.status(404).json({ msg: "El punto no existe en esta campaña" });

    const mergedInput = {
      ...currentPoint.toObject(),
      ...input,
      _id: pointId,
    };
    const collectorConfigurationProvided =
      Object.hasOwn(input, "responsableRecolector")
      || Object.hasOwn(input, "recolectoresSecundarios")
      || Object.hasOwn(input, "recolectores");
    if (!collectorConfigurationProvided) {
      delete mergedInput.responsableRecolector;
      delete mergedInput.recolectores;
      delete mergedInput.recolectoresSecundarios;
    }
    if (Object.hasOwn(input, "estado") && !Object.hasOwn(input, "activo")) {
      delete mergedInput.activo;
    }
    const [updatedPoint] = normalizePickupPoints(
      [mergedInput],
      campaign.puntosRecoleccion,
      false,
      true
    );
    const requestedCollectorIds = (updatedPoint.recolectores || []).map(String);
    const otherPointCollectorIds = new Set(
      campaign.puntosRecoleccion
        .filter((point) => String(point._id) !== String(pointId))
        .flatMap((point) => (point.recolectores || []).map(String))
    );
    if (requestedCollectorIds.some((collectorId) =>
      otherPointCollectorIds.has(collectorId)
    )) {
      return res.status(409).json({
        msg: "Un recolector no puede asignarse a más de un punto de la misma campaña",
      });
    }
    const previousCollectorIds = (currentPoint.recolectores || []).map(String);
    const removedCollectorIds = previousCollectorIds.filter(
      (collectorId) => !requestedCollectorIds.includes(collectorId)
    );
    if (
      removedCollectorIds.length
      && countAssignedCollectors(campaign.puntosRecoleccion)
        >= Number(campaign.numeroRecolectores || 0)
    ) {
      return res.status(409).json({
        msg: "No retires directamente a un recolector cuando el máximo está ocupado; sustitúyelo mediante la reasignación",
      });
    }
    const candidatePoints = campaign.puntosRecoleccion.map((point) =>
      String(point._id) === String(pointId) ? updatedPoint : point.toObject()
    );
    const candidateCampaign = {
      ...campaign.toObject(),
      puntosRecoleccion: candidatePoints,
    };
    const assignmentHistory = buildPointAssignmentHistoryChanges({
      previousPoints: campaign.puntosRecoleccion,
      nextPoints: candidatePoints,
      history: campaign.historialAsignacionesRecolectores,
      campaignId: campaign._id,
      administratorId: req.user._id,
      assignedAt: new Date(),
    });
    const duplicate = campaign.puntosRecoleccion.some((existing) =>
      String(existing._id) !== String(pointId)
      && isPickupPointActive(existing)
      && pointUniqueKey(existing) === updatedPoint.claveUnica
    );
    if (updatedPoint.activo && duplicate) {
      return res.status(409).json({
        msg: "Ya existe otro punto activo para ese edificio, piso y aula",
      });
    }
    const currentPointIsActive = isPickupPointActive(currentPoint);
    const activeCount = campaign.puntosRecoleccion
      .filter(isPickupPointActive).length;
    if (
      updatedPoint.activo
      && !currentPointIsActive
      && activeCount >= Number(campaign.numeroRecolectores || 0)
    ) {
      return res.status(409).json({
        msg: "No hay capacidad de recolectores disponible para activar este punto",
      });
    }
    if (updatedPoint.activo && requestedCollectorIds.length) {
      await validateAssignableCollectors(requestedCollectorIds);
      await assertNoOverlappingAssignments(candidateCampaign, requestedCollectorIds);
      reservations = await reserveCollectorsForCampaign(
        candidateCampaign,
        requestedCollectorIds
      );
      reservationCampaignId = campaign._id;
    }

    const updateFilter = {
      _id: campaignId,
      "puntosRecoleccion._id": pointId,
      $or: [
        { __v: campaign.__v ?? 0 },
        { __v: { $exists: false } },
      ],
    };
    if (updatedPoint.activo) {
      updateFilter.$and = [{
        puntosRecoleccion: {
          $not: {
            $elemMatch: {
              _id: { $ne: pointId },
              claveUnica: updatedPoint.claveUnica,
              activo: { $ne: false },
              estado: { $ne: "inactivo" },
            },
          },
        },
      }];
      updateFilter.$expr = {
        [currentPointIsActive ? "$lte" : "$lt"]: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$puntosRecoleccion", []] },
                as: "point",
                cond: {
                  $and: [
                    { $ne: ["$$point.activo", false] },
                    {
                      $ne: [
                        { $toLower: { $ifNull: ["$$point.estado", ""] } },
                        "inactivo",
                      ],
                    },
                  ],
                },
              },
            },
          },
          { $ifNull: ["$numeroRecolectores", 0] },
        ],
      };
    }
    const updatedCampaign = await Campana.findOneAndUpdate(
      updateFilter,
      {
        $set: {
          "puntosRecoleccion.$": updatedPoint,
          historialAsignacionesRecolectores: assignmentHistory,
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!updatedCampaign) {
      if (reservations.length) {
        await rollbackCollectorReservations(reservationCampaignId, reservations);
        reservations = [];
      }
      return res.status(409).json({
        msg: "El punto cambió concurrentemente; vuelve a consultar e inténtalo otra vez",
      });
    }
    reservations = [];
    if (removedCollectorIds.length) {
      await Recolector.updateMany(
        {
          _id: { $in: removedCollectorIds },
          "reservasHorarioCampanas.campana": campaign._id,
        },
        {
          $pull: { reservasHorarioCampanas: { campana: campaign._id } },
          $inc: { versionReservasHorario: 1 },
        }
      );
      await Recolector.updateMany(
        { _id: { $in: removedCollectorIds }, campanaReservada: campaign._id },
        { $set: { campanaReservada: null } }
      );
    }
    if (!updatedPoint.activo && previousCollectorIds.length) {
      await Recolector.updateMany(
        {
          _id: { $in: previousCollectorIds },
          "reservasHorarioCampanas.campana": campaign._id,
        },
        {
          $pull: { reservasHorarioCampanas: { campana: campaign._id } },
          $inc: { versionReservasHorario: 1 },
        }
      );
      await Recolector.updateMany(
        { _id: { $in: previousCollectorIds }, campanaReservada: campaign._id },
        { $set: { campanaReservada: null } }
      );
    }

    await publishCampaignEvent(
      req,
      "campaign.pickup-point.updated",
      updatedCampaign,
      removedCollectorIds
    );
    const savedPoint = updatedCampaign.puntosRecoleccion.find(
      (point) => String(point._id) === String(pointId)
    );
    return res.status(200).json({
      msg: "Punto de recolección actualizado correctamente",
      campanaId: String(updatedCampaign._id),
      punto: serializePickupPoint(savedPoint, updatedCampaign._id),
      totalPuntos: updatedCampaign.puntosRecoleccion.length,
    });
  } catch (error) {
    if (reservations.length && reservationCampaignId) {
      await rollbackCollectorReservations(reservationCampaignId, reservations);
    }
    console.error("Error al actualizar punto de recolección:", error);
    if (error.statusCode || error.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ msg: error.message });
    }
    return res.status(500).json({ msg: "Error al actualizar el punto de recolección" });
  }
};

const eliminarPuntoRecoleccion = async (req, res) => {
  try {
    const { campaignId, pointId } = req.params;
    if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(pointId)) {
      return res.status(400).json({ msg: "Los identificadores de campaña y punto no son válidos" });
    }

    const campaignExists = await Campana.exists({ _id: campaignId });
    if (!campaignExists) return res.status(404).json({ msg: "La campaña no existe" });

    const point = await Campana.findOne({
      _id: campaignId,
      "puntosRecoleccion._id": pointId,
    }).select("puntosRecoleccion").lean();
    const existingPoint = point?.puntosRecoleccion?.find(
      (item) => String(item._id) === pointId
    );
    if (!existingPoint) return res.status(404).json({ msg: "El punto no existe en esta campaña" });
    if (existingPoint.recolectores?.length) {
      return res.status(409).json({
        msg: "No se puede eliminar un punto que tiene recolectores asignados",
      });
    }

    const donationExists = await Donacion.exists({
      campana: campaignId,
      puntoRecoleccionRef: pointId,
    });
    if (donationExists) {
      return res.status(409).json({
        msg: "No se puede eliminar un punto asociado a una o más donaciones",
      });
    }

    const campana = await Campana.findOneAndUpdate(
      {
        _id: campaignId,
        puntosRecoleccion: {
          $elemMatch: {
            _id: pointId,
            $or: [
              { recolectores: { $size: 0 } },
              { recolectores: { $exists: false } },
            ],
          },
        },
      },
      { $pull: { puntosRecoleccion: { _id: pointId } } },
      { new: true, runValidators: true }
    ).lean();
    if (!campana) {
      return res.status(409).json({
        msg: "El punto cambió o recibió una asignación; vuelve a consultar la campaña",
      });
    }

    return res.status(200).json({
      msg: "Punto de recolección eliminado correctamente",
      campanaId: String(campana._id),
      pointId,
      totalPuntos: campana.puntosRecoleccion.length,
    });
  } catch (error) {
    console.error("Error al eliminar punto de recolección:", error);
    return res.status(500).json({ msg: "Error al eliminar el punto de recolección" });
  }
};

export {
  buildAssignmentHistoryEntries,
  buildCollectorDonationHistoryItem,
  listarCampanasAdmin,
  consultarClasificacionesDePunto,
  listarPuntosDeCampana,
  donacionesDeCampana,
  listarHistorialCampanas,
  listarHistorialDonacionesRecolector,
  eliminarCampana,
  crearPuntoRecoleccion,
  actualizarPuntoRecoleccion,
  eliminarPuntoRecoleccion,
};