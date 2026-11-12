const getAcademicPeriodStartMonth = () => {
  const raw = process.env.ACADEMIC_PERIOD_B_START_MONTH;
  if (raw === undefined || raw === "") return 7;
  const configured = Number(raw);
  if (!Number.isInteger(configured) || configured < 2 || configured > 12) {
    throw new Error("ACADEMIC_PERIOD_B_START_MONTH debe ser un mes entero entre 2 y 12");
  }
  return configured;
};

const resolveAcademicPeriod = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("La fecha no permite determinar el período académico");
    error.statusCode = 400;
    throw error;
  }
  const half = date.getUTCMonth() + 1 >= getAcademicPeriodStartMonth() ? "B" : "A";
  return `${date.getUTCFullYear()}-${half}`;
};

export { getAcademicPeriodStartMonth, resolveAcademicPeriod };
