// Shipment progress for shipped orders.
//
// For now this is SIMULATED from the order's dates: the prototype has no UPS
// account. The real source would be the UPS Tracking API, which needs a UPS
// developer account (client ID + secret) and a small server or serverless
// proxy to keep the secret hidden and make the calls. To switch, replace
// shipmentProgress() with one that returns the same shape from UPS data.
//
// Returns null for unshipped orders, otherwise:
//   { stage, text, simulated, trackingNumber, trackingUrl }
// stage: "missing" | "label-created" | "in-transit" | "out-for-delivery" | "delivered"

const TRACKING_SOURCE = "simulated";
const UPS_TRACK_PAGE = "https://www.ups.com/track?loc=en_US&tracknum=";

function shipmentProgress(o) {
  if (!o.shipped) return null;
  if (!o.trackingNumber) {
    return { stage: "missing", text: "Tracking # missing", simulated: false, trackingNumber: "", trackingUrl: "" };
  }

  // Where the package would be today, judging only by the dates.
  let stage;
  if (o.expectedLatest < TODAY) stage = "delivered";
  else if (isoDate(TODAY) === isoDate(o.expectedLatest)) stage = "out-for-delivery";
  else if (isoDate(TODAY) <= isoDate(o.shipDate)) stage = "label-created";
  else stage = "in-transit";

  const text = {
    "label-created": "Label created",
    "in-transit": "In transit",
    "out-for-delivery": "Out for delivery",
    delivered: "Delivered",
  }[stage];

  return {
    stage,
    text,
    simulated: TRACKING_SOURCE === "simulated",
    trackingNumber: o.trackingNumber,
    trackingUrl: UPS_TRACK_PAGE + encodeURIComponent(o.trackingNumber),
  };
}
