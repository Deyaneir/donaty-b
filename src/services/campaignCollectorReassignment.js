import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Recolector from "../models/Recolector.js";

const reassignmentError = (message) =>
  Object.assign(new Error(message), { statusCode: 409 });

const historyWithTransferredDonations = (history, entryId, donations) =>
  history.map((entry) => {
    const source = entry && typeof entry.toObject === "function"
      ? entry.toObject()
      : entry;
    return String(source._id) === String(entryId)
      ? {
          ...source,
          donacionesTransferidas: donations.map(({ _id, estado }) => ({
            donacion: _id,
            estado,
          })),
        }
      : source;
  });

const transferCampaignCollectorDonations = async ({
  campaign,
  points,
  history,
  historyEntryId,
  previousCollectorId,
  nextCollectorId,
  pointId,
  administratorId,
  motive,
  campaignModel = Campana,
  donationModel = Donacion,
  collectorModel = Recolector,
  validateAssignableCollectors,
  reserveCollectorsForCampaign,
  sessionFactory = () => mongoose.startSession(),
}) => {
  const session = await sessionFactory();
  let result = null;
  const reassignedAt = history.find(
    (entry) => String(entry._id) === String(historyEntryId)
  )?.fecha || new Date();

  try {
    await session.withTransaction(async () => {
      const currentCampaign = await campaignModel.findById(campaign._id)
        .session(session);
      if (!currentCampaign) {
        throw reassignmentError("La campaña no existe");
      }
      if ((currentCampaign.__v || 0) !== (campaign.__v || 0)) {
        throw reassignmentError(
          "La campaña cambió durante la reasignación; vuelve a consultar e inténtalo otra vez"
        );
      }
      const currentPoint = currentCampaign.puntosRecoleccion.find(
        (point) => String(point._id) === String(pointId)
      );
      const currentPointCollectorIds = [
        ...(currentPoint?.recolectores || []).map((id) => String(id?._id ?? id)),
        ...(currentPoint?.responsableRecolector
          ? [String(currentPoint.responsableRecolector?._id ?? currentPoint.responsableRecolector)]
          : []),
      ];
      if (
        !currentPoint
        || currentPoint.activo === false
        || String(currentPoint.estado || "").toLowerCase() === "inactivo"
        || !currentPointCollectorIds.includes(String(previousCollectorId))
      ) {
        throw reassignmentError(
          "El recolector sustituido ya no está asignado al punto activo de esta campaña"
        );
      }
      if (validateAssignableCollectors) {
        await validateAssignableCollectors([nextCollectorId], { session });
      }

      const donations = await donationModel.find({
        campana: campaign._id,
        puntoRecoleccionRef: pointId,
        recolector: previousCollectorId,
      })
        .select("_id estado")
        .session(session)
        .lean();

      if (reserveCollectorsForCampaign) {
        await reserveCollectorsForCampaign(
          { ...currentCampaign.toObject(), puntosRecoleccion: points },
          [nextCollectorId],
          { session }
        );
      }

      const updatedCampaign = await campaignModel.findOneAndUpdate(
        {
          _id: campaign._id,
          $or: [
            { __v: campaign.__v || 0 },
            { __v: { $exists: false } },
          ],
        },
        {
          $set: {
            puntosRecoleccion: points,
            historialAsignacionesRecolectores: historyWithTransferredDonations(
              history,
              historyEntryId,
              donations
            ),
          },
          $inc: { __v: 1 },
        },
        { new: true, runValidators: true, session }
      );
      if (!updatedCampaign) {
        throw reassignmentError(
          "La campaña cambió durante la reasignación; no se modificó ninguna asignación"
        );
      }

      if (donations.length) {
        const updates = await donationModel.bulkWrite(
          donations.map(({ _id, estado }) => ({
            updateOne: {
              filter: {
                _id,
                campana: campaign._id,
                puntoRecoleccionRef: pointId,
                recolector: previousCollectorId,
                estado,
              },
              update: {
                $set: { recolector: nextCollectorId },
                $push: {
                  historialRecolectores: {
                    recolectorAnterior: previousCollectorId,
                    recolectorNuevo: nextCollectorId,
                    puntoRecoleccionAnterior: pointId,
                    puntoRecoleccionNuevo: pointId,
                    estado,
                    administrador: administratorId,
                    fecha: reassignedAt,
                    motivo: motive,
                  },
                },
              },
            },
          })),
          { session, ordered: true }
        );
        if (updates.matchedCount !== donations.length) {
          throw reassignmentError(
            "Una o más donaciones cambiaron durante la reasignación; no se transfirió ninguna"
          );
        }
      }

      await collectorModel.updateOne(
        {
          _id: previousCollectorId,
          "reservasHorarioCampanas.campana": campaign._id,
        },
        {
          $pull: { reservasHorarioCampanas: { campana: campaign._id } },
          $inc: { versionReservasHorario: 1 },
        },
        { session }
      );
      await collectorModel.updateOne(
        { _id: previousCollectorId, campanaReservada: campaign._id },
        { $set: { campanaReservada: null } },
        { session }
      );

      result = { campaign: updatedCampaign, donations };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export { transferCampaignCollectorDonations };
