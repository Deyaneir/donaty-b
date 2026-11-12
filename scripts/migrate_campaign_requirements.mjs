import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import Campana from "../src/models/Campana.js";
import Clasificacion from "../src/models/Clasificacion.js";
import CollectorLocation from "../src/models/CollectorLocation.js";
import Donacion from "../src/models/Donacion.js";
import EntregaCampana from "../src/models/EntregaCampana.js";
import Recolector from "../src/models/Recolector.js";
import { buildDeliveryInventory } from "../src/services/campaignDelivery.js";
import { normalizeClassificationName } from "../src/services/donationClassifications.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDirectory, "..", ".env") });

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/donaty";

try {
  await mongoose.connect(uri);
  await Promise.all([
    Clasificacion.createIndexes(),
    CollectorLocation.createIndexes(),
    Donacion.createIndexes(),
  ]);

  let assigned = 0;
  let skipped = 0;
  const donations = Donacion.find({
    estado: { $in: ["clasificada", "en_entrega", "entregada"] },
    campana: { $type: "objectId" },
    puntoRecoleccionRef: { $type: "objectId" },
    $or: [
      { clasificacionId: null },
      { clasificacionId: { $exists: false } },
    ],
  }).lean().cursor();

  for await (const donation of donations) {
    const name = String(
      donation.productosClasificados?.[0]?.categoria
      || donation.subcategoria
      || donation.categoria
      || ""
    ).trim();
    if (!name || name.length > 160) {
      skipped += 1;
      console.warn(
        `Donación ${donation._id} omitida: no tiene una clasificación migrable`
      );
      continue;
    }

    const classification = await Clasificacion.findOneAndUpdate(
      {
        campana: donation.campana,
        puntoRecoleccionRef: donation.puntoRecoleccionRef,
        nombreClave: normalizeClassificationName(name),
      },
      {
        $setOnInsert: {
          campana: donation.campana,
          puntoRecoleccionRef: donation.puntoRecoleccionRef,
          nombre,
          nombreClave: normalizeClassificationName(name),
        },
      },
      { new: true, upsert: true, runValidators: true }
    );
    const update = await Donacion.updateOne(
      {
        _id: donation._id,
        $or: [
          { clasificacionId: null },
          { clasificacionId: { $exists: false } },
        ],
      },
      { $set: { clasificacionId: classification._id } }
    );
    if (update.modifiedCount === 1) assigned += 1;
  }

  let deliveriesUpdated = 0;
  let deliveriesSkipped = 0;
  for await (const delivery of EntregaCampana.find().lean().cursor()) {
    const traces = delivery.donaciones || [];
    const donationIds = [
      ...new Set(traces
        .map((trace) => trace.donacion ? String(trace.donacion) : "")
        .filter(Boolean)),
    ];
    const sourceDonations = donationIds.length
      ? await Donacion.find({ _id: { $in: donationIds } }).lean()
      : [];
    if (
      donationIds.length !== traces.length
      || sourceDonations.length !== donationIds.length
      || sourceDonations.some((donation) => !donation.clasificacionId)
      || sourceDonations.some(
        (donation) => !["en_entrega", "entregada"].includes(donation.estado)
      )
    ) {
      deliveriesSkipped += 1;
      console.error(`Entrega ${delivery._id} omitida: donaciones o clasificaciones inválidas`);
      continue;
    }

    const campaign = await Campana.findById(delivery.campana)
      .select("_id puntosRecoleccion")
      .lean();
    const classificationIds = [
      ...new Set(sourceDonations.map((donation) => String(donation.clasificacionId))),
    ];
    const classifications = await Clasificacion.find({
      _id: { $in: classificationIds },
    }).lean();
    const classificationById = new Map(
      classifications.map((classification) => [
        String(classification._id),
        classification,
      ])
    );
    if (
      classifications.length !== classificationIds.length
      || sourceDonations.some((donation) => {
        const classification = classificationById.get(String(donation.clasificacionId));
        return !classification
          || String(classification.campana) !== String(delivery.campana)
          || String(classification.puntoRecoleccionRef)
            !== String(donation.puntoRecoleccionRef);
      })
    ) {
      deliveriesSkipped += 1;
      console.error(
        `Entrega ${delivery._id} omitida: no se encontró una clasificación`
      );
      continue;
    }

    const inventory = buildDeliveryInventory(
      sourceDonations,
      campaign,
      classifications
    );
    const pendingIds = sourceDonations
      .filter((donation) => donation.estado === "en_entrega")
      .map((donation) => donation._id);
    if (pendingIds.length) {
      const transitioned = await Donacion.updateMany(
        { _id: { $in: pendingIds }, campana: delivery.campana, estado: "en_entrega" },
        {
          $set: { estado: "entregada" },
          $push: {
            historialEstados: {
              estado: "entregada",
              responsable: delivery.recolectorPrincipal,
              rolResponsable: "recolector",
              fecha: delivery.fechaEntrega || delivery.createdAt || new Date(),
              observaciones: "Entrega general de campaña",
            },
          },
        }
      );
      if (transitioned.modifiedCount !== pendingIds.length) {
        throw new Error(
          `No se pudieron marcar como entregadas todas las donaciones de ${delivery._id}`
        );
      }
    }
    const principal = await Recolector.findById(delivery.recolectorPrincipal)
      .select("nombre apellido")
      .lean();
    const update = await EntregaCampana.updateOne(
      { _id: delivery._id },
      {
        $set: {
          productos: inventory.products,
          clasificaciones: inventory.classifications,
          donaciones: inventory.traces,
          ...(principal
            ? {
                recolectorPrincipalNombre: principal.nombre || "",
                recolectorPrincipalApellido: principal.apellido || "",
              }
            : {}),
        },
      }
    );
    if (update.matchedCount !== 1) {
      throw new Error(`No se pudo actualizar la entrega ${delivery._id}`);
    }
    deliveriesUpdated += 1;
  }

  console.log(
    `Migración terminada. Donaciones clasificadas vinculadas: ${assigned}; omitidas por falta de clasificación: ${skipped}; entregas actualizadas: ${deliveriesUpdated}; entregas omitidas: ${deliveriesSkipped}.`
  );
  if (skipped || deliveriesSkipped) process.exitCode = 1;
} catch (error) {
  console.error("No se pudo migrar la clasificación y el historial de ubicación:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
