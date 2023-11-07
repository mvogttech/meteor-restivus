class Restivus {
  constructor(options) {
    this._routes = [];
    this._config = {
      paths: [],
      useDefaultAuth: false,
      apiPath: "api/",
      version: null,
      prettyJson: false,
      auth: {
        token: "services.resume.loginTokens.hashedToken",
        user: () => {
          let token;
          if (this.request.headers["x-auth-token"]) {
            token = Accounts._hashLoginToken(
              this.request.headers["x-auth-token"]
            );
          }
          return {
            userId: this.request.headers["x-user-id"],
            token: token,
          };
        },
      },
      defaultHeaders: {
        "Content-Type": "application/json",
      },
      enableCors: true,
    };

    // Configure API with the given options
    Object.assign(this._config, options);

    if (this._config.enableCors) {
      let corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Origin, X-Requested-With, Content-Type, Accept",
      };

      if (this._config.useDefaultAuth) {
        corsHeaders["Access-Control-Allow-Headers"] +=
          ", X-User-Id, X-Auth-Token";
      }

      // Set default headers to enable CORS if configured
      Object.assign(this._config.defaultHeaders, corsHeaders);

      if (!this._config.defaultOptionsEndpoint) {
        this._config.defaultOptionsEndpoint = () => {
          this.response.writeHead(200, corsHeaders);
          this.done();
        };
      }
    }

    // Normalize the API path
    if (this._config.apiPath.startsWith("/")) {
      this._config.apiPath = this._config.apiPath.substring(1);
    }
    if (!this._config.apiPath.endsWith("/")) {
      this._config.apiPath += "/";
    }

    // URL path versioning is the only type of API versioning currently available, so if a version is provided, append it to the base path of the API
    if (this._config.version) {
      this._config.apiPath += `${this._config.version}/`;
    }

    // Add default login and logout endpoints if auth is configured
    if (this._config.useDefaultAuth || this._config.useAuth) {
      this._initAuth();
      if (this._config.useAuth) {
        console.warn(
          "Warning: useAuth API config option will be removed in Restivus v1.0\n" +
            "    Use the useDefaultAuth option instead"
        );
      }
    }

    return this;
  }

  addRoute(path, options, endpoints) {
    // Create a new route and add it to the list of existing routes
    let route = new share.Route(this, path, options, endpoints);
    this._routes.push(route);

    route.addToApi();

    return this;
  }

  addCollection(collection, options = {}) {
    let methods = ["get", "post", "put", "patch", "delete", "getAll"];
    let methodsOnCollection = ["post", "getAll"];

    // Grab the set of endpoints
    let collectionEndpoints =
      collection === Meteor.users
        ? this._userCollectionEndpoints()
        : this._collectionEndpoints();

    // Flatten the options and set defaults if necessary
    let endpointsAwaitingConfiguration = options.endpoints || {};
    let routeOptions = options.routeOptions || {};
    let excludedEndpoints = options.excludedEndpoints || [];
    // Use collection name as default path
    let path = options.path || collection._name;

    // Separate the requested endpoints by the route they belong to
    let collectionRouteEndpoints = {};
    let entityRouteEndpoints = {};

    if (
      Object.keys(endpointsAwaitingConfiguration).length === 0 &&
      excludedEndpoints.length === 0
    ) {
      // Generate all endpoints on this collection
      methods.forEach((method) => {
        if (methodsOnCollection.includes(method)) {
          Object.assign(
            collectionRouteEndpoints,
            collectionEndpoints[method](collection)
          );
        } else {
          Object.assign(
            entityRouteEndpoints,
            collectionEndpoints[method](collection)
          );
        }
      });
    } else {
      // Generate any endpoints that haven't been explicitly excluded
      methods.forEach((method) => {
        if (
          !excludedEndpoints.includes(method) &&
          endpointsAwaitingConfiguration[method] !== false
        ) {
          // Configure endpoint and map to its HTTP method
          let endpointOptions = endpointsAwaitingConfiguration[method];
          let configuredEndpoint = {};
          Object.entries(collectionEndpoints[method](collection)).forEach(
            ([methodType, action]) => {
              configuredEndpoint[methodType] = {
                ...action,
                ...endpointOptions,
              };
            }
          );

          // Partition the endpoints into their respective routes
          if (methodsOnCollection.includes(method)) {
            Object.assign(collectionRouteEndpoints, configuredEndpoint);
          } else {
            Object.assign(entityRouteEndpoints, configuredEndpoint);
          }
        }
      });
    }

    // Add the routes to the API
    this.addRoute(path, routeOptions, collectionRouteEndpoints);
    this.addRoute(`${path}/:id`, routeOptions, entityRouteEndpoints);

    return this;
  }

  _collectionEndpoints(collection) {
    return {
      get: {
        get: {
          action: () => {
            const entity = collection.findOne(this.urlParams.id);
            if (entity) {
              return { status: "success", data: entity };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "Item not found" },
              };
            }
          },
        },
      },
      put: {
        put: {
          action: () => {
            const entityIsUpdated = collection.update(
              this.urlParams.id,
              this.bodyParams
            );
            if (entityIsUpdated) {
              const entity = collection.findOne(this.urlParams.id);
              return { status: "success", data: entity };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "Item not found" },
              };
            }
          },
        },
      },
      patch: {
        patch: {
          action: () => {
            const entityIsUpdated = collection.update(this.urlParams.id, {
              $set: this.bodyParams,
            });
            if (entityIsUpdated) {
              const entity = collection.findOne(this.urlParams.id);
              return { status: "success", data: entity };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "Item not found" },
              };
            }
          },
        },
      },
      delete: {
        delete: {
          action: () => {
            if (collection.remove(this.urlParams.id)) {
              return { status: "success", data: { message: "Item removed" } };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "Item not found" },
              };
            }
          },
        },
      },
      post: {
        post: {
          action: () => {
            const entityId = collection.insert(this.bodyParams);
            const entity = collection.findOne(entityId);
            if (entity) {
              return {
                statusCode: 201,
                body: { status: "success", data: entity },
              };
            } else {
              return {
                statusCode: 400,
                body: { status: "fail", message: "No item added" },
              };
            }
          },
        },
      },
      getAll: {
        get: {
          action: () => {
            const entities = collection.find().fetch();
            if (entities) {
              return { status: "success", data: entities };
            } else {
              return {
                statusCode: 404,
                body: {
                  status: "fail",
                  message: "Unable to retrieve items from collection",
                },
              };
            }
          },
        },
      },
    };
  }

  _userCollectionEndpoints(collection) {
    return {
      get: {
        get: {
          action: () => {
            const entity = collection.findOne(this.urlParams.id, {
              fields: { profile: 1 },
            });
            if (entity) {
              return { status: "success", data: entity };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "User not found" },
              };
            }
          },
        },
      },
      put: {
        put: {
          action: () => {
            const entityIsUpdated = collection.update(this.urlParams.id, {
              $set: { profile: this.bodyParams },
            });
            if (entityIsUpdated) {
              const entity = collection.findOne(this.urlParams.id, {
                fields: { profile: 1 },
              });
              return { status: "success", data: entity };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "User not found" },
              };
            }
          },
        },
      },
      delete: {
        delete: {
          action: () => {
            if (collection.remove(this.urlParams.id)) {
              return { status: "success", data: { message: "User removed" } };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "User not found" },
              };
            }
          },
        },
      },
      post: {
        post: {
          action: () => {
            const entityId = Accounts.createUser(this.bodyParams);
            const entity = collection.findOne(entityId, {
              fields: { profile: 1 },
            });
            if (entity) {
              return {
                statusCode: 201,
                body: { status: "success", data: entity },
              };
            } else {
              return {
                statusCode: 400,
                body: { status: "fail", message: "No user added" },
              };
            }
          },
        },
      },
      getAll: {
        get: {
          action: () => {
            const entities = collection
              .find({}, { fields: { profile: 1 } })
              .fetch();
            if (entities) {
              return { status: "success", data: entities };
            } else {
              return {
                statusCode: 404,
                body: { status: "fail", message: "Unable to retrieve users" },
              };
            }
          },
        },
      },
    };
  }

  _initAuth() {
    const self = this;

    // Add a login endpoint to the API
    this.addRoute(
      "login",
      { authRequired: false },
      {
        post: function () {
          // Grab the username or email that the user is logging in with
          let user = {};
          if (this.bodyParams.user) {
            if (this.bodyParams.user.indexOf("@") === -1) {
              user.username = this.bodyParams.user;
            } else {
              user.email = this.bodyParams.user;
            }
          } else if (this.bodyParams.username) {
            user.username = this.bodyParams.username;
          } else if (this.bodyParams.email) {
            user.email = this.bodyParams.email;
          }

          let password = this.bodyParams.password;
          if (this.bodyParams.hashed) {
            password = {
              digest: password,
              algorithm: "sha-256",
            };
          }

          // Try to log the user into the user's account
          let auth;
          try {
            auth = Auth.loginWithPassword(user, password);
          } catch (e) {
            return {
              statusCode: e.error,
              body: { status: "error", message: e.reason },
            };
          }

          // Get the authenticated user
          if (auth.userId && auth.authToken) {
            let searchQuery = {};
            searchQuery[self._config.auth.token] = Accounts._hashLoginToken(
              auth.authToken
            );
            this.user = Meteor.users.findOne({
              _id: auth.userId,
              ...searchQuery,
            });
            this.userId = this.user ? this.user._id : null;
          }

          let response = { status: "success", data: auth };

          // Call the login hook with the authenticated user attached
          let extraData =
            self._config.onLoggedIn && self._config.onLoggedIn.call(this);
          if (extraData) {
            response.data.extra = extraData;
          }

          return response;
        },
      }
    );

    // Logout helper function
    const logout = function () {
      // Remove the given auth token from the user's account
      let authToken = this.request.headers["x-auth-token"];
      let hashedToken = Accounts._hashLoginToken(authToken);
      let tokenLocation = self._config.auth.token;
      let index = tokenLocation.lastIndexOf(".");
      let tokenPath = tokenLocation.substring(0, index);
      let tokenFieldName = tokenLocation.substring(index + 1);
      let tokenToRemove = {};
      tokenToRemove[tokenFieldName] = hashedToken;
      let tokenRemovalQuery = {};
      tokenRemovalQuery[tokenPath] = tokenToRemove;
      Meteor.users.update(this.user._id, { $pull: tokenRemovalQuery });

      let response = {
        status: "success",
        data: { message: "You've been logged out!" },
      };

      // Call the logout hook with the authenticated user attached
      let extraData =
        self._config.onLoggedOut && self._config.onLoggedOut.call(this);
      if (extraData) {
        response.data.extra = extraData;
      }

      return response;
    };

    // Add a logout endpoint to the API
    this.addRoute(
      "logout",
      { authRequired: true },
      {
        get: function () {
          console.warn(
            "Warning: Default logout via GET will be removed in Restivus v1.0. Use POST instead."
          );
          console.warn(
            "    See https://github.com/kahmali/meteor-restivus/issues/100"
          );
          return logout.call(this);
        },
        post: logout,
      }
    );
  }
}

// Export Restivus if using a module system
export default Restivus;
