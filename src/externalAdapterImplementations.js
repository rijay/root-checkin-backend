const { createFulfillmentImplementation } = require("./fulfillmentHttpAdapter");
const { createWeworkContactImplementation } = require("./weworkContactAdapter");
const { createYouzanOrderImplementation } = require("./youzanOpenAdapter");

function createDefaultAdapterImplementations(env = process.env, options = {}) {
  const implementations = { ...(options.adapterImplementations || {}) };
  if (!implementations.YOUZAN_OPEN && env.YOUZAN_ORDER_LIST_URL && env.YOUZAN_ACCESS_TOKEN) {
    implementations.YOUZAN_OPEN = createYouzanOrderImplementation({ fetchImpl: options.fetchImpl });
  }
  if (!implementations.FULFILLMENT_PUSH && env.ROOT_FULFILLMENT_LIST_URL && env.ROOT_FULFILLMENT_SECRET) {
    implementations.FULFILLMENT_PUSH = createFulfillmentImplementation({ fetchImpl: options.fetchImpl });
  }
  if (
    !implementations.WEWORK_CONTACT
    && env.WEWORK_CONTACT_LIST_URL
    && (env.WEWORK_CONTACT_SECRET || env.WEWORK_CONTACT_ACCESS_TOKEN || env.WEWORK_ACCESS_TOKEN)
  ) {
    implementations.WEWORK_CONTACT = createWeworkContactImplementation({ fetchImpl: options.fetchImpl });
  }
  return implementations;
}

module.exports = {
  createDefaultAdapterImplementations,
};
