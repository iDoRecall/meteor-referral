'use strict';

Package.describe({
  name: 'idorecall:referral',
  version: '0.1.0',
  summary: "Referral system with points ranking. Inspired by Kickoff Labs' Viral Referral Generation",
  git: 'https://github.com/idorecall/meteor-referral',
  documentation: 'README.md'
});

Package.onUse(function (api) {
  api.addFiles('server/server.js', 'server');
  api.export('Referral');
});
