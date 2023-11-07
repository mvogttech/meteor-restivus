class Route {
  constructor(api, path, options = {}, endpoints) {
    this.api = api;
    this.path = path;
    this.options = options;
    this.endpoints = endpoints;

    // Check if endpoints were provided
    if (!this.endpoints) {
      this.endpoints = this.options;
      this.options = {};
    }
  }

  addToApi() {
    const availableMethods = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "options",
    ];
    const self = this;

    // Throw an error if a route has already been added at this path
    if (this.api._config.paths.includes(this.path)) {
      throw new Error(`Cannot add a route at an existing path: ${this.path}`);
    }

    // Override the default OPTIONS endpoint with our own
    this.endpoints = Object.assign(
      {},
      this.api._config.defaultOptionsEndpoint,
      this.endpoints
    );

    // Configure each endpoint on this route
    this._resolveEndpoints();
    this._configureEndpoints();

    // Add to our list of existing paths
    this.api._config.paths.push(this.path);

    const allowedMethods = availableMethods.filter((method) =>
      Object.keys(self.endpoints).includes(method)
    );
    const rejectedMethods = availableMethods.filter(
      (method) => !Object.keys(self.endpoints).includes(method)
    );

    // Setup endpoints on route
    const fullPath = this.api._config.apiPath + this.path;

    allowedMethods.forEach((method) => {
      const endpoint = self.endpoints[method];
      JsonRoutes.add(method, fullPath, (req, res) => {
        // Add function to endpoint context for indicating a response has been initiated manually
        let responseInitiated = false;
        const doneFunc = () => {
          responseInitiated = true;
        };

        const endpointContext = {
          urlParams: req.params,
          queryParams: req.query,
          bodyParams: req.body,
          request: req,
          response: res,
          done: doneFunc,
        };

        // Add endpoint config options to context
        Object.assign(endpointContext, endpoint);

        // Run the requested endpoint
        let responseData = null;
        try {
          responseData = self._callEndpoint(endpointContext, endpoint);
        } catch (error) {
          // Do exactly what Iron Router would have done, to avoid changing the API
          ironRouterSendErrorToResponse(error, req, res);
          return;
        }

        if (responseInitiated) {
          // Ensure the response is properly completed
          res.end();
          return;
        } else {
          if (res.headersSent) {
            throw new Error(
              `Must call this.done() after handling endpoint response manually: ${method} ${fullPath}`
            );
          } else if (responseData === null || responseData === undefined) {
            throw new Error(
              `Cannot return null or undefined from an endpoint: ${method} ${fullPath}`
            );
          }
        }

        // Generate and return the http response, handling the different endpoint response types
        if (
          responseData.body &&
          (responseData.statusCode || responseData.headers)
        ) {
          self._respond(
            res,
            responseData.body,
            responseData.statusCode,
            responseData.headers
          );
        } else {
          self._respond(res, responseData);
        }
      });
    });

    rejectedMethods.forEach((method) => {
      JsonRoutes.add(method, fullPath, (req, res) => {
        const responseData = {
          status: "error",
          message: "API endpoint does not exist",
        };
        const headers = { Allow: allowedMethods.join(", ").toUpperCase() };
        self._respond(res, responseData, 405, headers);
      });
    });
  }

  _resolveEndpoints() {
    Object.keys(this.endpoints).forEach((method) => {
      const endpoint = this.endpoints[method];
      if (typeof endpoint === "function") {
        this.endpoints[method] = { action: endpoint };
      }
    });
  }

  _configureEndpoints() {
    Object.keys(this.endpoints).forEach((method) => {
      if (method !== "options") {
        // Configure acceptable roles
        if (!this.options.roleRequired) {
          this.options.roleRequired = [];
        }
        if (!this.endpoints[method].roleRequired) {
          this.endpoints[method].roleRequired = [];
        }
        this.endpoints[method].roleRequired = [
          ...new Set([
            ...this.endpoints[method].roleRequired,
            ...this.options.roleRequired,
          ]),
        ];

        // Make it easier to check if no roles are required
        if (this.endpoints[method].roleRequired.length === 0) {
          this.endpoints[method].roleRequired = false;
        }

        // Configure auth requirement
        if (this.endpoints[method].authRequired === undefined) {
          this.endpoints[method].authRequired = Boolean(
            this.options.authRequired || this.endpoints[method].roleRequired
          );
        }
      }
    });
  }

  _callEndpoint(endpointContext, endpoint) {
    const auth = this._authAccepted(endpointContext, endpoint);
    if (auth.success) {
      if (this._roleAccepted(endpointContext, endpoint)) {
        return endpoint.action.call(endpointContext);
      } else {
        return {
          statusCode: 403,
          body: {
            status: "error",
            message: "You do not have permission to do this.",
          },
        };
      }
    } else {
      if (auth.data) {
        return auth.data;
      } else {
        return {
          statusCode: 401,
          body: {
            status: "error",
            message: "You must be logged in to do this.",
          },
        };
      }
    }
  }

  _authAccepted(endpointContext, endpoint) {
    if (endpoint.authRequired) {
      return this._authenticate(endpointContext);
    } else {
      return { success: true };
    }
  }

  _authenticate(endpointContext) {
    // Get auth info (pseudo-code, depends on the actual auth implementation)
    const auth = this.api._config.auth.user.call(endpointContext);

    if (!auth) {
      return { success: false };
    }

    // Get the user from the database (pseudo-code, depends on actual DB and auth implementation)
    let userSelector = {};
    if (auth.userId && auth.token && !auth.user) {
      userSelector._id = auth.userId;
      userSelector[this.api._config.auth.token] = auth.token;
      auth.user = Meteor.users.findOne(userSelector); // Replace with actual data retrieval logic
    }

    if (auth.error) {
      return { success: false, data: auth.error };
    }

    // Attach the user and their ID to the context if the authentication was successful
    if (auth.user) {
      endpointContext.user = auth.user;
      endpointContext.userId = auth.user._id;
      return { success: true, data: auth };
    } else {
      return { success: false };
    }
  }

  _roleAccepted(endpointContext, endpoint) {
    if (endpoint.roleRequired) {
      return endpoint.roleRequired.includes(endpointContext.user.roles);
    }
    return true;
  }

  _respond(response, body, statusCode = 200, headers = {}) {
    // Override any default headers that have been provided
    const defaultHeaders = this._lowerCaseKeys(this.api._config.defaultHeaders);
    headers = this._lowerCaseKeys(headers);
    headers = { ...defaultHeaders, ...headers };

    // Prepare JSON body for response when Content-Type indicates JSON type
    if (/json|javascript/.test(headers["content-type"])) {
      body = JSON.stringify(body, null, this.api._config.prettyJson ? 2 : 0);
    }

    // Send response
    const sendResponse = () => {
      response.writeHead(statusCode, headers);
      response.write(body);
      response.end();
    };

    if ([401, 403].includes(statusCode)) {
      const minimumDelayInMilliseconds = 500;
      const randomMultiplierBetweenOneAndTwo = 1 + Math.random();
      const delayInMilliseconds =
        minimumDelayInMilliseconds * randomMultiplierBetweenOneAndTwo;
      setTimeout(sendResponse, delayInMilliseconds);
    } else {
      sendResponse();
    }
  }

  _lowerCaseKeys(object) {
    return Object.keys(object).reduce((newObj, key) => {
      newObj[key.toLowerCase()] = object[key];
      return newObj;
    }, {});
  }
}

export default Route;
