const CustomerAgent = require("./CustomerAgent");
const { createLogger } = require("../utils/logger");
const { sleep } = require("../utils/sleep");

class CustomerManager {
  constructor({ config, metrics, apiClientFactory, authClientFactory, abortController, logger }) {
    this.config = config;
    this.metrics = metrics;
    this.apiClientFactory = apiClientFactory;
    this.authClientFactory = authClientFactory;
    this.abortController = abortController;
    this.logger = logger;
    this.agents = [];
  }

  async start() {
    const n = this.config.customerCount;
    const concurrency = Math.max(1, this.config.maxConcurrentCustomers);
    this.logger.info(`[SIMULATOR] starting ${n} customers (maxConcurrent=${concurrency})`);

    const tasks = [];
    for (let id = 1; id <= n && !this.abortController.signal.aborted; id += 1) {
      const agentLogger = createLogger({
        level: "info",
        prefix: `[CUSTOMER ${id}]`,
      });

      const api = this.apiClientFactory(agentLogger, this.abortController.signal);
      const auth = this.authClientFactory(api, agentLogger);
      const agent = new CustomerAgent({
        id,
        config: this.config,
        apiClient: api,
        authClient: auth,
        metrics: this.metrics,
        logger: agentLogger,
        abortSignal: this.abortController.signal,
      });

      this.agents.push(agent);
      tasks.push(agent.run());

      if (id % concurrency === 0) {
        await sleep(250, this.abortController.signal).catch(() => {});
      }
    }

    const results = await Promise.allSettled(tasks);
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (isAbortResult(result)) continue;
      if (result.status === "rejected") {
        this.metrics.recordApiError(result.reason, {
          agentType: "customer",
          agentId: index + 1,
          phase: "agent_startup",
        });
      }
    }
    return results;
  }

  stop() {
    this.logger.info("[SIMULATOR] stopping customers");
    this.abortController.abort();
  }
}

function isAbortResult(result) {
  return (
    result?.status === "rejected" &&
    (result.reason?.code === "ABORT_ERR" || result.reason?.message === "Aborted")
  );
}

module.exports = CustomerManager;
