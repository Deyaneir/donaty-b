import Donacion from "../models/Donacion.js";

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildDateMatch = (from, to) => {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start && !end) return {};
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return { createdAt: range };
};

const getDashboardStats = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const match = buildDateMatch(from, to);

    const totalsPipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          dinero: {
            $sum: { $cond: [{ $eq: ["$tipo", "dinero"] }, 1, 0] },
          },
          fisica: {
            $sum: { $cond: [{ $eq: ["$tipo", "fisica"] }, 1, 0] },
          },
          dineroPagado: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$tipo", "dinero"] },
                    { $eq: ["$estado", "pagado"] },
                  ],
                },
                "$monto",
                0,
              ],
            },
          },
          dineroPendiente: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$tipo", "dinero"] },
                    { $eq: ["$estado", "pendiente"] },
                  ],
                },
                "$monto",
                0,
              ],
            },
          },
        },
      },
    ];

    const estadoPipeline = [
      { $match: match },
      { $group: { _id: "$estado", total: { $sum: 1 } } },
    ];

    const tipoPipeline = [
      { $match: match },
      { $group: { _id: "$tipo", total: { $sum: 1 } } },
    ];

    const porMesPipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" },
          },
          total: { $sum: 1 },
          dinero: {
            $sum: { $cond: [{ $eq: ["$tipo", "dinero"] }, 1, 0] },
          },
          fisica: {
            $sum: { $cond: [{ $eq: ["$tipo", "fisica"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const [totalsAgg, estadoAgg, tipoAgg, porMesAgg] = await Promise.all([
      Donacion.aggregate(totalsPipeline),
      Donacion.aggregate(estadoPipeline),
      Donacion.aggregate(tipoPipeline),
      Donacion.aggregate(porMesPipeline),
    ]);

    const totals = totalsAgg[0] || {
      total: 0,
      dinero: 0,
      fisica: 0,
      dineroPagado: 0,
      dineroPendiente: 0,
    };

    const estado = {
      pendiente: 0,
      pagado: 0,
      asignada: 0,
      entregada: 0,
      cancelada: 0,
    };
    estadoAgg.forEach((item) => {
      if (item?._id) estado[item._id] = item.total;
    });

    const tipo = { dinero: 0, fisica: 0 };
    tipoAgg.forEach((item) => {
      if (item?._id) tipo[item._id] = item.total;
    });

    const porMes = porMesAgg.map((item) => ({
      mes: item._id,
      total: item.total,
      dinero: item.dinero,
      fisica: item.fisica,
    }));

    return res.status(200).json({
      totals,
      estado,
      tipo,
      porMes,
      rango: { from: from || null, to: to || null },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: `❌ Error en el servidor - ${error}` });
  }
};

export { getDashboardStats };
