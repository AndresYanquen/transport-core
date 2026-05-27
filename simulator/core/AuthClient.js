class AuthClient {
  constructor({ apiClient, loginPath, password, logger }) {
    this.api = apiClient;
    this.loginPath = loginPath;
    this.password = password;
    this.logger = logger;
  }

  async login({ email }) {
    const { data } = await this.api.post(this.loginPath, {
      body: {
        email,
        password: this.password,
      },
    });

    if (!data?.token) {
      this.logger?.error?.("Login did not return token for ", email);
      const err = new Error("Login did not return token");
      err.details = data;
      throw err;
    }

    return data;
  }
}

module.exports = AuthClient;

