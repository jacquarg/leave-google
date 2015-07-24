// Generated by CoffeeScript 1.8.0
var CompareContacts, Contact, NotificationHelper, PICTUREREL, access_token, addContactPicture, addContactToCozy, async, https, im, listContacts, localizationManager, log, notification, numberProcessed, realtimer, total, url, _;

Contact = require('../models/contact');

CompareContacts = require('../utils/compare_contacts');

async = require('async');

realtimer = require('./realtimer');

log = require('printit')({
  prefix: 'contactsimport'
});

im = require('imagemagick-stream');

_ = require('lodash');

https = require('https');

url = require('url');

access_token = null;

numberProcessed = 0;

total = 0;

NotificationHelper = require('cozy-notifications-helper');

notification = new NotificationHelper('import-from-google');

localizationManager = require('./localization_manager');

addContactToCozy = function(gContact, cozyContacts, callback) {
  var cozyContact, endCb, fromCozy, fromGoogle, name, toCreate, _i, _len;
  log.debug("import 1 contact");
  fromGoogle = new Contact(Contact.fromGoogleContact(gContact));
  name = fromGoogle.getName();
  log.debug("looking or " + name);
  if (name === "") {
    numberProcessed += 1;
    realtimer.sendContacts({
      number: numberProcessed,
      total: total
    });
    return callback(null);
  } else {
    fromCozy = null;
    for (_i = 0, _len = cozyContacts.length; _i < _len; _i++) {
      cozyContact = cozyContacts[_i];
      if (CompareContacts.isSamePerson(cozyContact, fromGoogle)) {
        fromCozy = cozyContact;
        break;
      }
    }
    endCb = function(err, updatedContact) {
      log.debug("updated " + name + " err=" + err);
      if (err) {
        return callback(err);
      }
      numberProcessed += 1;
      realtimer.sendContacts({
        number: numberProcessed,
        total: total
      });
      return callback(null, updatedContact);
    };
    if (fromCozy != null) {
      log.debug("merging " + name);
      toCreate = CompareContacts.mergeContacts(fromCozy, fromGoogle);
      toCreate.docType = 'contact';
      return toCreate.save(endCb);
    } else {
      fromGoogle.revision = new Date().toISOString();
      log.debug("creating " + name);
      return Contact.create(fromGoogle, endCb);
    }
  }
};

PICTUREREL = "http://schemas.google.com/contacts/2008/rel#photo";

addContactPicture = function(cozyContact, gContact, done) {
  var opts, pictureLink, pictureUrl, _ref;
  pictureLink = gContact.link.filter(function(link) {
    return link.rel === PICTUREREL;
  });
  pictureUrl = (_ref = pictureLink[0]) != null ? _ref.href : void 0;
  if (!pictureUrl) {
    return done(null);
  }
  opts = url.parse(pictureUrl);
  opts.headers = {
    'Authorization': 'Bearer ' + access_token,
    'GData-Version': '3.0'
  };
  return https.get(opts, function(stream) {
    var thumbStream, type;
    stream.on('error', done);
    if (stream.statusCode !== 200) {
      log.warn("error fetching " + pictureUrl, stream.statusCode);
      return done(null);
    }
    thumbStream = stream.pipe(im().resize('300x300^').crop('300x300'));
    thumbStream.on('error', done);
    thumbStream.path = 'useless';
    type = stream.headers['content-type'];
    opts = {
      name: 'picture',
      type: type
    };
    return cozyContact.attachFile(thumbStream, opts, function(err) {
      if (err) {
        log.error("picture " + err);
      } else {
        log.debug("picture ok");
      }
      return done(err);
    });
  });
};

listContacts = function(callback) {
  var opts, req;
  opts = {
    host: 'www.google.com',
    port: 443,
    path: '/m8/feeds/contacts/default/full?alt=json&max-results=10000',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + access_token,
      'GData-Version': '3.0'
    }
  };
  req = https.request(opts, function(res) {
    var data;
    data = [];
    res.on('error', callback);
    res.on('data', function(chunk) {
      return data.push(chunk);
    });
    return res.on('end', function() {
      var err, result;
      if (res.statusCode === 200) {
        try {
          result = JSON.parse(data.join(''));
          return callback(null, result.feed.entry);
        } catch (_error) {
          err = _error;
          return callback(err);
        }
      } else {
        return callback(new Error("Error " + res.statusCode));
      }
    });
  });
  req.on('error', callback);
  return req.end();
};

module.exports = function(token, callback) {
  access_token = token;
  log.debug('request contacts list');
  numberProcessed = 0;
  return async.parallel({
    google: listContacts,
    cozy: Contact.all
  }, function(err, contacts) {
    var updatedContacts, _ref, _ref1;
    log.debug("got " + (contacts != null ? (_ref = contacts.google) != null ? _ref.length : void 0 : void 0) + " contacts");
    if (err) {
      return callback(err);
    }
    total = (_ref1 = contacts.google) != null ? _ref1.length : void 0;
    updatedContacts = {};
    return async.eachSeries(contacts.google, function(gContact, cb) {
      return addContactToCozy(gContact, contacts.cozy, function(err, updatedContact) {
        updatedContacts[gContact.id.$t] = updatedContact;
        return cb(err);
      });
    }, function(err) {
      if (err) {
        return callback(err);
      }
      return async.eachSeries(contacts.google, function(gContact, cb) {
        if (updatedContacts[gContact.id.$t] != null) {
          return addContactPicture(updatedContacts[gContact.id.$t], gContact, function(err) {
            log.debug("picture err " + err);
            return setTimeout(cb, 10);
          });
        } else {
          return cb();
        }
      }, function(err) {
        if (err) {
          return callback(err);
        }
        notification.createOrUpdatePersistent("leave-google-contacts", {
          app: 'import-from-google',
          text: localizationManager.t('notif_import_contact', {
            total: total
          }),
          resource: {
            app: 'contacts',
            url: 'contacts/'
          }
        });
        return callback();
      });
    });
  });
};
