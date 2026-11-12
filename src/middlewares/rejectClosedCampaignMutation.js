import mongoose from "mongoose";
import Campana from "../models/Campana.js";
import Categoria from "../models/Categoria.js";
import Donacion from "../models/Donacion.js";
import EntregaCampana from "../models/EntregaCampana.js";
import { isCampaignFinished } from "../services/campaignDelivery.js";

const isCampaignLocked = (campaign, deliveryExists, now = new Date()) =>
  Boolean(deliveryExists && isCampaignFinished(campaign, now));

const rejectClosedCampaignMutation = (source) => async (req, res, next) => {
  try {
    let campaignId = req.params?.campaignId
      || req.params?.campanaId
      || req.body?.campanaId
      || req.body?.campana;

    if (source === "campaign") {
      campaignId = req.params?.campaignId
        || req.params?.campanaId
        || req.params?.id;
    } else if (source === "donation" && req.params?.id) {
      if (!mongoose.isValidObjectId(req.params.id)) return next();
      const donation = await Donacion.findById(req.params.id)
        .select("campana")
        .lean();
      campaignId = donation?.campana;
    } else if (source === "category" && req.params?.id) {
      if (!mongoose.isValidObjectId(req.params.id)) return next();
      const category = await Categoria.findById(req.params.id)
        .select("campana")
        .lean();
      campaignId = category?.campana;
    }

    if (!campaignId) return next();
    if (!mongoose.isValidObjectId(campaignId)) return next();
    const campaign = await Campana.findById(campaignId)
      .select("_id estado activa fechaFin horaFin")
      .lean();
    if (!campaign) return next();
    const deliveryExists = await EntregaCampana.exists({ campana: campaign._id });
    if (isCampaignLocked(campaign, deliveryExists)) {
      return res.status(409).json({
        msg: "La campaña está cerrada porque su entrega ya fue registrada; no se permiten modificaciones",
      });
    }
    return next();
  } catch (error) {
    console.error("Error validando el cierre de campaña:", error.message || error);
    return res.status(500).json({
      msg: "No se pudo validar si la campaña permite modificaciones",
    });
  }
};

export { isCampaignLocked };
export default rejectClosedCampaignMutation;
