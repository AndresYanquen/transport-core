const CustomerAgent = require("./CustomerAgent");
const { createLogger } = require("../utils/logger");

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

    let nextId = 1;
    const runWorker = async () => {
      while (!this.abortController.signal.aborted && nextId <= n) {
        const id = nextId;
        nextId += 1;

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
        await agent.run();
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, n); i += 1) {
      workers.push(runWorker());
    }

    await Promise.allSettled(workers);
  }

  stop() {
    this.logger.info("[SIMULATOR] stopping customers");
    this.abortController.abort();
  }
}

module.exports = CustomerManager;
