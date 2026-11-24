const DONATION_STATUS_LABELS = {
  pendiente: "Pendiente de asignación",
  pagado: "Pagado",
  asignada: "Asignada",
  pendiente_recoleccion: "Pendiente de recolección",
  recolectada: "Recolectada",
  clasificada: "Clasificada",
  en_entrega: "En entrega",
  entregada: "Entregada",
  cancelada: "Cancelada",
  devolucion: "Devolución",
  devuelta: "Devuelta",
};

const donationStatusLabel = (status) =>
  DONATION_STATUS_LABELS[String(status || "").trim().toLowerCase()] || String(status || "");

export { DONATION_STATUS_LABELS, donationStatusLabel };
