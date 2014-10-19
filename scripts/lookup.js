#!/usr/bin/env node

var fs = require('fs');
var split = require('split');
var termops = require('../lib/util/termops.js');
var fnv = require('../lib/util/fnv.js');
var feature = require('../lib/util/feature.js');

if (!process.argv[2]) {
    console.log('Usage: phrasematch.js --query="<query>" --[phrase|term] --index="" --geojson');
    process.exit(1);
}

var Carmen = require('../index');
var path = require('path');
var argv = require('minimist')(process.argv, {
    'string': [ 'query', 'index' ],
    'boolean':[ 'phrase', 'term', 'geojson' ]
});

if (!argv.query) throw new Error('--query argument required');
if (!argv.index) throw new Error('--index arguement required');
if (!argv.term && !argv.phrase) throw new Error('--[phrase|term] argument required');

var opts = {};
if (argv.index) { //Given Tile Source
    if (!fs.existsSync(argv.index)) throw new Error('Index does not point to actual file');
    var src = path.resolve(argv.index);
    opts[path.basename(src)] = Carmen.auto(src);
} else { //Default Tile Source
    throw new Error('--index="<index-path>" required');
}

var geocoder = new Carmen(opts);

geocoder.on('open', function() {
    var source = geocoder.indexes[Object.keys(geocoder.indexes)[0]];
    if (argv.term) {
        var terms = termops.tokenize(argv.query),
            termsHash = [];
        console.log("[QUERY]: ", JSON.stringify(terms));
        terms.forEach(function (term) {
            termsHash.push(fnv(term, 28));
        });
        console.log("[TERMS]: ", JSON.stringify(termsHash));
        source._geocoder.getall(source.getGeocoderData.bind(source), 'term', termsHash, function(err, phraseHash) {
            console.log("[PHRASE]: ", JSON.stringify(phraseHash));
            source._geocoder.getall(source.getGeocoderData.bind(source), 'grid', phraseHash, function(err, grids) {
                console.log("[GRIDS]:", JSON.stringify(grids));
                var ids = []
                var dedupe = {};
                grids.forEach(function(grid) {
                    id = grid % Math.pow(2, 25);
                    ids.push(id);
                    dedupe[id] = "Yeah!"; //Hashmap to remove duplicates
                });
                var dedupeIds = Object.keys(dedupe);
                console.log("[IDS]:", JSON.stringify(ids));
                console.log("[DEDUPE IDS]:", JSON.stringify(dedupeIds));

                getFeat([], dedupeIds, 0);

                function getFeat(features, ids, i) {
                    feature.getFeature(source, dedupeIds[i], function(err, feat) {
                        features.push(feat);
                        if (i < ids.length-1)
                            getFeat(features, ids, i+1);
                        else
                            allFeatures(features);
                    });
                }

                function allFeatures(features) {
                    if (argv.geojson)
                        console.log("[GEOJSON]:",JSON.stringify(features));
                    else {
                        var titles = [];
                        features.forEach(function(feature) {
                            titles.push(feature[Object.keys(feature)[0]]._text);
                        });
                        console.log("[TITLE]:", JSON.stringify(titles));
                    }

                };

            });
        });
    } else
        console.log("Only terms are currently supported");

});
