var getSetRelevance = require('./pure/setrelevance');
var applyAddress = require('./pure/applyaddress');
var addressCluster = require('./pure/addresscluster');
var sm = new(require('sphericalmercator'))();
var queue = require('queue-async');
var context = require('./context');
var termops = require('./util/termops');
var feature = require('./util/feature');

var mp2_14 = Math.pow(2, 14);
var mp2_28 = Math.pow(2, 28);

module.exports = verifymatch;

function verifymatch(query, stats, geocoder, matched, options, callback) {
    var sets = matched.sets;
    var results = matched.results;
    var coalesced = matched.coalesced;
    var address = termops.address(query);
    var types = Object.keys(geocoder.indexes);

    var contexts = [];
    var start = +new Date();
    var q = queue();

    results.forEach(function(term) {
        q.defer(loadResult, term);
    });

    q.awaitAll(function(err) {
        if (err) return callback(err);

        var subsets;
        for (var j = 0, cl = contexts.length; j < cl; j++) {
            subsets = [];
            for (var i = 0, cjl = contexts[j].length; i < cjl; i++) {
                var a = contexts[j][i];
                if (sets[a._fhash]) subsets.push(sets[a._fhash]);
            }

            //Update the address layer bitmask & count to include the first term (assumed to be house number)
            //@TODO this will need to be updated once we support more than US addresses
            if (address && subsets[0].reason % 2 === 0 && geocoder.indexes[subsets[0].dbid]._geocoder.geocoder_address) {
                subsets[0].count = subsets[0].count + 1;
                subsets[0].reason = subsets[0].reason + 1;
            }
            
            contexts[j]._relevance = getSetRelevance(query, subsets);
            contexts[j]._typeindex = types.indexOf(contexts[j][0]._extid.split('.')[0]);
        }

        if (options.proximity) {
            for (var i = 0; i < contexts.length; i++) {
                var lat1 = options.proximity[0],
                    lat2 = contexts[i][0]._center[1],
                    lon1 = options.proximity[1],
                    lon2 = contexts[i][0]._center[0];
                var phi1 = lat1 * (Math.PI / 180),
                    phi2 = lat2 * (Math.PI / 180);
                var deltaPhi = (lat2-lat1) * (Math.PI / 180),
                    deltaLambda = (lon2-lon1) * (Math.PI / 180);
                var a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
                contexts[i][0]._distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            }
        }
        contexts.sort(sortContext);

        stats.contextTime = +new Date() - start;
        stats.contextCount = contexts.length;

        return callback(null, contexts);
    });

    // For each result, load the feature from its Carmen index so that we can
    // then load all of the relevant contexts for that feature
    function loadResult(term, callback) {
        var cq = queue();
        var source = geocoder.indexes[term.dbid];
        feature.getFeature(source, term.id, featureLoaded);
        function featureLoaded(err, features) {
            if (err) return callback(err);
            for (var id in features) {
                // To exclude false positives from feature hash collisions
                // check the feature center coord and ensure it is in the
                // coalesced result set.
                // @TODO for fully accurate results, iterate through
                // coalesced[coord] for a matching feature id.
                var feat = features[id];
                // filter out altnames, scored as -1
                if (typeof feat._score !== 'undefined' && feat._score < 0) continue;
                var bbox = sm.xyz([feat._center[0], feat._center[1], feat._center[0], feat._center[1]], source._geocoder.zoom);
                var coord = (source._geocoder.zoom * mp2_28) + (bbox.minX * mp2_14) + (bbox.minY);
                var checks = coalesced[coord];
                if (address && feat._rangetype && source._geocoder.geocoder_address) {
                    feat._address = address;
                    feat._geometry = applyAddress(feat, address);
                    feat._center = feat._geometry && feat._geometry.coordinates;
                    checks = checks && feat._geometry;
                }
                else if (address && feat._cluster && source._geocoder.geocoder_address){
                    feat._address = address;
                    feat._geometry = addressCluster(feat, address);
                    feat._center = feat._geometry && feat._geometry.coordinates;
                    checks = checks && feat._geometry;
                }
                if (checks) cq.defer(function(feat, callback) {
                    if (!('_center' in feat)) return callback(new Error('No _center field in data'));
                    feat._extid = term.dbname + '.' + id;
                    feat._fhash = term.dbname + '.' + term.id;
                    context(geocoder, feat._center[0], feat._center[1], term.dbid, false, function(err, context) {
                        if (err) return callback(err);
                        // Push feature onto the top level.
                        context.unshift(feat);
                        return callback(null, context);
                    });
                }, feat);
            }
            cq.awaitAll(contextLoaded);
        }
        function contextLoaded(err, loaded) {
            if (err) return callback(err);
            contexts.push.apply(contexts, loaded);
            callback();
        }
    }
}

function sortContext(a, b) {
    // First, compute the relevance of this query term against
    // each set.
    if (a._relevance > b._relevance) return -1;
    if (a._relevance < b._relevance) return 1;

    // primary sort by result's index.
    if (a._typeindex < b._typeindex) return -1;
    if (a._typeindex > b._typeindex) return 1;

    if (a[0]._distance && b[0]._distance) {
        if (a[0]._distance < b[0]._distance) return -1;
        if (a[0]._distance > b[0]._distance) return 1;
    }

    // within results of equal relevance.
    a = a[0];
    b = b[0];

    // secondary sort by score key.
    var as = a._score || 0;
    var bs = b._score || 0;
    if (as > bs) return -1;
    if (as < bs) return 1;

    // last sort by id.
    if (a._id < b._id) return -1;
    if (a._id > b._id) return 1;
    return 0;
}
