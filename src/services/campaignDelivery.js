import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import EntregaCampana from "../models/EntregaCampana.js";
import Recolector from "../models/Recolector.js";
import Clasificacion from "../models/Clasificacion.js";
import { isCampaignScheduleFinished } from "../utils/campaignSchedule.js";

const deliveryError = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });

const isCampaignFinished = (campaign, now = new Date()) => {
  const state = String(campaign?.estado ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return ["finalizada", "cerrada"].includes(state)
    || isCampaignScheduleFinished(campaign, now);
};

const normalizeDonationState = (state) =>
  String(state ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s-]+/g, "");

const EXCLUDED_DELIVERY_STATES = new Set([
  "rechazada",
  "rechazado",
  "cancelada",
  "cancelado",
  "eliminada",
  "eliminado",
  "eliminadas",
  "eliminados",
]);

const calcularPuedeEntregar = (
  campaign,
  user,
  donations = [],
  existingDelivery = null,
  now = new Date()
) => {
  const collectorId = user?._id ?? user?.id;
  const principalPoint = findCampaignPrincipalPoint(campaign, collectorId);
  const eligibleDonations = donations.filter(
    (donation) => !EXCLUDED_DELIVERY_STATES.has(normalizeDonationState(donation.estado))
  );
  const enEntrega = eligibleDonations.filter(
    (donation) => normalizeDonationState(donation.estado) === "enentrega"
  );
  const estadosNoEntrega = eligibleDonations
    .filter((donation) => normalizeDonationState(donation.estado) !== "enentrega")
    .map((donation) => ({
      donacionId: String(donation._id),
      estado: donation.estado ?? null,
    }));
  const esPrincipal = Boolean(principalPoint);
  const finalizada = isCampaignFinished(campaign, now);
  const todasEnEntrega = eligibleDonations.length > 0
    && enEntrega.length === eligibleDonations.length;
  const yaEntregada = Boolean(existingDelivery);

  return {
    esPrincipal,
    finalizada,
    todasEnEntrega,
    totalDonaciones: eligibleDonations.length,
    enEntrega: enEntrega.length,
    estadosNoEntrega,
    yaEntregada,
    puedeEntregar: esPrincipal && finalizada && todasEnEntrega && !yaEntregada,
    donations: eligibleDonations,
    puntoRecoleccionRef: principalPoint?._id ?? null,
  };
};

const getCampaignPrincipalCollectorId = (campaign, point) => {
  const explicitPrincipalId = String(
    point?.responsableRecolector?._id ?? point?.responsableRecolector ?? ""
  );
  if (explicitPrincipalId) return explicitPrincipalId;

  const points = campaign?.puntosRecoleccion || [];
  const assignedCollectorIds = new Set(
    points.flatMap((assignedPoint) => [
      ...(assignedPoint.recolectores || []).map((collector) =>
        String(collector?._id ?? collector ?? "")
      ),
      ...(assignedPoint.responsableRecolector
        ? [String(assignedPoint.responsableRecolector?._id ?? assignedPoint.responsableRecolector)]
        : []),
    ]).filter(Boolean)
  );
  if (assignedCollectorIds.size !== 1) return "";

  const [soleCollectorId] = assignedCollectorIds;
  const isAssignedToPoint = (point.recolectores || []).some(
    (collector) => String(collector?._id ?? collector ?? "") === soleCollectorId
  ) || String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "")
    === soleCollectorId;
  return isAssignedToPoint ? soleCollectorId : "";
};

const findCampaignPrincipalPoint = (campaign, collectorId) => {
  const points = campaign?.puntosRecoleccion || [];
  const requestedId = String(collectorId ?? "");
  const explicitlyAssignedPoint = points.find(
    (point) =>
      String(point.responsableRecolector?._id ?? point.responsableRecolector ?? "")
      === requestedId
  );
  if (explicitlyAssignedPoint) return explicitlyAssignedPoint;

  return points.find(
    (point) => getCampaignPrincipalCollectorId(campaign, point) === requestedId
  ) || null;
};

