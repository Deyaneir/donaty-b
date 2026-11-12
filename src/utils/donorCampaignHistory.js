import Donacion from "../models/Donacion.js";

const listDonatedCampaignIds = async (donorId) => {
  if (!donorId) return [];
  return Donacion.distinct("campana", {
    donante: donorId,
    campana: { $ne: null },
  });
};

const donorHasCampaignDonations = async (donorId, campaignId) => {
  if (!donorId || !campaignId) return false;
  return Boolean(await Donacion.exists({
    donante: donorId,
    campana: campaignId,
  }));
};

export { donorHasCampaignDonations, listDonatedCampaignIds };
