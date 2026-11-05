import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Campana from "../models/Campana.js";
import Donacion from "../models/Donacion.js";
import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";

const COMPLETED_STATES = ["entregada", "devuelta", "cancelada"];
const PENDING_STATES = ["pendiente"];

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const periodRange = (period) => {
  const normalized = String(period || "all").toLowerCase();
  if (normalized === "all") return {};
  const days = normalized === "7d" ? 7 : normalized === "30d" ? 30 : normalized === "3m" ? 90 : null;
  if (!days) return {};
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { $gte: from, $lte: new Date() };
};

const buildDateMatch = ({ period, from, to }) => {
  const range = periodRange(period);
  const explicitFrom = parseDate(from);
  const explicitTo = parseDate(to);
  if (explicitFrom) range.$gte = explicitFrom;
  if (explicitTo) range.$lte = explicitTo;
  return Object.keys(range).length ? { createdAt: range } : {};
};

const numberValue = (value) => Number(value || 0);

const aggregateDonationStats = async (match, campaignId = null) => {
  const campaignMatch = campaignId
    ? { ...match, campana: new mongoose.Types.ObjectId(campaignId) }
    : match;
  const [totals, byState, byCategory, evolution] = await Promise.all([
    Donacion.aggregate([
      { $match: campaignMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $in: ["$estado", COMPLETED_STATES] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $in: ["$estado", PENDING_STATES] }, 1, 0] },
          },
          inProcess: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $not: [{ $in: ["$estado", COMPLETED_STATES] }] },
                    { $not: [{ $in: ["$estado", PENDING_STATES] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Donacion.aggregate([
      { $match: campaignMatch },
      { $group: { _id: "$estado", total: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Donacion.aggregate([
      { $match: campaignMatch },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: [{ $ifNull: ["$categoria", ""] }, ""] },
              "Sin categoría",
              "$categoria",
            ],
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { total: -1, _id: 1 } },
    ]),
    Donacion.aggregate([
      { $match: campaignMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const total = totals[0] || {};
  return {
    totals: {
      total: numberValue(total.total),
      completed: numberValue(total.completed),
      pending: numberValue(total.pending),
      inProcess: numberValue(total.inProcess),
    },
    byState: byState.map((item) => ({ label: item._id || "Sin estado", total: item.total })),
    byCategory: byCategory.map((item) => ({ label: item._id, total: item.total })),
    evolution: evolution.map((item) => ({ label: item._id, total: item.total })),
  };
};

const getActiveUsers = async () => {
  const [donantes, recolectores, admins] = await Promise.all([
    Donante.countDocuments({ status: { $ne: false } }),
    Recolector.countDocuments({ status: { $ne: false } }),
    Admin.countDocuments({ status: { $ne: false } }),
  ]);
  return donantes + recolectores + admins;
};

const getCampaignSummaries = async () => {
  const campaigns = await Campana.find()
    .select("nombre descripcion imagenUrl fechaInicio fechaFin activa metaDonaciones createdAt")
    .sort({ createdAt: -1 })
    .lean();
  const donationCounts = await Donacion.aggregate([
    { $match: { campana: { $ne: null } } },
    {
      $group: {
        _id: "$campana",
        total: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $in: ["$estado", COMPLETED_STATES] }, 1, 0] },
        },
      },
    },
  ]);
  const byCampaign = new Map(donationCounts.map((item) => [String(item._id), item]));
  return campaigns.map((campaign) => {
    const counts = byCampaign.get(String(campaign._id)) || {};
    return {
      ...campaign,
      totalDonaciones: numberValue(counts.total),
      donacionesCompletadas: numberValue(counts.completed),
    };
  });
};

const getDashboardStats = async (req, res) => {
  try {
    const match = buildDateMatch(req.query || {});
    const [donationStats, activeUsers, activeCampaigns, campaigns] = await Promise.all([
      aggregateDonationStats(match),
      getActiveUsers(),
      Campana.countDocuments({ activa: true }),
      getCampaignSummaries(),
    ]);

    return res.status(200).json({
      totals: {
        ...donationStats.totals,
        activeUsers,
        activeCampaigns,
        finalized: donationStats.totals.completed,
      },
      byState: donationStats.byState,
      byCategory: donationStats.byCategory,
      evolution: donationStats.evolution,
      campaigns,
      rango: {
        period: req.query?.period || "all",
        from: req.query?.from || null,
        to: req.query?.to || null,
      },
    });
  } catch (error) {
    console.error("Error al consultar estadísticas generales:", error);
    return res.status(500).json({ msg: "Error al consultar las estadísticas generales" });
  }
};

const getCampaignStats = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "El identificador de la campaña no es válido" });
    }
    const campaign = await Campana.findById(id)
      .select("nombre descripcion imagenUrl fechaInicio fechaFin activa metaDonaciones createdAt")
      .lean();
    if (!campaign) return res.status(404).json({ msg: "La campaña no existe" });

    const [stats, totalDonaciones] = await Promise.all([
      aggregateDonationStats(buildDateMatch(req.query || {}), id),
      Donacion.countDocuments({ campana: id }),
    ]);
    return res.status(200).json({
      campaign: { ...campaign, totalDonaciones },
      ...stats,
      meta: null,
      rango: {
        period: req.query?.period || "all",
        from: req.query?.from || null,
        to: req.query?.to || null,
      },
    });
  } catch (error) {
    console.error("Error al consultar estadísticas de campaña:", error);
    return res.status(500).json({ msg: "Error al consultar las estadísticas de la campaña" });
  }
};

export { getCampaignStats, getDashboardStats };
