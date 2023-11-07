const Auth = {};

// A valid user will have exactly one of the following identification fields: id, username, or email
const userValidator = (user) => {
  check(user, {
    id: Match.Optional(String),
    username: Match.Optional(String),
    email: Match.Optional(String),
  });

  if (Object.keys(user).length !== 1) {
    throw new Match.Error("User must have exactly one identifier field");
  }

  return true;
};

// A password can be either in plain text or hashed
const passwordValidator = Match.OneOf(String, {
  digest: String,
  algorithm: String,
});

// Return a MongoDB query selector for finding the given user
const getUserQuerySelector = (user) => {
  if (user.id) {
    return { _id: user.id };
  } else if (user.username) {
    return { username: user.username };
  } else if (user.email) {
    return { "emails.address": user.email };
  }

  // We shouldn't be here if the user object was properly validated
  throw new Error("Cannot create selector from invalid user");
};

// Log a user in with their password
Auth.loginWithPassword = (user, password) => {
  if (!user || !password) {
    throw new Meteor.Error(401, "Unauthorized");
  }

  // Validate the login input types
  check(user, userValidator);
  check(password, passwordValidator);

  // Retrieve the user from the database
  const authenticatingUserSelector = getUserQuerySelector(user);
  const authenticatingUser = Meteor.users.findOne(authenticatingUserSelector);

  if (!authenticatingUser) {
    throw new Meteor.Error(401, "Unauthorized");
  }
  if (!authenticatingUser.services?.password) {
    throw new Meteor.Error(401, "Unauthorized");
  }

  // Authenticate the user's password
  const passwordVerification = Accounts._checkPassword(
    authenticatingUser,
    password
  );
  if (passwordVerification.error) {
    throw new Meteor.Error(401, "Unauthorized");
  }

  // Add a new auth token to the user's account
  const authToken = Accounts._generateStampedLoginToken();
  const hashedToken = Accounts._hashLoginToken(authToken.token);
  Accounts._insertHashedLoginToken(authenticatingUser._id, { hashedToken });

  return { authToken: authToken.token, userId: authenticatingUser._id };
};

// Export Auth for use elsewhere
export { Auth };
