var getSetRelevance = require('./pure/setrelevance'),
    coalesceZooms = require('./pure/coalescezooms'),
    sm = new(require('sphericalmercator'))(),
    ops = require('./util/ops'),
    mp2_14 = Math.pow(2, 14),
    mp2_28 = Math.pow(2, 28),
    queue = require('queue-async'),
    termops = require('./util/termops'),
    feature = require('./util/feature');

var xd = Math.pow(2, 39),
    yd = Math.pow(2, 25),
    mp2_14 = Math.pow(2, 14),
    mp2_28 = Math.pow(2, 28);

module.exports = spatialmatch;

// Given that we've geocoded potential results in multiple sources, given
// arrays of `feats` and `grids` of the same length, combine matches that
// are over the same point, factoring in the zoom levels on which they
// occur.
// Calls `callback` with `(err, contexts, relevd)` in which
//
// @param `contexts` is an array of bboxes which are assigned scores
// @param `relevd` which is an object mapping place ids to places
// @param {Object} geocoder the geocoder instance
// @param {Array} feats an array of feature objects
// @param {Array} grids an array of grid objects
// @param {Array} zooms an array of zoom numbers
// @param {Function} callback
function spatialmatch(query, stats, geocoder, feats, grids, zooms, options) {
    var types = Object.keys(geocoder.indexes);

    // Combine the scores for each match across multiple grids and zoom levels,
    // producing a mapping from `zxy` to matches
    var coalesced = coalesceZooms(grids, feats, types, zooms, geocoder.indexes);

    // Generate a light modifier to apply to results from indexes without
    // address handling if an address is present in the query.
    var addrmod = {};
    var addridx = {};
    var address = termops.address(query);

    for (var id in geocoder.indexes) {
        addrmod[id] = address && geocoder.indexes[id]._geocoder.geocoder_address ? 0.01 : 0;
        addridx[geocoder.order[id]] = address && geocoder.indexes[id]._geocoder.geocoder_address;
    }

    var sets = {},
        rowMemo = {},
        i, c, l,
        feat,
        rows,
        relev,
        fullid,
        pushed;

    for (c in coalesced) {
        pushed = false;
        rows = coalesced[c];

        // Sort by db, relev such that total relev can be
        // calculated without results for the same db being summed.
        rows.sort(sortRelevReason);
        relev = getSetRelevance(query, rows, address);

        for (i = 0, l = rows.length; i < l; i++) {
            if (!rows[i]) continue;

            fullid = rows[i].dbname + '.' + rows[i].id;
            sets[fullid] = sets[fullid] || rows[i];

            if (pushed === false || pushed === rows[i].dbid) {
                pushed = rows[i].dbid;
                rowMemo[rows[i].tmpid] = {
                    dbid: rows[i].dbid,
                    dbname: rows[i].dbname,
                    id: rows[i].id,
                    tmpid: rows[i].tmpid,
                    relev: relev + addrmod[rows[i].dbid],
                    idx: rows[i].idx
                };
            }
        }
    }

    var results = [],
        contexts = [],
        formatted = [],
        memo = null;

    for (j in rowMemo) {
        results.push(rowMemo[j]);
    }

    results.sort(sortByRelev);

    for (var k = 0; k < results.length; k++) {
        feat = results[k];
        if (memo === null || memo - feat.relev < 0.1) {
            memo = memo || feat.relev;
            formatted.push(feat);
        }
    }

    results = formatted;

    stats.relevTime = +new Date() - stats.relevTime;
    stats.relevCount = results.length;

   //Stores the proximity latlng as zxy at all source zoom levels
    var zxyProximity = {};

    //If latlng is given, favour results closest locale
    if (options.proximity) {
        for (var i = 0; i < zooms.length; i++) {
            zxyProximity[zooms[i]] = sm.px(options.proximity, zooms[i]);
        }
        var zxyResult = [];
        for (var i = 0; i < results.length; i++) {
            results[i].z = geocoder.indexes[results[i].dbid]._geocoder.zoom;
            results[i].x = Math.floor(results[i].tmpid / xd);
            results[i].y = Math.floor(results[i].tmpid % xd / yd);
            results[i].distance = Math.pow(Math.pow(zxyProximity[results[i].z][0] - results[i].x, 2) + Math.pow(zxyProximity[results[i].z][1] - results[i].y, 2), 0.5);
        }
        results.sort(sortByProximity);
    }

    return {
        sets: sets,
        results: results,
        coalesced: coalesced
    };
}

function sortByProximity(a, b) {
    if (a.idx > b.idx) return -1;
    else if (a.idx < b.idx) return 1;
    else if (a.relev > b.relev) return -1;
    else if (a.relev < b.relev) return 1;
    else if (a.distance < b.distance) return -1;
    else if (a.distance > b.distance) return 1;
    else if (a.id < b.id) return -1;
    else if (a.id > b.id) return 1;
    return 0;
}

function sortRelevReason(a, b) {
    if (a.idx > b.idx) return -1;
    else if (a.idx < b.idx) return 1;
    else if (a.relev > b.relev) return -1;
    else if (a.relev < b.relev) return 1;
    else if (a.reason > b.reason) return -1;
    else if (a.reason < b.reason) return 1;
    else if (a.id < b.id) return -1;
    else if (a.id > b.id) return 1;
    return 0;
}

function sortByRelev(a, b) {
    return b.relev - a.relev;
}

