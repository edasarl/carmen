var address = require('../lib/pure/applyaddress.js');
var addressCluster = require('../lib/pure/addresscluster.js');
var test = require('tape');

test('address interpolation - noop', function(t) {
    t.deepEqual(undefined, address({ _rangetype:'' }, 100));
    t.deepEqual(undefined, address({ _rangetype:'tiger' }, 100));
    t.deepEqual(undefined, address({ _rangetype:'tiger', _geometry: { type:'Point', coordinates:[-78,40] } }, 100));
    t.end();
});

 test('address interpolation - parity: even + both', function(t) {
    t.deepEqual({
        type:'Point',
        coordinates:[0,9]
    }, address({
        _rangetype:'tiger',
        _lfromhn: '0',
        _ltohn: '100',
        _geometry: {
            type:'LineString',
            coordinates:[[0,0],[0,100]]
        }
    }, 9));
     t.end();
});

test('address point clustering', function(t) {
    t.deepEqual(
        addressCluster(
            {
                _cluster: {
                    9: { type: "Point", coordinates: [1,1] },
                    10: { type: "Point", coordinates: [2,2] },
                    7: { type: "Point", coordinates: [0,0] }
                }
            }, 9),
        {
            type:'Point',
            coordinates:[1,1]
        });
    t.end();
});

test('reverse address point clustering', function(t) {
    t.deepEqual(
        addressCluster.reverse(
            {
                _text: "test",
                _cluster: {
                    9: { type: "Point", coordinates: [1,3] },
                    10: { type: "Point", coordinates: [2,4] },
                    7: { type: "Point", coordinates: [0,1] }
                },
                _geometry: { text: "MultiPoint Here" }
            }, [1,3]),
        {
            _cluster: { 10: { coordinates: [ 2, 4 ], type: 'Point' }, 7: { coordinates: [ 0, 1 ], type: 'Point' }, 9: { coordinates: [ 1, 3 ], type: 'Point' } },
            _geometry: { coordinates: [ 1, 3 ], type: 'Point' },
            _text: '9 test' });
    t.end();
});

test('address point clustering invalid coords', function(t) {
    t.deepEqual(
        addressCluster(
            {
                _cluster: {
                    9: { type: "Point", coordinates: [1,1,1] },
                    10: { type: "Point", coordinates: [2,2,2] },
                    7: { type: "Point", coordinates: [0,0,0] }
                }
            }, 9),
        undefined);
    t.end();
});

test('address point clustering not point', function(t) {
    t.deepEqual(
        addressCluster(
            {
                _cluster: {
                    9: { "type": "Polygon",
                        "coordinates": [
                            [
                                [
                                    -17.2265625,
                                    8.407168163601076
                                ],
                                [
                                    -17.2265625,
                                    53.9560855309879
                                ],
                                [
                                    34.80468749999999,
                                    53.9560855309879
                                ],
                                [
                                    34.80468749999999,
                                    8.407168163601076
                                ],
                                [
                                    -17.2265625,
                                    8.407168163601076
                                ]
                            ]
                        ] }
                }
            }, 9),
        undefined);
    t.end();
});

test('address point clustering fail', function(t) {
    t.deepEqual(
        addressCluster(
            {
                _cluster: {
                    9: { type: "Point", coordinates: [1,1] },
                    10: { type: "Point", coordinates: [2,2] },
                    7: { type: "Point", coordinates: [0,0] }
                }
            }, 11),
        undefined);
    t.end();
});

test('parity: even + even', function(t) {
    t.deepEqual({
        type:'Point',
        coordinates:[0,10]
    }, address({
        _rangetype:'tiger',
        _lfromhn: '0',
        _ltohn: '100',
        _parityl: 'E',
        _geometry: {
            type:'LineString',
            coordinates:[[0,0],[0,100]]
        }
    }, 10));
    t.end();
});

test('parity: even + odd', function(t) {
    t.deepEqual(undefined, address({
        _rangetype:'tiger',
        _lfromhn: '0',
        _ltohn: '100',
        _parityl: 'E',
        _geometry: {
            type:'LineString',
            coordinates:[[0,0],[0,100]]
        }
    }, 9));
    t.end();
});

test('parity: odd + both', function(t) {
    t.deepEqual({
        type:'Point',
        coordinates:[0,9]
    }, address({
        _rangetype:'tiger',
        _lfromhn: '1',
        _ltohn: '101',
        _parityl: 'B',
        _geometry: {
            type:'LineString',
            coordinates:[[0,1],[0,101]]
        }
    }, 9));
    t.end();
});

test('parity: odd + odd', function(t) {
    t.deepEqual({
        type:'Point',
        coordinates:[0,9]
    }, address({
        _rangetype:'tiger',
        _lfromhn: '1',
        _ltohn: '101',
        _parityl: 'O',
        _geometry: {
            type:'LineString',
            coordinates:[[0,1],[0,101]]
        }
    }, 9));
    t.end();
});

test('parity: odd + even', function(t) {
    t.deepEqual(undefined, address({
        _rangetype:'tiger',
        _lfromhn: '1',
        _ltohn: '101',
        _parityl: 'E',
        _geometry: {
            type:'LineString',
            coordinates:[[0,1],[0,101]]
        }
    }, 9));
    t.end();
});

test('reverse', function(t) {
    t.deepEqual({
        type: 'Point',
        coordinates: [0,90]
    }, address({
        _rangetype:'tiger',
        _lfromhn: '100',
        _ltohn: '0',
        _parityl: 'E',
        _geometry: {
            type:'LineString',
            coordinates:[[0,0],[0,100]]
        }
    }, 10));
    t.end();
});

test('seminumber', function(t) {
    t.deepEqual({
        type: 'Point',
        coordinates: [0,10]
    }, address({
        _rangetype:'tiger',
        _lfromhn: 'G-0',
        _ltohn: 'G-100',
        _parityl: 'E',
        _geometry: {
            type:'LineString',
            coordinates:[[0,0],[0,100]]
        }
    }, 10));
    t.end();
});

test('multi', function(t) {
    t.deepEqual([0,40.981964], address({
        _rangetype: 'tiger',
        _lfromhn: ['1002','2'],
        _ltohn: ['1998','1000'],
        _rfromhn: ['1001','1'],
        _rtohn: ['1999','999'],
        _parityr: ['O','O'],
        _parityl: ['E','E'],
        _geometry: {
            type:'MultiLineString',
            coordinates:[
                [[0,0],[0,10]],
                [[0,40],[0,50]]
            ]
        }
    }, 100).coordinates);
    t.end();
});