const buildDeliveryInventory = (donations, campaign = null, classifications = []) => {
  const traces = [];
  const products = [];
  const groupedClassifications = new Map();
  const classificationById = new Map(
    classifications.map((classification) => [
      String(classification._id),
      classification,
    ])
  );
  const pointNameById = new Map(
    (campaign?.puntosRecoleccion || []).map((point) => [
      String(point._id),
      point.nombre || point.nombreEdificio || "",
    ])
  );

  for (const donation of donations) {
    const donationId = String(donation._id);
    traces.push({
      donacion: donation._id,
      clasificacionId: donation.clasificacionId || null,
      recolectorAsignado: donation.recolector || null,
      puntoRecoleccionRef: donation.puntoRecoleccionRef || null,
      estado: "entregada",
    });

    const sourceProducts = Array.isArray(donation.productosClasificados)
      && donation.productosClasificados.length
      ? donation.productosClasificados
      : [{
          categoria: donation.subcategoria || donation.categoria || "",
          producto: donation.nombreBien || "",
          nombreBien: donation.nombreBien || "",
          cantidad: donation.metadata?.cantidad,
        }];
    const pointId = donation.puntoRecoleccionRef
      ? String(donation.puntoRecoleccionRef)
      : "";
    const item = sourceProducts[0] || {};
    const classificationId = donation.clasificacionId
      ? String(donation.clasificacionId)
      : null;
    const classification = classificationId
      ? classificationById.get(classificationId)
      : null;
    const classificationName = String(
      classification?.nombre
      || item.categoria
      || donation.subcategoria
      || donation.categoria
      || ""
    ).trim();
    const rawQuantity = donation.metadata?.cantidad ?? donation.cantidad;
    const parsedQuantity = rawQuantity === null || rawQuantity === undefined
      || rawQuantity === ""
      ? null
      : Number(rawQuantity);
    const quantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0
      ? parsedQuantity
      : null;
    const row = {
      donacionId: donation._id,
      clasificacionId: donation.clasificacionId || null,
      clasificacionNombre: classificationName,
      puntoRecoleccionRef: donation.puntoRecoleccionRef || null,
      puntoRecoleccionNombre: pointNameById.get(pointId) || "",
      categoria: classificationName,
      subcategoria: String(item.producto || donation.subcategoria || "").trim(),
      nombreBien: String(donation.nombreBien || item.nombreBien || "").trim(),
      cantidad: quantity,
      donacionesSinCantidad: quantity === null ? 1 : 0,
      donaciones: [donation._id],
    };
    products.push(row);

    const classificationKey = classificationId
      || JSON.stringify([pointId, classificationName]);
    let summary = groupedClassifications.get(classificationKey);
    if (!summary) {
      summary = {
        clasificacionId: donation.clasificacionId || null,
        nombre: classificationName,
        cantidadTotal: 0,
        donacionesSinCantidad: 0,
        totalDonaciones: 0,
      };
      groupedClassifications.set(classificationKey, summary);
    }
    summary.totalDonaciones += 1;
    if (quantity === null) summary.donacionesSinCantidad += 1;
    else summary.cantidadTotal += quantity;
  }
  return {
    products,
    classifications: [...groupedClassifications.values()],
    traces,
  };
};

const buildDeliveryGoodsDescription = (products) =>
  products.map((product) => {
    const quantity = product.cantidad > 0
      ? `${product.cantidad} unidades`
      : "";
    const withoutQuantity = product.donacionesSinCantidad > 0
      ? `${product.donacionesSinCantidad} donación(es) sin cantidad registrada`
      : "";
    const quantities = [quantity, withoutQuantity].filter(Boolean).join("; ");
    const classification = [
      product.clasificacionNombre || product.categoria,
      product.subcategoria,
      product.nombreBien,
    ].filter(Boolean).join(" / ");
    return quantities ? `${classification}: ${quantities}` : classification;
  }).filter(Boolean).join("\n");

