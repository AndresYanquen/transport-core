const DriverAgent = require("./DriverAgent");
const { createLogger } = require("../utils/logger");

class DriverManager {
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
    const n = this.config.driverCount;
    this.logger.info(`[SIMULATOR] starting ${n} drivers`);

    const tasks = [];
    for (let id = 1; id <= n; id += 1) {
      const agentLogger = createLogger({
        level: "warn",
        prefix: `[DRIVER ${id}]`,
      });
      const api = this.apiClientFactory(agentLogger, this.abortController.signal);
      const auth = this.authClientFactory(api, agentLogger);
      const agent = new DriverAgent({
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
    }

    await Promise.allSettled(tasks);
  }

  stop() {
    this.logger.info("[SIMULATOR] stopping drivers");
    this.abortController.abort();
  }
}

module.exports = DriverManager;
