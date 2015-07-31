Referral with ranking ![GitHub license](https://img.shields.io/:license-mit-blue.svg?style=flat)
=====================

Referral system that creates a ranking of users based on the points they've accumulated by referring others.
Built with Meteor but usable from any other app - WordPress, Ghost etc. - basically anywhere where you can run JavaScript.

Inspired by Kickoff Labs' [Viral Referral Generation](http://kickofflabs.com/features/#generatereferrals).

Make sure to watch [27 Referral Program Hack-tics in 20 Minutes](https://www.youtube.com/watch?v=KMGnOU3lwQg).



## How it works

When a user signs up, they get a referral URL to pass around, and a welcome email. The email has the same referral URL, plus another URL to check the user's progress (this is Meteor's email verification URL, so you shoot two birds with one click). For each referred user, the referrer gets a configurable amount of points. The points serve as an indicator of engagement for allowing select users into your private beta.

The architecture consists of:

* A backend Meteor app whose server handles the referral logic, offers a DDP endpoint and stores the referral information in [Meteor.users](http://docs.meteor.com/#/full/meteor_users) under the `referral` field
* The client of the backend shows the user's ranking among signed up users
* Client code that calls Meteor methods using [Asteroid](https://github.com/mondora/asteroid).
* TODO admin interface (a simple Webix table would do, but you can just use RoboMongo in a pinch)

REST support is planned because [Asteroid's footprint is ~98KB](https://github.com/mondora/asteroid/issues/65) unminified. However, [simple:rest doesn't yet have support for logging in over REST with Facebook, Google or other OAuth providers](https://github.com/stubailo/meteor-rest/tree/master/packages/rest#logging-in-over-http) while Asteroid does (via DDP).


### Data model

Each user object will be decorated with a `referral` field, which is an object with the following properties:

* `referrer` - the id of the user who referred this one
* `code` - a 6-character [`Random.id()`](http://docs.meteor.com/#/full/random) referral code
* `points`



## Usage

Deploy the Meteor app on your server and make sure it's accessible through the firewall.


### Client code

When a user signs up, [call](https://github.com/mondora/asteroid#asteroidcallmethod-param1-param2-) the `newUser` method and pass in an object any information you'd like stored in [Meteor.users](http://docs.meteor.com/#/full/meteor_users). The accepted properties are `username`, `emails`, and `profile`. The `newUser` method returns an object to the `result` promise, including:

* `_id` of the newly created (or already registered) user
* `already` - has the user already registered?
* `referralCode`

Example:

```js
var asteroid = new Asteroid('http://yoursite.com');

var ret = asteroid.call('newUser', {
  emails: [
    { address: 'john@example.com' }
  ],
});

ret.result
  .then(function (newUser) {
  // do something with the referral code
  $('.signup-successful').html('Send this referral link to your friends: http://yoursite.com/signup?sref=' + newUser.referralCode);
}).catch(function (error) {
  console.error('Error:', error);
}).done();
```

If the user signs up *with* a referral code, fish it from the query string and pass it as an extra parameter to `newUser`:

```js
var queryDict = {};
window.location.search.substr(1).split("&").forEach(function(item) {queryDict[item.split("=")[0]] = item.split("=")[1]})
if (queryDict.sref) {
  var ret = asteroid.call('newUser', {
    emails: [
      { address: 'johnsfriend@example.com' }
    ],
  }, queryDict.ref);
}
```


### Server code

The Referral singleton has two callbacks you can use.


#### beforeCreateUser callback

**You must move all your [`onCreateUser`](http://docs.meteor.com/#/full/accounts_oncreateuser) code, if any, into this callback.** That is because *Referral* needs to call `onCreateUser`, but the Meteor documentation states that,

> Calling onCreateUser overrides the default hook. This can only be called once.

The package will create the referral code for you and store the referral relationship, then call your callback. The syntax is the same as for `onCreateUser`, and the `user` object is pre-populated with the fields described in [Data model](#data-model). Your callback can, for example, award some signup points to the user:

```js
Referral.beforeCreateUser(function (options, user) {
  // Give the new user some starting points; .edu addresses are worth more.
  var points = (user.emails && user.emails[0].address || user.email).match(/\.edu$/i) ? 5 : 1;

  user.referral.points = points;
  return user;
});
```

#### afterReferralMade callback

Called after a user signs up using a referral code. Use it for example to reward the referrer:

```js
Referral.afterReferralMade = function (referrerId, refereeId) {
  var referee = Meteor.users.findOne(refereeId);
  var points = referee.emails[0].match(/\.edu$/) ? 3 : 1;
  // reward the referrer
  Meteor.users.update(referrerId, {
    $inc: {
      points: points
    }
  });
}
```

The package stores for you who the referrer was (useful to create friend/follower relationships).


## Publications

The following publications are available on the client:

* usersAhead(userId, howMany)
* usersBehind(userId, howMany)
* oneUser(userId)
* topUser - returns one of the top scorers. Useful to get the maximum `.referral.points`.


## Referral Program Hack-tics presentation by [Ivan Kirigin](https://www.linkedin.com/in/kirigin)

Here are some interesting ideas from [the video](https://www.youtube.com/watch?v=KMGnOU3lwQg):

* #3 - Add link mechanics to identify the referral medium (FB/G+/email etc.)
* #4 - details on the emails (spam, bounced) are non-trivial to get. Meteor sens email through Mailgun by default and last I checked, they had a limit of 200 emails sent per day. You could send through Google's SMTP server (500/day) as well. Sending from your own server is generally discouraged due to the risk of non-established domains being considered potential spam sources.  [Mandrill](http://www.mandrill.com/pricing/) is free for up to 12k emails/month. A fallback strategy among different email providers could take you a long way at the cost of fragmenting email analytics such as open rates among various services.
* #5 - *make it feel like the sharer is giving a gift*
* #7 - endowed progress
* #8 - make the link easy to copy
* #10 - email is very valuable, vs. social media
* #11 - invite your Gmail contacts - Ivan suggests emailing everyone in your address book. I would never do that, but then he talks exactly about how engineers react that way, but normal people don't have much of a problem.
* #12 - add local sharing services, e.g. Whatsapp. There are services like AddThis and ShareThis, which automatically show the popular social networks in the location determined by the IP of the visitor
* #13 - On the landing page, show the face of the person who referred you. We can get this from their email via Gravatar, or from the OAuth service user profile.
* #14 - use deep linking tools within mobile apps
* #15 - Get the information of the person who registers, but unclear how
* #22 - call out people with the same last name at the top when sending invites based on emails in the Gmail address book or the smartphone's contact list. Or by the same email domain (students at the same .edu). Or general social graph analysis if user logged in via OAuth.
* #23 - Tack on "PS: get extra XXXX", hyperlinking to a referral action, in ordinary emails, without calling it explicitly "tell your friends"
* #24 - email reminder of invitation status - who's accepted it, and who hasn't. We can do that justifiably whenever a referee signs up (show the status of the others)
* #25 - once a referral was made, thank the referrer and suggest a *different referral channel* they could use
* #26 - filter out address tags, e.g. `@gmail.com`. We've implemented this in [idorecall:email-normalize](https://atmospherejs.com/idorecall/email-normalize).


## Prior art

* [keryi:meteor-referral](https://github.com/keryi/meteor-referral/) undocumented, usable only from Meteor applications, written in CoffeeScript.


## License and copyright

Maintainer: Dan Dascalescu ([@dandv](https://github.com/dandv))

Copyright (C) 2015 [iDoRecall](http://idorecall.com), Inc.

The MIT License (MIT)
