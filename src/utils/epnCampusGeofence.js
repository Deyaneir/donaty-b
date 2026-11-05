// Boundary from OpenStreetMap way 31135336 (EPN campus), under ODbL 1.0.
const EPN_CAMPUS_BOUNDARY = [
  [-0.2111387, -78.4923210],
  [-0.2117010, -78.4919108],
  [-0.2119905, -78.4922099],
  [-0.2120039, -78.4921953],
  [-0.2120190, -78.4921743],
  [-0.2121089, -78.4920582],
  [-0.2121426, -78.4920139],
  [-0.2121731, -78.4919739],
  [-0.2123251, -78.4917815],
  [-0.2124349, -78.4914995],
  [-0.2124992, -78.4911919],
  [-0.2125413, -78.4906325],
  [-0.2125717, -78.4902921],
  [-0.2125989, -78.4898993],
  [-0.2126378, -78.4893390],
  [-0.2126310, -78.4891676],
  [-0.2125891, -78.4890615],
  [-0.2124488, -78.4889062],
  [-0.2123189, -78.4887405],
  [-0.2122385, -78.4886463],
  [-0.2119456, -78.4884546],
  [-0.2112817, -78.4881060],
  [-0.2090622, -78.4862273],
  [-0.2087988, -78.4865454],
  [-0.2085993, -78.4867766],
  [-0.2084579, -78.4866434],
  [-0.2083026, -78.4867714],
  [-0.2084689, -78.4868900],
  [-0.2086431, -78.4870762],
  [-0.2087727, -78.4872416],
  [-0.2091034, -78.4876781],
  [-0.2093082, -78.4879485],
  [-0.2094159, -78.4878803],
  [-0.2094987, -78.4879044],
  [-0.2095818, -78.4879983],
  [-0.2094262, -78.4880895],
  [-0.2092948, -78.4882343],
  [-0.2091565, -78.4884005],
  [-0.2094981, -78.4889704],
  [-0.2088444, -78.4893852],
  [-0.2088218, -78.4894070],
  [-0.2087999, -78.4894281],
  [-0.2094145, -78.4903470],
  [-0.2097933, -78.4904039],
  [-0.2107646, -78.4905255],
  [-0.2108430, -78.4905641],
  [-0.2109187, -78.4906303],
  [-0.2110011, -78.4907330],
  [-0.2110256, -78.4908231],
  [-0.2110044, -78.4911187],
  [-0.2109477, -78.4920836],
  [-0.2110084, -78.4921696],
];

const isInsideEpnCampus = (latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  let inside = false;

  for (let index = 0; index < EPN_CAMPUS_BOUNDARY.length; index += 1) {
    const [startLatitude, startLongitude] = EPN_CAMPUS_BOUNDARY[index];
    const [endLatitude, endLongitude] =
      EPN_CAMPUS_BOUNDARY[(index + 1) % EPN_CAMPUS_BOUNDARY.length];
    const crossProduct =
      (latitude - startLatitude) * (endLongitude - startLongitude)
      - (longitude - startLongitude) * (endLatitude - startLatitude);
    if (
      Math.abs(crossProduct) <= 1e-10
      && latitude >= Math.min(startLatitude, endLatitude) - 1e-10
      && latitude <= Math.max(startLatitude, endLatitude) + 1e-10
      && longitude >= Math.min(startLongitude, endLongitude) - 1e-10
      && longitude <= Math.max(startLongitude, endLongitude) + 1e-10
    ) {
      return true;
    }

    if ((startLatitude > latitude) !== (endLatitude > latitude)) {
      const crossingLongitude =
        ((endLongitude - startLongitude)
          * (latitude - startLatitude)
          / (endLatitude - startLatitude))
        + startLongitude;
      if (longitude < crossingLongitude) inside = !inside;
    }
  }

  return inside;
};

export { EPN_CAMPUS_BOUNDARY, isInsideEpnCampus };
