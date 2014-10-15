var queue = require('queue-async');
var fs = require('fs');
var util = require('util');
var Carmen = require('..');
var index = require('../lib/index');
var feature = require('../lib/util/feature');
var mem = require('../lib/api-mem');
var UPDATE = process.env.UPDATE;
var test = require('tape');

// limit_verify 1 implies that the correct result must be the very top
// result prior to context verification. It means even with a long list
// of competing results the correct candidate is sorted to the top.

// limit_verify 2 implies that there is some ambiguity prior to context
// verification (e.g. new york (city) vs new york (province)) that is sorted
// into the correct order after context verification occurs.

(function() {
    var conf = {
        province: new mem(null, function() {}),
        city: new mem(null, function() {}),
        street: new mem({ maxzoom:6, geocoder_address:1 }, function() {})
    };
    var c = new Carmen(conf);
    test('index province', function(t) {
        var province = {
            _id:1,
            _text:'new york, ny',
            _zxy:['6/32/32','6/33/32'],
            _center:[0,0]
        };
        conf.province.putGrid(6, 32, 32, solidGrid(province));
        conf.province.putGrid(6, 33, 32, solidGrid(province));
        index.update(conf.province, [province], t.end);
    });
    test('index city 1', function(t) {
        var city = {
            _id:1,
            _text:'new york, ny',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.city.putGrid(6, 32, 32, solidGrid(city));
        index.update(conf.city, [city], t.end);
    });
    test('index city 2', function(t) {
        var city = {
            _id:2,
            _text:'tonawanda',
            _zxy:['6/33/32'],
            _center:[360/64,0]
        };
        conf.city.putGrid(6, 33, 32, solidGrid(city));
        index.update(conf.city, [city], t.end);
    });
    test('index street 1', function(t) {
        var street = {
            _id:1,
            _text:'west st',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.street.putGrid(6, 32, 32, solidGrid(street));
        index.update(conf.street, [street], t.end);
    });
    test('index street 2', function(t) {
        var street = {
            _id:2,
            _text:'west st',
            _zxy:['6/33/32'],
            _center:[360/64,0]
        };
        conf.street.putGrid(6, 33, 32, solidGrid(street));
        index.update(conf.street, [street], t.end);
    });
    test('west st, tonawanda, ny', function(t) {
        c.geocode('west st tonawanda ny', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'west st, tonawanda, new york');
            t.end();
        });
    });
    test('west st, new york, ny', function(t) {
        c.geocode('west st new york ny', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'west st, new york, new york');
            t.end();
        });
    });
    test('new york', function(t) {
        c.geocode('new york', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'new york');
            t.deepEqual(res.features[0].id, 'province.1');
            t.end();
        });
    });
    test('new york new york', function(t) {
        c.geocode('new york new york', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'new york, new york');
            t.deepEqual(res.features[0].id, 'city.1');
            t.end();
        });
    });
    test('ny ny', function(t) {
        c.geocode('ny ny', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'new york, new york');
            t.deepEqual(res.features[0].id, 'city.1');
            t.end();
        });
    });
    // failing
    test.skip('new york ny', function(t) {
        c.geocode('new york ny', { limit_verify:2 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'new york, new york');
            t.deepEqual(res.features[0].id, 'city.1');
            t.end();
        });
    });
})();

// Confirm that for equally relevant features across three indexes
// the first in hierarchy beats the others.
(function() {
    var conf = {
        country: new mem(null, function() {}),
        province: new mem(null, function() {}),
        city: new mem(null, function() {}),
    };
    var c = new Carmen(conf);
    test('index country', function(t) {
        var country = {
            _id:1,
            _text:'china',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.country.putGrid(6, 32, 32, solidGrid(country));
        index.update(conf.country, [country], t.end);
    });
    test('index province', function(t) {
        var province = {
            _id:1,
            _text:'china',
            _zxy:['6/33/32'],
            _center:[360/64,0]
        };
        conf.province.putGrid(6, 33, 32, solidGrid(province));
        index.update(conf.province, [province], t.end);
    });
    test('index city', function(t) {
        var city = {
            _id:1,
            _text:'china',
            _zxy:['6/34/32'],
            _center:[360/64*2,0]
        };
        conf.city.putGrid(6, 34, 32, solidGrid(city));
        index.update(conf.city, [city], t.end);
    });
    test('china', function(t) {
        c.geocode('china', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'china');
            t.deepEqual(res.features[0].id, 'country.1');
            t.end();
        });
    });
})();