const getCampaignDeliveryReadiness = async ({
  campaign,
  collectorId,
  donationModel = Donacion,
  deliveryModel = EntregaCampana,
  collectorModel = Recolector,
  session = null,
}) => {
  const withSession = (query) => session ? query.session(session) : query;
  const [collector, existingDelivery, allDonations] = await Promise.all([
    withSession(collectorModel.findOne({
      _id: collectorId,
      status: { $ne: false },
      aprobado: { $ne: false },
      confirmEmail: true,
    })),
    withSession(deliveryModel.findOne({ campana: campaign._id })),
    withSession(donationModel.find({ campana: campaign._id })).lean(),
  ]);
  const eligibility = calcularPuedeEntregar(
    campaign,
    { _id: collectorId },
    allDonations,
    existingDelivery
  );
  const donations = eligibility.donations;
  const donacionesPendientes = donations.filter(
    (donation) => normalizeDonationState(donation.estado) !== "enentrega"
  );
  const donacionesSinClasificacion = donations.filter(
    (donation) => !donation.clasificacionId
  ).length;
  const habilitado = Boolean(collector);
  const entregaRegistrada = eligibility.yaEntregada;
  const esRecolectorPrincipal = eligibility.esPrincipal;
  const campanaFinalizada = eligibility.finalizada;
  if (process.env.CAMPAIGN_DELIVERY_DEBUG === "true") {
    console.info("Estado de elegibilidad de entrega de campaña:", {
      campanaId: String(campaign._id),
      userId: String(collectorId),
      esPrincipal: eligibility.esPrincipal,
      finalizada: eligibility.finalizada,
      todasEnEntrega: eligibility.todasEnEntrega,
      totalDonaciones: eligibility.totalDonaciones,
      enEntrega: eligibility.enEntrega,
      estadosNoEntrega: eligibility.estadosNoEntrega,
      yaEntregada: eligibility.yaEntregada,
    });
  }

  return {
    esRecolectorPrincipal,
    campanaFinalizada,
    recolectorHabilitado: habilitado,
    todasEnEntrega: eligibility.todasEnEntrega,
    totalDonaciones: donations.length,
    donacionesPendientes: donacionesPendientes.length,
    donacionesSinClasificacion,
    entregaRegistrada,
    puedeEntregar: eligibility.puedeEntregar,
    puedeRegistrarEntrega:
      habilitado
      && eligibility.puedeEntregar
      && donacionesSinClasificacion === 0,
    debug: {
      esPrincipal: eligibility.esPrincipal,
      finalizada: eligibility.finalizada,
      todasEnEntrega: eligibility.todasEnEntrega,
      totalDonaciones: eligibility.totalDonaciones,
      enEntrega: eligibility.enEntrega,
      estadosNoEntrega: eligibility.estadosNoEntrega,
      yaEntregada: eligibility.yaEntregada,
    },
    puntoRecoleccionRef: eligibility.puntoRecoleccionRef,
    donations,
  };
};

