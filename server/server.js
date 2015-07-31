'use strict';

var Referral = {};

var visitorIP;

// If you're running Meteor/Node behind a proxy, make sure the HTTP_FORWARDED_COUNT environment variable is set it to "1".
// Add 1 for each extra proxy. Also ensure that the web server sets the X-Forwarded-For header.
Meteor.onConnection(function onConnection(connection) {
  visitorIP = connection.clientAddress;  // TODO this isn't *super* fault-tolerant: the server could conceivably crash *exactly* between the DDP connection being established, and inserting the user (<1ms?)
});

/**
 * Hook to run after user creation - http://docs.meteor.com/#/full/accounts_oncreateuser
 * We can't pass any data outside of `profile` to Accounts.createUser
 * (see http://docs.meteor.com/#/full/accounts_createuser) so we have to either always store the referral
 * information within `profile` (bad idea - https://meteor.hackpad.com/Proposal-for-deprecating-user-profile-3UljX1VayvV),
 * or store it separately on the user object afterwards with onCreateUser.
 *
 * @returns {object} The user object with additional fields: visitorInfo, referral.code, referral.points
 */
Accounts.onCreateUser(function (options, user) {
  // store visitor information privately, out of the user's profile: IP, browser, language, resolution
  user.visitorInfo = options.profile && options.profile._visitorInfo || {};
  user.visitorInfo.ip = visitorIP;  // TODO: we may get IPv6 here, which is more difficult to geolocate: http://serverfault.com/questions/705796/prefer-ipv4-incoming-connections-over-ipv6

  // Create the referral field
  user.referral = {
    points: 0,
    code: Random.id(6)
  };
  return Referral.beforeCreateUser ? Referral.beforeCreateUser(options, user) : user;
});

Meteor.methods({

  /**
   * Create a new user, storing the information in userObj
   * @param {object} userObj - Meteor.users object: {username, emails, profile}. In practice, we won't receive a username.
   * The profile may contain _visitorInfo: {
        userAgent: navigator.userAgent,
        userLanguage: navigator.language,
        screenWidth: screen.width,
        screenHeight: screen.height,
        referrerURL: document.referrer
      }
   * @param {string} referralCode - referral code of the referring user
   * @returns {Object} The id of the newly created user
   */
  newUser: function newUser(userObj, referralCode) {
    // checks
    if (typeof userObj === 'undefined') throw new Meteor.Error('no-user-object', 'Please supply a user object');
    check(userObj, {
      username: Match.Optional(String),
      emails: [
        { address: String, verified: Match.Optional(Boolean) }
      ],
      profile: Match.Optional(Object)
    });
    // check(referralCode, Match.Optional(String));  // TODO apparently a Meteor bug: undefined fails the check, despite the docs

    this.unblock();

    // prepare to create the new user
    var userToCreate = {
      email: userObj.emails[0].address
    };
    if (userObj.username) userToCreate.username = userObj.username;  // don't allow a username of '0'
    if (userObj.profile) userToCreate.profile = userObj.profile;

    // TODO don't allow more than one registration per IP?
    // create user - http://docs.meteor.com/#/full/accounts_createuser
    var user, already = false;
    try {
      var newUserId = Accounts.createUser(userToCreate);
      user = Meteor.users.findOne(newUserId);
    } catch (error) {
      if (/mail already exist/.test(error.reason)) {
        user = Meteor.users.findOne({'emails.address': userObj.emails[0].address});
        already = true;
        console.log(userObj.emails[0].address, 'tried to sign up again from', visitorIP);
      }
    }

    if (already) return {
      _id: user._id,
      referralCode: user.referral.code,
      already: true
    };

    Accounts.sendEnrollmentEmail(user._id);

    console.log('Enrolled', userObj.emails[0].address);

    // check if the user was referred
    if (referralCode) {
      var referrer = Meteor.users.findOne({
        'referral.code': referralCode
      });
      if (!referrer) throw new Meteor.Error('invalid-referral-code', 'User created, but invalid referral code: ' + referralCode);

      // console.log('We got a referral via', referrer.emails[0].address);

      // store who referred the new user
      Meteor.users.update(user._id, {
        $set: {
          'referral.referrer': referrer._id
        }
      });

      // call the callback; most commonly used to assign points
      Referral.afterReferralMade(referrer._id, user._id);
    } else {
      // console.log('Brand new user!');
    }

    return {
      _id: user._id,
      referralCode: user.referral.code,
      already: already
    };
  }

});

/**
 * Publish the requested user document. Used to get the referral points.
 */
Meteor.publish('oneUser', function (userId) {
  return Meteor.users.find(userId);
});


/**
 * Return the points of the `howMany` users behind the specified `userId` in the line, without ties for the lowest score
 * @param {string} userId
 * @param {number} howMany
 * @description http://docs.meteor.com/#/full/meteor_publish doesn't allow returning two cursors from the same collection
 * so we have to create two separate publications, rather than one 'usersAround'.
 */
Meteor.publish('usersBehind', function (userId, howMany) {
  var user = Meteor.users.findOne(userId);
  if (!user) throw new Meteor.Error('no-such-userid', 'No such userId: ' + userId);

  // find the howMany users with points <= our user's, excluding ties (for that, see http://stackoverflow.com/questions/30805826/top-n-with-ties-for-mongodb)
  if (!user.referral) user.referral = { points: 0 };  // initial corner case
  return Meteor.users.find({
    'referral.points': {
      $lt: user.referral.points
    }  }, {
    sort: { 'referral.points': -1 },
    limit: howMany,
    fields: { referral: 1 }
  });
});


/**
 * Return the points of the `howMany` users ahead of the specified `userId`, without ties for the highest score
 * @param {string} userId
 * @param {number} howMany
 * @description Unfortunately, we can't easily have a 'usersAround' publication. See usersBehind.
 */
Meteor.publish('usersAhead', function (userId, howMany) {
  var user = Meteor.users.findOne(userId);
  if (!user) throw new Meteor.Error('no-such-userid', 'No such userId: ' + userId);

  // find howMany users with points immediately > our user's
  if (!user.referral) user.referral = { points: 0 };  // initial corner case
  return Meteor.users.find({
    'referral.points': {
      $gte: user.referral.points
    },
    _id: { $ne: userId }  // exclude the very user
  }, {
    sort: { 'referral.points': 1 },
    limit: howMany,
    fields: { referral: 1 }
  });
});


/**
 * Return one of the top scorers
 */
Meteor.publish('topUser', function () {
  return Meteor.users.find({

  }, {
    sort: { 'referral.points': -1 },
    limit: 1
  });
});