(function() {
    var conf = {
        province: new mem(null, function() {}),
        postcode: new mem(null, function() {}),
        city: new mem(null, function() {}),
        street: new mem({ maxzoom:6, geocoder_address:1 }, function() {})
    };
    var c = new Carmen(conf);
    test('index province', function(t) {
        var province = {
            _id:1,
            _text:'connecticut, ct',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.province.putGrid(6, 32, 32, solidGrid(province));
        index.update(conf.province, [province], t.end);
    });
    test('index city', function(t) {
        var city = {
            _id:1,
            _text:'windsor',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.city.putGrid(6, 32, 32, solidGrid(city));
        index.update(conf.city, [city], t.end);
    });
    test('index street', function(t) {
        var street = {
            _id:1,
            _text:'windsor ct',
            _zxy:['6/33/32'],
            _center:[360/64,0]
        };
        conf.street.putGrid(6, 33, 32, solidGrid(street));
        index.update(conf.street, [street], t.end);
    });
    // failing
    // city beats street at spatialmatch
    test.skip('windsor ct (limit 1)', function(t) {
        c.geocode('windsor ct', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'windsor, connecticut');
            t.deepEqual(res.features[0].id, 'city.1');
            t.end();
        });
    });
    // failing
    // city beats street at context sort
    test.skip('windsor ct (limit 2)', function(t) {
        c.geocode('windsor ct', { limit_verify:2 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'windsor, connecticut');
            t.deepEqual(res.features[0].id, 'city.1');
            t.end();
        });
    });
})();


//Ensure that results that have equal relev in phrasematch
//are matched against the 0.5 relev bar instead of 0.75
(function() {
    var conf = {
        country: new mem({ maxzoom:6 }, function() {})
    };
    var c = new Carmen(conf);
    test('index country', function(t) {
        var country = {
            _id:1,
            _text:'czech republic',
            _zxy:['6/32/32'],
            _center:[0,0]
        };
        conf.country.putGrid(6, 32, 32, solidGrid(country));
        index.update(conf.country, [country], t.end);
    });
    test('index country2', function(t) {
        var country = {
            _id:2,
            _text:'fake country two',
            _zxy:['7/32/32'],
            _center:[0,0]
        };
        conf.country.putGrid(7, 32, 32, solidGrid(country));
        index.update(conf.country, [country], t.end);
    });
    test('czech => czech repblic', function(t) {
        c.geocode('czech', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.deepEqual(res.features[0].place_name, 'czech republic');
            t.deepEqual(res.features[0].id, 'country.1');
            t.end();
        });
    });

    //Is not above 0.5 relev so should fail.
    test('fake => [fail]', function(t) {
        c.geocode('fake', { limit_verify:1 }, function(err, res) {
            t.ifError(err);
            t.notOk(res.features[0]);
            t.end();
        });
    });
})();

//Ensures that relev takes into house number into consideration
(function() {
    var conf = {
        address: new mem({maxzoom: 6, geocoder_address: 1}, function() {})
    };
    var c = new Carmen(conf);
    test('index address', function(t) {
            var address = {
                _id:1,
                _text:'fake street',
                _zxy:['6/32/32'],
                _center:[0,0],
                _cluster: {
                    9: { type: "Point", coordinates: [0,0] },
                    10: { type: "Point", coordinates: [0,0] },
                    7: { type: "Point", coordinates: [0,0] }
                }
            };
            conf.address.putGrid(6, 32, 32, solidGrid(address));
            index.update(conf.address, [address], t.end);
    });
    test('test address index for relev', function(t) {
        c.geocode('9 fake street', { limit_verify: 1 }, function (err, res) {
            t.ifError(err);
            t.equals(res.features[0].relevance, 1);
            t.end();
        });
    });
})();

//If the layer does not have geocoder_address do not take house number into account
(function() {
    var conf = {
        address: new mem({maxzoom: 6}, function() {})
    };
    var c = new Carmen(conf);
    test('index address', function(t) {
            var address = {
                _id:1,
                _text:'fake street',
                _zxy:['6/32/32'],
                _center:[0,0],
            };
            conf.address.putGrid(6, 32, 32, solidGrid(address));
            index.update(conf.address, [address], t.end);
    });
    test('test address index for relev', function(t) {
        c.geocode('9 fake street', { limit_verify: 1 }, function (err, res) {
            t.ifError(err);
            t.equals(res.features[0].relevance, 0.6666666666666666);
            t.end();
        });
    });
})();


function solidGrid(feature) {
    return {
        "grid": [
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                ",
            "                                                                "
        ],
        "keys": [
            "89"
        ],
        "data": {
            "89": feature
        }
    };
};