const createCampaignDelivery = async ({
  campaignId,
  collectorId,
  receptor,
  nombresReceptor = "",
  apellidosReceptor = "",
  recibeIdentificacion = "",
  recibeInstitucion = "",
  telefonoReceptor = "",
  cargoReceptor = "",
  observacion = "",
  descripcionBienes = "",
  fechaEntrega,
  evidencias,
  campaignModel = Campana,
  donationModel = Donacion,
  deliveryModel = EntregaCampana,
  collectorModel = Recolector,
  classificationModel = Clasificacion,
  sessionFactory = () => mongoose.startSession(),
}) => {
  const session = await sessionFactory();
  let result;

  try {
    await session.withTransaction(async () => {
      const campaign = await campaignModel.findById(campaignId).session(session);
      if (!campaign) throw deliveryError("La campaña no existe", 404);

      const principalPoint = findCampaignPrincipalPoint(campaign, collectorId);
      if (!principalPoint) {
        throw deliveryError(
          "Solo el recolector principal de un punto de la campaña puede registrar la entrega",
          403
        );
      }
      if (!isCampaignFinished(campaign)) {
        throw deliveryError("La campaña todavía no ha finalizado");
      }

      const collector = await collectorModel.findOne({
        _id: collectorId,
        status: { $ne: false },
        aprobado: { $ne: false },
        confirmEmail: true,
      }).session(session);
      if (!collector) {
        throw deliveryError("El recolector principal no está habilitado", 403);
      }

      const existing = await deliveryModel.findOne({ campana: campaign._id }).session(session);
      if (existing) {
        throw deliveryError("La entrega general de esta campaña ya fue registrada");
      }
      const lock = await campaignModel.updateOne(
        { _id: campaign._id },
        { $inc: { assignmentVersion: 1 } },
        { session }
      );
      if ((lock.modifiedCount ?? lock.nModified) !== 1) {
        throw deliveryError("La campaña cambió durante el registro; vuelve a intentarlo");
      }

      const readiness = await getCampaignDeliveryReadiness({
        campaign,
        collectorId,
        donationModel,
        deliveryModel,
        collectorModel,
        session,
      });
      if (!readiness.totalDonaciones) {
        throw deliveryError("La campaña no tiene donaciones para entregar");
      }
      const missingClassification = readiness.donations.find(
        (donation) => !donation.clasificacionId
      );
      if (missingClassification) {
        throw deliveryError(
          `La donación ${missingClassification._id} no tiene una clasificación asociada`
        );
      }
      const notReady = readiness.donations.find(
        (donation) => normalizeDonationState(donation.estado) !== "enentrega"
      );
      if (notReady) {
        throw deliveryError(
          `No se puede registrar la entrega: la donación ${notReady._id} está en estado "${notReady.estado}" y debe estar en "en_entrega"`
        );
      }

      const classificationIds = [
        ...new Set(readiness.donations
          .map((donation) => donation.clasificacionId)
          .filter(Boolean)
          .map(String)),
      ];
      const classifications = classificationIds.length
        ? await classificationModel.find({
            _id: { $in: classificationIds },
          }).session(session).lean()
        : [];
      const classificationById = new Map(
        classifications.map((classification) => [
          String(classification._id),
          classification,
        ])
      );
      const invalidClassification = readiness.donations.find((donation) => {
        const classification = classificationById.get(String(donation.clasificacionId));
        return !classification
          || String(classification.campana) !== String(campaign._id)
          || String(classification.puntoRecoleccionRef)
            !== String(donation.puntoRecoleccionRef);
      });
      if (invalidClassification) {
        throw deliveryError(
          `La clasificación de la donación ${invalidClassification._id} no corresponde a su campaña y punto`
        );
      }
      const {
        products,
        classifications: classificationSummaries,
        traces,
      } = buildDeliveryInventory(readiness.donations, campaign, classifications);
      const goodsDescription = String(descripcionBienes).trim()
        || buildDeliveryGoodsDescription(products);
      const delivery = {
        campana: campaign._id,
        puntoRecoleccionRef: principalPoint._id,
        recolectorPrincipal: collectorId,
        recolectorPrincipalNombre: collector.nombre || "",
        recolectorPrincipalApellido: collector.apellido || "",
        receptor,
        nombresReceptor,
        apellidosReceptor,
        recibeIdentificacion,
        recibeInstitucion,
        telefonoReceptor,
        cargoReceptor,
        observacion: String(observacion || "").trim(),
        descripcionBienes: goodsDescription,
        fechaEntrega,
        responsablesCampana: (campaign.responsablesCampana || []).map((person) => ({
          responsableCampanaRef: person._id,
          nombreCompleto: person.nombreCompleto,
          cargo: person.cargo,
        })),
        productos: products,
        clasificaciones: classificationSummaries,
        donaciones: traces,
        evidencias,
        estado: "registrada",
      };
      const statusHistoryEntry = {
        estado: "entregada",
        responsable: collectorId,
        rolResponsable: "recolector",
        fecha: fechaEntrega,
        observaciones: "Entrega general de campaña",
      };
      const updatedDonations = await donationModel.updateMany(
        {
          _id: { $in: readiness.donations.map((donation) => donation._id) },
          campana: campaign._id,
          estado: "en_entrega",
        },
        {
          $set: { estado: "entregada" },
          $push: { historialEstados: statusHistoryEntry },
        },
        { session, runValidators: true }
      );
      if ((updatedDonations.modifiedCount ?? updatedDonations.nModified) !== readiness.donations.length) {
        throw deliveryError(
          "No se pudieron actualizar todas las donaciones a entregada; la entrega no fue registrada"
        );
      }
      const [created] = await deliveryModel.create([delivery], { session });
      result = created;
    });
    return result;
  } catch (error) {
    if (error.statusCode) throw error;
    if (
      error.code === 11000
      || error.hasErrorLabel?.("TransientTransactionError")
      || error.code === 112
      || error.code === 251
    ) {
      throw deliveryError(
        "La entrega de la campaña cambió concurrentemente; consulta su estado e inténtalo otra vez"
      );
    }
    if (
      error.code === 20
      || error.codeName === "IllegalOperation"
      || /Transaction numbers are only allowed/i.test(error.message || "")
    ) {
      throw Object.assign(
        new Error("Registrar la entrega requiere una instancia MongoDB compatible con transacciones"),
        { statusCode: 503 }
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export {
  buildDeliveryInventory,
  buildDeliveryGoodsDescription,
  getCampaignPrincipalCollectorId,
  findCampaignPrincipalPoint,
  isCampaignFinished,
  createCampaignDelivery,
  getCampaignDeliveryReadiness,
  normalizeDonationState,
  calcularPuedeEntregar,
};
